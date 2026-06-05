/**
 * FIMER / ABB Aurora Vision adapter — REST API v1.
 *
 * Auth flow (single, well-documented at https://documentation.auroravision.net):
 *   1. GET /api/rest/authenticate
 *      Headers: Authorization: Basic base64(user:pass)
 *                X-AuroraVision-ApiKey: <UUID-style key>
 *      → { result: "<token>" }
 *   2. Token used as X-AuroraVision-Token on subsequent calls.
 *   3. Token expires after 60 minutes of inactivity — same caching pattern as Sungrow:
 *      the Edge Function logs in once per poll cycle and reuses the token for every
 *      FIMER inverter in the batch.
 *
 * Telemetry endpoints we use:
 *   GET /api/rest/v1/stats/power/aggregated/{entityID}/GenerationPower/average
 *       ?startDate=YYYYMMDD&endDate=YYYYMMDD&timeZone=Asia/Kolkata
 *     → { result: { units: "watts", value: 7164.9 } }      (avg over window)
 *   GET /api/rest/v1/plant/{entityID}/dailyProduction
 *       ?startDate=YYYYMMDD&endDate=YYYYMMDD
 *     → { result: { plantEntityID, dailyValues: [{date, value}, ...] } }   (value in kWh)
 *   GET /api/rest/v1/device/?serialNumber=<sn>
 *     → device record incl. entityID — used by the seed script to backfill EIDs.
 *
 * Aurora Vision returns 403 (not 404) when the entityID is not owned by the
 * authenticated account, so a 403 means "wrong key for this plant," not "broken."
 *
 * monitoring_site_id holds the plant entityID; monitoring_device_id is unused
 * (FIMER's REST data is plant-level, not per-device, for the metrics we surface).
 *
 * Probe 2026-06-05: 7/7 user-provided keys authenticate cleanly; Schangalaya_25
 * (eid 20030256) producing 7.16 kW with daily energy 95-102 kWh/day.
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
  NormalizedStatus,
  syntheticReading,
} from './base';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_API_BASE = 'https://api.auroravision.net/api/rest';
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

// ═══════════════════════════════════════════════════════════════════════
// Low-level HTTP
// ═══════════════════════════════════════════════════════════════════════

interface FimerEnvelope<T> {
  result?: T;
  // Aurora Vision is consistent: success uses `result`; errors return JSON with
  // an error object or an empty body with non-200 status.
  [k: string]: unknown;
}

async function fimerGet<T>(
  base: string,
  path: string,
  apiKey: string,
  token: string,
): Promise<FimerEnvelope<T>> {
  const url = `${base.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-AuroraVision-ApiKey': apiKey,
      'X-AuroraVision-Token': token,
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AdapterError('fimer', `HTTP ${res.status} from ${path}`, {
      httpStatus: res.status,
      payloadExcerpt: text.slice(0, 200),
    });
  }
  if (!text) return {} as FimerEnvelope<T>;
  try {
    return JSON.parse(text) as FimerEnvelope<T>;
  } catch {
    throw new AdapterError('fimer', `Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════════════════

export interface FimerAuthInput {
  apiKey: string;
  username: string;
  password: string;
  apiBase?: string;
}

/**
 * GET /api/rest/authenticate — exchanges Basic Auth + ApiKey for a 60-minute
 * session token. Same lifetime model as Sungrow's session token, so the
 * Edge Function caches per poll cycle.
 */
export async function fimerAuthenticate(input: FimerAuthInput): Promise<string> {
  const base = (input.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const basic = 'Basic ' + Buffer.from(`${input.username}:${input.password}`).toString('base64');
  const res = await fetch(`${base}/authenticate`, {
    method: 'GET',
    headers: {
      Authorization: basic,
      'X-AuroraVision-ApiKey': input.apiKey,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AdapterError('fimer', `Authenticate failed: HTTP ${res.status}`, {
      httpStatus: res.status,
      payloadExcerpt: text.slice(0, 200),
    });
  }
  try {
    const body = JSON.parse(text) as { result?: string };
    if (typeof body.result !== 'string' || body.result.length < 10) {
      throw new AdapterError('fimer', `Authenticate succeeded but no token in body: ${text.slice(0, 200)}`);
    }
    return body.result;
  } catch (e) {
    if (e instanceof AdapterError) throw e;
    throw new AdapterError('fimer', `Authenticate: non-JSON response: ${text.slice(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Discovery helpers (used by the seed script)
// ═══════════════════════════════════════════════════════════════════════

export interface FimerDevice {
  entityID?: string | number;
  serialNumber?: string;
  name?: string;
  deviceType?: string;
  [k: string]: unknown;
}

/**
 * GET /v1/device/?serialNumber=<sn> — used by the seed script to fill the
 * entityID for plants whose Excel EID cell was overwritten with login text.
 */
export async function fimerLookupDeviceBySerial(
  base: string,
  apiKey: string,
  token: string,
  serialNumber: string,
): Promise<FimerDevice | null> {
  const body = await fimerGet<FimerDevice | FimerDevice[]>(
    base,
    `/v1/device/?serialNumber=${encodeURIComponent(serialNumber)}`,
    apiKey,
    token,
  );
  const result = body.result;
  if (Array.isArray(result)) return result[0] ?? null;
  if (result && typeof result === 'object') return result as FimerDevice;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Telemetry helpers — extracted so the seed script can also call them
// ═══════════════════════════════════════════════════════════════════════

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

interface PowerAggregated {
  units?: string;
  value?: number;
}

interface DailyValueRow {
  date: string;     // YYYYMMDD
  value?: string;   // kWh as a stringified number; absent on no-data days
}

interface DailyProduction {
  plantEntityID?: number | string;
  dailyValues?: DailyValueRow[];
}

export async function fimerFetchAveragePowerWatts(
  base: string,
  apiKey: string,
  token: string,
  entityID: string,
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): Promise<number | null> {
  // 3-day window (today and 2 days back). A 1-day window often returns
  // {"units":"watts"} with no value because today's aggregate hasn't been
  // finalized; widening to ~3 days lets the API return a meaningful average
  // while still being recent. (Probe 2026-06-05: 5-day window over
  // Schangalaya_25 returned 7164.9W = 7.16 kW avg.)
  const startDate = yyyymmdd(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));
  const endDate = yyyymmdd(now);
  const path = `/v1/stats/power/aggregated/${encodeURIComponent(entityID)}/GenerationPower/average?startDate=${startDate}&endDate=${endDate}&timeZone=${encodeURIComponent(timeZone)}`;
  const body = await fimerGet<PowerAggregated>(base, path, apiKey, token);
  const r = body.result;
  if (r && typeof r === 'object' && typeof r.value === 'number' && Number.isFinite(r.value)) {
    return r.value;
  }
  return null;
}

export async function fimerFetchTodayEnergyKwh(
  base: string,
  apiKey: string,
  token: string,
  entityID: string,
  now: Date = new Date(),
): Promise<number | null> {
  // Fetch a 3-day window and pick the most recent row with a value. Aurora
  // Vision's `dailyProduction` lags by ~1 day for in-progress days (today's
  // row often has no `value` field), so we fall back to the latest available
  // day to surface SOMETHING useful for the dashboard.
  const today = yyyymmdd(now);
  const startDate = yyyymmdd(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));
  const path = `/v1/plant/${encodeURIComponent(entityID)}/dailyProduction?startDate=${startDate}&endDate=${today}`;
  const body = await fimerGet<DailyProduction>(base, path, apiKey, token);
  const r = body.result;
  if (r && Array.isArray(r.dailyValues)) {
    // Sort descending by date and pick the most recent row with a value
    const candidates = r.dailyValues
      .filter((row) => typeof row.value === 'string' && row.value !== '')
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    for (const row of candidates) {
      const n = Number(row.value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Adapter
// ═══════════════════════════════════════════════════════════════════════

function statusFromPower(powerKw: number | null): NormalizedStatus | null {
  if (powerKw == null) return null;
  // Aurora Vision's aggregated endpoints don't expose a device state enum at
  // plant level, so we infer: producing → active, zero → offline (which is
  // also night). The auto-ticket cron already has dedup windows so spurious
  // night-time "offline" doesn't fire false tickets.
  return powerKw > 0.05 ? 'active' : 'offline';
}

export const fimerAdapter: InverterAdapter = {
  brand: 'fimer',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[fimerAdapter.fetchReadings]';
    const creds = input.credentials;

    if (!creds['api_key']) throw new InvalidCredentialsError('fimer', 'api_key');
    if (!creds['oauth_token']) throw new InvalidCredentialsError('fimer', 'oauth_token');
    if (!input.monitoring_site_id) throw new InvalidCredentialsError('fimer', 'monitoring_site_id');

    if (process.env['SYNTHETIC_INVERTER_READINGS'] === '1') {
      const ratedCapacity = Number(creds['rated_capacity_kw'] ?? '5');
      return { readings: [syntheticReading(ratedCapacity)], string_readings: [] };
    }

    const base = ((creds['api_base'] as string) ?? DEFAULT_API_BASE).replace(/\/$/, '');
    const timeZone = (creds['timezone'] as string) ?? DEFAULT_TIMEZONE;
    const eid = input.monitoring_site_id;

    const [pwrW, energyKwh] = await Promise.all([
      fimerFetchAveragePowerWatts(base, creds['api_key']!, creds['oauth_token']!, eid, timeZone).catch((e) => {
        console.warn(`${op} power fetch failed for eid=${eid}:`, e instanceof Error ? e.message : e);
        return null;
      }),
      fimerFetchTodayEnergyKwh(base, creds['api_key']!, creds['oauth_token']!, eid).catch((e) => {
        console.warn(`${op} energy fetch failed for eid=${eid}:`, e instanceof Error ? e.message : e);
        return null;
      }),
    ]);

    const powerKw = pwrW != null ? Number((pwrW / 1000).toFixed(3)) : null;

    const reading: NormalizedReading = {
      recorded_at: new Date().toISOString(),
      ac_power_kw: powerKw,
      dc_power_kw: null,
      ac_voltage_v: null,
      ac_current_a: null,
      ac_frequency_hz: null,
      temperature_c: null,
      energy_today_kwh: energyKwh,
      energy_total_kwh: null,
      status: statusFromPower(powerKw),
      error_code: null,
      raw_payload: {
        source: 'fimer.auroravision.v1',
        entity_id: eid,
        power_watts_avg: pwrW,
        energy_today_kwh: energyKwh,
      },
    };
    return { readings: [reading], string_readings: [] };
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials['api_key']) return { ok: false, message: 'Missing api_key (X-AuroraVision-ApiKey)' };
    if (!credentials['username']) return { ok: false, message: 'Missing username (portal account)' };
    if (!credentials['password']) return { ok: false, message: 'Missing password (portal account)' };

    if (process.env['SYNTHETIC_INVERTER_READINGS'] === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed', vendor_api_version: 'synthetic' };
    }

    try {
      const token = await fimerAuthenticate({
        apiKey: credentials['api_key']!,
        username: credentials['username']!,
        password: credentials['password']!,
        apiBase: credentials['api_base'],
      });
      return {
        ok: true,
        message: `Authenticated — token=${token.slice(0, 8)}…`,
        vendor_api_version: 'Aurora Vision REST v1',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Status helper exported for tests
// ═══════════════════════════════════════════════════════════════════════

export { statusFromPower as _statusFromPower };
