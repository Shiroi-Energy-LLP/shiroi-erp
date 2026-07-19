/**
 * Deye Cloud OpenAPI (v1.0) adapter.
 *
 * Deye migrated off the Solarman white-label onto its own first-party cloud +
 * OpenAPI (2024). This adapter replaces the old `solarman` stub. ONE developer
 * account authenticates, then polls every plant by device serial — there are no
 * per-plant credentials (unlike the portal-login model).
 *
 * Auth flow (probed live 2026-06-19; region india-developer.deyecloud.com/v1.0):
 *   1. POST /account/token?appId=<id>
 *        body { appSecret, email, password: SHA256-hex(password), companyId }
 *        → { success, accessToken }            companyId "0" = personal user;
 *          the real companyId (from /account/info → orgInfoList[].companyId)
 *          selects the business/organization context. Shiroi business = 2592.
 *      NOTE: a bad appId/secret still returns HTTP 200 with {success:false,msg},
 *      so we validate the body, not just res.ok.
 *   2. The returned JWT is sent as header `Authorization: bearer <jwt>` (lowercase
 *      "bearer") on every subsequent call. The Edge Function logs in once per
 *      poll cycle and reuses the token for every Deye inverter in the batch —
 *      same caching pattern as Sungrow/FIMER, injected as creds.oauth_token.
 *
 * Telemetry (POST /device/latest, body {deviceList:[sn,...]}, ≤10 serials/call):
 *   → { deviceDataList: [ { deviceSn, deviceType, deviceState, collectionTime,
 *        dataList: [ { key, value, unit }, ... ] } ] }
 *   monitoring_device_id holds the INVERTER serial (the COLLECTOR/logger serial
 *   is the datalogger — it carries no generation telemetry).
 *
 * Discovery (POST /station/listWithDevice, ≤50/page) returns stations with their
 * deviceListItems (deviceSn + deviceType) — used by the backfill script to seed
 * the `inverters` table once plants are migrated into the Deye account.
 *
 * The bind/create side is NOT in the OpenAPI (read-only surface) — plants are
 * added to the account via the Deye app migration / web-portal batch-import.
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  AdapterError,
  NormalizedReading,
  NormalizedStringReading,
  NormalizedStatus,
  syntheticReading,
} from './base';

// ═══════════════════════════════════════════════════════════════════════
// Constants — India data center serves EU/Asia-Pacific accounts (eu1/us1
// reject the India-registered appId with "auth invalid appId").
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_API_BASE = 'https://india-developer.deyecloud.com/v1.0';
const MAX_DEVICES_PER_CALL = 10;

// ═══════════════════════════════════════════════════════════════════════
// Vendor response shapes
// ═══════════════════════════════════════════════════════════════════════

export interface DeyeMeasure {
  key: string;
  value: string;
  unit?: string;
}

export interface DeyeDeviceData {
  deviceSn: string;
  deviceType: string; // 'INVERTER' | 'COLLECTOR' | ...
  deviceState: number; // 1 = online/normal
  collectionTime: number; // unix seconds
  dataList: DeyeMeasure[];
}

export interface DeyeStationDevice {
  deviceSn: string;
  deviceId?: number;
  deviceType: string;
  connectStatus?: number;
  [k: string]: unknown;
}

export interface DeyeStationWithDevices {
  id: number;
  name: string;
  installedCapacity?: number;
  type?: string;
  regionTimezone?: string;
  deviceTotal?: number;
  deviceListItems?: DeyeStationDevice[];
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════
// Low-level HTTP
// ═══════════════════════════════════════════════════════════════════════

async function sha256hex(input: string): Promise<string> {
  // Web Crypto — available in Node 18+ and the Supabase (Deno) Edge runtime,
  // so the same adapter works in tests, scripts, and the Edge Function.
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deyePost<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `bearer ${token}`;
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AdapterError('deye', `HTTP ${res.status} from ${path}`, {
      httpStatus: res.status,
      payloadExcerpt: text.slice(0, 200),
    });
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new AdapterError('deye', `Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
  const env = json as { success?: boolean; msg?: string; code?: string };
  // Deye returns HTTP 200 + {success:false} for auth/permission errors.
  if (env.success === false) {
    throw new AdapterError('deye', `${path} failed: ${env.msg ?? env.code ?? 'unknown error'}`, {
      payloadExcerpt: text.slice(0, 200),
    });
  }
  return json as T;
}

// ═══════════════════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════════════════

export interface DeyeAuthInput {
  appId: string;
  appSecret: string;
  email: string;
  password: string; // plaintext; SHA-256 hashed before sending
  companyId?: string; // "0" personal (default); real companyId for business context
  apiBase?: string;
}

/**
 * POST /account/token?appId=<id> — exchanges developer creds for a JWT.
 * Returns the bare token string (sent as `Authorization: bearer <jwt>` later).
 */
export async function deyeAuthenticate(input: DeyeAuthInput): Promise<string> {
  const base = (input.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const body = {
    appSecret: input.appSecret,
    email: input.email,
    password: await sha256hex(input.password),
    companyId: input.companyId ?? '0',
  };
  const json = await deyePost<{ accessToken?: string; token?: string }>(
    base,
    `/account/token?appId=${encodeURIComponent(input.appId)}`,
    body,
  );
  const token = json.accessToken ?? json.token;
  if (!token || typeof token !== 'string') {
    throw new AdapterError('deye', 'Authenticate succeeded but no accessToken in body');
  }
  return token;
}

/**
 * POST /account/info — returns the org list; first companyId is the business
 * context. Used by the backfill script to switch from personal → business.
 */
export async function deyeFetchCompanyId(base: string, token: string): Promise<number | null> {
  const json = await deyePost<{ orgInfoList?: Array<{ companyId?: number }> }>(base, '/account/info', {}, token);
  return json.orgInfoList?.[0]?.companyId ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// Discovery + telemetry helpers (reused by the backfill / smoke scripts)
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /station/listWithDevice — stations plus their device serials. Page size
 * is capped at 50 by the API. Paginate by incrementing `page`.
 */
export async function deyeListStationsWithDevices(
  base: string,
  token: string,
  page = 1,
  size = 50,
): Promise<{ stations: DeyeStationWithDevices[]; total: number }> {
  const json = await deyePost<{ stationList?: DeyeStationWithDevices[]; stationTotal?: number; total?: number }>(
    base,
    '/station/listWithDevice',
    { page, size: Math.min(size, 50) },
    token,
  );
  return { stations: json.stationList ?? [], total: json.stationTotal ?? json.total ?? 0 };
}

/**
 * POST /device/latest — latest reading for up to 10 device serials per call.
 */
export async function deyeFetchDeviceLatest(
  base: string,
  token: string,
  serials: string[],
): Promise<DeyeDeviceData[]> {
  if (serials.length === 0) return [];
  if (serials.length > MAX_DEVICES_PER_CALL) {
    throw new AdapterError('deye', `device/latest accepts at most ${MAX_DEVICES_PER_CALL} serials per call`);
  }
  const json = await deyePost<{ deviceDataList?: DeyeDeviceData[] }>(base, '/device/latest', { deviceList: serials }, token);
  return Array.isArray(json.deviceDataList) ? json.deviceDataList : [];
}

// ═══════════════════════════════════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════════════════════════════════

function deyeStatus(deviceState: number, acPowerKw: number | null): NormalizedStatus | null {
  // deviceState 1 = online/normal (confirmed live). Other codes aren't fully
  // enumerated, so fall back to power; the raw state is kept in raw_payload for
  // the auto-ticket logic to refine later.
  if (deviceState === 1) return 'active';
  if (deviceState === 0) return 'offline';
  if (acPowerKw == null) return null;
  return acPowerKw > 0.05 ? 'active' : 'offline';
}

/**
 * Map one device's flat key/value dataList → NormalizedReading + per-string
 * readings. `recordedAtIso` is the poll time (matches the FIMER/Sungrow pattern:
 * we stamp poll time and keep the vendor `collectionTime` in raw_payload, so the
 * value always lands in a live monthly partition).
 */
export function deyeReadingFromDeviceData(
  device: DeyeDeviceData,
  recordedAtIso: string,
): { reading: NormalizedReading; strings: NormalizedStringReading[] } {
  const m = new Map<string, string>();
  for (const item of device.dataList ?? []) m.set(item.key, item.value);

  const num = (key: string): number | null => {
    const v = m.get(key);
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const wToKw = (key: string): number | null => {
    const n = num(key);
    return n == null ? null : Number((n / 1000).toFixed(3));
  };

  const acPowerKw = wToKw('TotalActiveACOutputPower');

  // DC power = sum of per-string DCPowerPVn.
  let dcW = 0;
  let dcSeen = false;
  for (let i = 1; i <= 8; i++) {
    const n = num(`DCPowerPV${i}`);
    if (n != null) {
      dcW += n;
      dcSeen = true;
    }
  }
  const dcPowerKw = dcSeen ? Number((dcW / 1000).toFixed(3)) : null;

  const reading: NormalizedReading = {
    recorded_at: recordedAtIso,
    ac_power_kw: acPowerKw,
    dc_power_kw: dcPowerKw,
    ac_voltage_v: num('ACVoltageRUA'),
    ac_current_a: num('ACCurrentRUA'),
    ac_frequency_hz: num('ACOutputFrequencyR'),
    temperature_c: num('RadiatorTemp') ?? num('ACTemperature') ?? num('Temperature'),
    energy_today_kwh: num('DailyActiveProduction'),
    energy_total_kwh: num('TotalActiveProduction'),
    status: deyeStatus(device.deviceState, acPowerKw),
    error_code: null,
    raw_payload: {
      source: 'deye.cloud.v1.0',
      device_sn: device.deviceSn,
      device_type: device.deviceType,
      device_state: device.deviceState,
      collection_time: device.collectionTime,
      rated_power_w: num('RatedPower'),
    },
  };

  const strings: NormalizedStringReading[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = num(`DCVoltagePV${i}`);
    const c = num(`DCCurrentPV${i}`);
    const p = num(`DCPowerPV${i}`);
    if ((v ?? 0) > 0 || (c ?? 0) > 0 || (p ?? 0) > 0) {
      strings.push({
        string_number: i,
        recorded_at: recordedAtIso,
        voltage_v: v,
        current_a: c,
        power_kw: p == null ? null : Number((p / 1000).toFixed(3)),
      });
    }
  }

  return { reading, strings };
}

// ═══════════════════════════════════════════════════════════════════════
// Adapter
// ═══════════════════════════════════════════════════════════════════════

export const deyeAdapter: InverterAdapter = {
  brand: 'deye',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[deyeAdapter.fetchReadings]';
    const creds = input.credentials;

    // The poller acquires the JWT once per cycle and injects it as oauth_token.
    if (!creds['oauth_token']) throw new InvalidCredentialsError('deye', 'oauth_token (Deye Cloud JWT)');
    if (!input.monitoring_device_id) throw new InvalidCredentialsError('deye', 'monitoring_device_id (inverter serial)');

    if (process.env['SYNTHETIC_INVERTER_READINGS'] === '1') {
      const ratedCapacity = Number(creds['rated_capacity_kw'] ?? '5');
      return { readings: [syntheticReading(ratedCapacity)], string_readings: [] };
    }

    const base = (creds['api_base'] as string) ?? DEFAULT_API_BASE;
    const serial = input.monitoring_device_id;

    const devices = await deyeFetchDeviceLatest(base, creds['oauth_token']!, [serial]);
    const device =
      devices.find((d) => d.deviceSn === serial && d.deviceType === 'INVERTER') ??
      devices.find((d) => d.deviceSn === serial) ??
      devices[0];

    if (!device) {
      console.warn(`${op} no device data returned for serial=${serial}`);
      return { readings: [], string_readings: [] };
    }

    const { reading, strings } = deyeReadingFromDeviceData(device, new Date().toISOString());
    return { readings: [reading], string_readings: strings };
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials['app_id']) return { ok: false, message: 'Missing app_id (Deye Cloud AppId)' };
    if (!credentials['api_secret']) return { ok: false, message: 'Missing api_secret (AppSecret)' };
    if (!credentials['username']) return { ok: false, message: 'Missing username (account email)' };
    if (!credentials['password']) return { ok: false, message: 'Missing password (account password)' };

    if (process.env['SYNTHETIC_INVERTER_READINGS'] === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed', vendor_api_version: 'synthetic' };
    }

    try {
      const token = await deyeAuthenticate({
        appId: credentials['app_id']!,
        appSecret: credentials['api_secret']!,
        email: credentials['username']!,
        password: credentials['password']!,
        companyId: credentials['company_id'],
        apiBase: credentials['api_base'],
      });
      return {
        ok: true,
        message: `Authenticated — token=${token.slice(0, 8)}…`,
        vendor_api_version: 'Deye Cloud OpenAPI v1.0',
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
};

// Exported for tests.
export { deyeStatus as _deyeStatus };
