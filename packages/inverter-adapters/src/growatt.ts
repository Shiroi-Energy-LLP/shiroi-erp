/**
 * Growatt adapter — per-customer legacy server-api.growatt.com auth.
 *
 * Architecture (confirmed against real API 2026-05-23):
 *   See docs/2026-05-23-growatt-api-architecture.md for the full investigation log.
 *
 * Auth model:
 *   Each Growatt customer owns their plants directly. We log in AS each customer
 *   using credentials from plant_monitoring_credentials. Auth is per-customer,
 *   not per-API-key.
 *
 * Flow:
 *   1. Hash password: MD5 hex, then replace '0' at even positions with 'c'
 *      (this is Growatt's hash_password algorithm in the Python growattServer lib)
 *   2. POST newTwoLoginAPI.do with userName + password (form-urlencoded)
 *      → session cookies + userId in back.user.id
 *   3. GET PlantListAPI.do?userId=... with session cookies
 *      → plant list (sanity check only)
 *   4. GET newTwoPlantAPI.do?op=getAllDeviceList&plantId=... with session cookies
 *      → deviceList[] containing inverter records
 *   5. Find device by deviceSn == monitoring_device_id → normalize → return
 *
 * Cookie handling:
 *   Node fetch does NOT auto-handle cookies. We extract Set-Cookie from the
 *   login response and build a Cookie header manually for subsequent requests.
 *   Cookies that matter: JSESSIONID, SERVERID, SERVERCORSID, acw_tc.
 *
 * Rate limiting (IMPORTANT):
 *   Growatt aggressively rate-limits login endpoints — too many logins per
 *   account in a short window locks the account for 24h.
 *   Currently we login fresh on every fetchReadings call (called every 15 min
 *   per inverter). Multiple inverters under the same customer = multiple logins
 *   per cycle.
 *   TODO(phase-8-session-cache): Cache session cookies per (username, expiry)
 *   so all inverters under the same customer reuse one login token. This will
 *   reduce logins from N-inverters-per-cycle to 1-per-customer-per-cycle.
 */

import { createHash } from 'node:crypto';
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  AdapterError,
  NormalizedStatus,
  syntheticReading,
} from './base';

// ─── Constants ────────────────────────────────────────────────────────────

const BASE_URL = 'https://server-api.growatt.com/';

// ─── Growatt status mapping ───────────────────────────────────────────────

/**
 * Growatt deviceStatus integer → NormalizedStatus.
 *
 * Confirmed from real API responses (2026-05-23):
 *   1 = Normal/Active (inverter producing)
 *   5 = Offline/Disconnected (lost=true, power='0')
 *   3 = Fault
 *   All other values treated as unknown (null).
 *
 * Note: The legacy API uses integer 5 for "offline" (not 3 as in some docs).
 */
const GROWATT_STATUS_MAP: Record<number, NormalizedStatus> = {
  1: 'active',
  3: 'fault',
  5: 'offline',
};

function mapGrowattStatus(deviceStatus: number | null | undefined): NormalizedStatus | null {
  if (deviceStatus == null) return null;
  return GROWATT_STATUS_MAP[deviceStatus] ?? null;
}

// ─── Password hashing ─────────────────────────────────────────────────────

/**
 * Growatt's modified MD5 password hash.
 *
 * Algorithm (from growattServer Python library's hash_password function):
 *   1. MD5 hex digest of the UTF-8 encoded password
 *   2. For every even position i (0, 2, 4, ...) where md5[i] === '0',
 *      replace it with 'c'
 *
 * This is NOT a simple MD5. Failing to apply the substitution causes
 * "Username or Password Error" even with correct credentials.
 */
function hashGrowattPassword(password: string): string {
  let md5 = createHash('md5').update(password, 'utf8').digest('hex');
  for (let i = 0; i < md5.length; i += 2) {
    if (md5[i] === '0') {
      md5 = md5.slice(0, i) + 'c' + md5.slice(i + 1);
    }
  }
  return md5;
}

// ─── Cookie handling ──────────────────────────────────────────────────────

/**
 * Extract cookie name=value pairs from Set-Cookie response headers.
 *
 * fetch's Headers.getSetCookie() returns each Set-Cookie header as a string
 * like 'JSESSIONID=ABC123; Path=/; HttpOnly'. We only want the name=value
 * portion before the first ';'.
 *
 * Falls back to parsing the combined 'set-cookie' header string if
 * getSetCookie() is not available (Node <18.14).
 */
function extractCookies(headers: Headers): string {
  const cookies: string[] = [];

  // Modern Node / fetch API: getSetCookie() returns each Set-Cookie as its own string
  if (typeof headers.getSetCookie === 'function') {
    for (const raw of headers.getSetCookie()) {
      const pair = (raw.split(';')[0] ?? '').trim();
      if (pair) cookies.push(pair);
    }
  } else {
    // Fallback: parse the combined set-cookie header value
    // In vitest's mock, headers may return all Set-Cookie joined with ', '
    const raw = headers.get('set-cookie') ?? headers.get('Set-Cookie') ?? '';
    if (raw) {
      // Split on ', ' between cookie entries (crude but adequate for our cookies)
      for (const segment of raw.split(/,\s*(?=[A-Za-z_])/)) {
        const pair = (segment.split(';')[0] ?? '').trim();
        if (pair) cookies.push(pair);
      }
    }
  }

  return cookies.join('; ');
}

// ─── Internal API calls ───────────────────────────────────────────────────

interface GrowattLoginResult {
  userId: number;
  cookieHeader: string;
}

async function growattLogin(username: string, password: string): Promise<GrowattLoginResult> {
  const op = '[growattAdapter.login]';
  const hashedPassword = hashGrowattPassword(password);

  const body = new URLSearchParams();
  body.set('userName', username);
  body.set('password', hashedPassword);

  const response = await fetch(`${BASE_URL}newTwoLoginAPI.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const cookieHeader = extractCookies(response.headers);

  const json = await response.json() as { back: { success: boolean; user?: { id: number }; msg?: string; error?: string } };
  const back = json.back;

  if (!back.success) {
    const errMsg = back.msg ?? back.error ?? 'Login failed';
    console.error(`${op} login failed: ${errMsg}`, { username, timestamp: new Date().toISOString() });
    throw new AdapterError('growatt', `Growatt login failed: ${errMsg}`);
  }

  const userId = back.user!.id;
  return { userId, cookieHeader };
}

interface GrowattPlantSummary {
  plantId: string;
  plantName: string;
}

async function growattGetPlantList(userId: number, cookieHeader: string): Promise<GrowattPlantSummary[]> {
  const response = await fetch(`${BASE_URL}PlantListAPI.do?userId=${userId}`, {
    method: 'GET',
    headers: {
      Cookie: cookieHeader,
    },
  });

  const json = await response.json() as { back: { success: boolean; data?: GrowattPlantSummary[] } };
  return json.back?.data ?? [];
}

interface GrowattDevice {
  deviceSn: string;
  deviceStatus: number;
  power: string;
  eToday: string;
  energy: string;
  deviceType?: string;
  lost?: boolean;
  [key: string]: unknown;
}

async function growattGetDeviceList(plantId: string, cookieHeader: string): Promise<GrowattDevice[]> {
  const url = `${BASE_URL}newTwoPlantAPI.do?op=getAllDeviceList&plantId=${plantId}&language=1`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Cookie: cookieHeader,
    },
  });

  const json = await response.json() as { deviceList?: GrowattDevice[] };
  return json.deviceList ?? [];
}

// ─── Adapter implementation ───────────────────────────────────────────────

export const growattAdapter: InverterAdapter = {
  brand: 'growatt',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[growattAdapter.fetchReadings]';

    // ── 1. Credential validation ───────────────────────────────────────
    if (!input.credentials.username) {
      throw new InvalidCredentialsError('growatt', 'username');
    }
    if (!input.credentials.password) {
      throw new InvalidCredentialsError('growatt', 'password');
    }
    if (!input.monitoring_site_id) {
      throw new InvalidCredentialsError('growatt', 'monitoring_site_id');
    }
    if (!input.monitoring_device_id) {
      throw new InvalidCredentialsError('growatt', 'monitoring_device_id');
    }

    // ── 2. Synthetic mode ──────────────────────────────────────────────
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      console.log(`${op} synthetic mode — returning 1 reading`);
      const ratedCapacity = Number(input.credentials.rated_capacity_kw ?? '5');
      return {
        readings: [syntheticReading(ratedCapacity)],
        string_readings: [],
      };
    }

    // ── 3. Login (per-customer auth) ───────────────────────────────────
    // NOTE: See TODO(phase-8-session-cache) at the top of this file.
    // Each call does a fresh login. Phase 8 will cache cookies per username.
    const { userId, cookieHeader } = await growattLogin(
      input.credentials.username,
      input.credentials.password,
    );

    // ── 4. Plant list sanity check ─────────────────────────────────────
    const plants = await growattGetPlantList(userId, cookieHeader);
    const plantIds = plants.map(p => p.plantId);
    if (!plantIds.includes(input.monitoring_site_id)) {
      // Log but don't fail — the plant may still be accessible
      console.warn(
        `${op} requested plant ${input.monitoring_site_id} not in plant list [${plantIds.join(', ')}]`,
        { username: input.credentials.username, timestamp: new Date().toISOString() },
      );
    }

    // ── 5. Device list for the plant ──────────────────────────────────
    const devices = await growattGetDeviceList(input.monitoring_site_id, cookieHeader);

    const device = devices.find(d => d.deviceSn === input.monitoring_device_id);
    if (!device) {
      console.error(
        `${op} device ${input.monitoring_device_id} not found in plant ${input.monitoring_site_id}`,
        {
          availableDevices: devices.map(d => d.deviceSn),
          timestamp: new Date().toISOString(),
        },
      );
      throw new AdapterError(
        'growatt',
        `Device ${input.monitoring_device_id} not found in plant ${input.monitoring_site_id}`,
      );
    }

    // ── 6. Normalize ───────────────────────────────────────────────────
    // power: string of watts (e.g., '500' = 500W = 0.5kW). '0' when offline.
    const acPowerKw = parseFloat(device.power) / 1000;
    // eToday: already in kWh as a string (e.g., '5.2')
    const energyTodayKwh = parseFloat(device.eToday);
    // energy: total lifetime energy in kWh as a string (e.g., '12225.9')
    const energyTotalKwh = parseFloat(device.energy);
    // deviceStatus: integer (1=active, 3=fault, 5=offline)
    const status = mapGrowattStatus(device.deviceStatus);

    const reading = {
      recorded_at: new Date().toISOString(),
      ac_power_kw: isNaN(acPowerKw) ? null : acPowerKw,
      dc_power_kw: null, // not exposed by the legacy API
      ac_voltage_v: null, // not exposed by this endpoint
      ac_current_a: null, // not exposed by this endpoint
      ac_frequency_hz: null, // not exposed by this endpoint
      temperature_c: null, // not exposed by this endpoint
      energy_today_kwh: isNaN(energyTodayKwh) ? null : energyTodayKwh,
      energy_total_kwh: isNaN(energyTotalKwh) ? null : energyTotalKwh,
      status,
      error_code: null,
      raw_payload: device as unknown as Record<string, unknown>,
    };

    return { readings: [reading], string_readings: [] };
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    const op = '[growattAdapter.healthCheck]';

    if (!credentials.username) {
      return { ok: false, message: 'Missing username or password' };
    }
    if (!credentials.password) {
      return { ok: false, message: 'Missing username or password' };
    }

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode', vendor_api_version: 'synthetic' };
    }

    try {
      const { userId, cookieHeader } = await growattLogin(credentials.username, credentials.password);
      const plants = await growattGetPlantList(userId, cookieHeader);
      const plantCount = plants.length;
      return {
        ok: true,
        message: `${plantCount} plant${plantCount === 1 ? '' : 's'} visible`,
        vendor_api_version: 'legacy server-api',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${op} health check failed`, { error: err, timestamp: new Date().toISOString() });
      return { ok: false, message: msg };
    }
  },
};

export { mapGrowattStatus };
