/**
 * Sungrow iSolarCloud adapter — OpenAPI v2.
 *
 * Authentication terminology (Sungrow's own labels are misleading):
 *   - AppKey      → an application identifier; goes in the request BODY
 *                   as `appkey` on every call.
 *   - SecretKey   → the value sent in the `x-access-key` HEADER on every
 *                   call. NOT a body secret. Using AppKey in the header
 *                   yields E912 "Illegal x-access-key".
 *   - Token       → returned by /openapi/login; sent in the `token`
 *                   header on subsequent calls (also in the body as
 *                   `token` for some endpoints).
 *
 * Two auth paths:
 *   1. Direct login — for Shiroi-owned plants (under Manivel's
 *      iSolarCloud account). Username + RSA-encrypted password →
 *      /openapi/login → session token. Used by the poller.
 *   2. OAuth2 redirect — for customer-owned plants. Customer logs in
 *      to iSolarCloud, clicks Allow, iSolarCloud redirects back with
 *      a code → /openapi/apiManage/token → access + refresh tokens.
 *      Used by /api/integrations/sungrow/authorize + /callback.
 *
 * Real-time data shape:
 *   POST /openapi/getDeviceRealTimeData
 *   Headers:  x-access-key: {SecretKey}
 *             token: {sessionToken}
 *   Body:     { appkey, token,
 *               ps_key_list: ["{ps_id}_{device_type}_{device_code}_{chnnl_id}"],
 *               // OR sn_list: ["{device_sn}"],
 *               device_type, point_id_list: [...] }
 *
 *   Response: { result_code: '1',
 *               result_data: {
 *                 device_point_list: [{ device_point: { ...metadata, p83022: '4.8', ... } }],
 *                 fail_ps_key_list: [] } }
 *
 * Point IDs (Sungrow's per-metric identifiers; verified against live SG3.3RS-L
 * 2026-06-05). Full list in iSolarCloud OpenAPI docs §3.6.
 *   p83022 → active_power (kW)
 *   p83025 → today_energy (kWh)
 *   p83033 → total_energy (kWh)
 *   p83020 → dc_power (kW)
 *   p83036 → grid_frequency (Hz)
 *   p83097 → inverter_temperature (°C)
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
import { sungrowRsaEncrypt } from './sungrow-rsa';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_API_BASE = 'https://gateway.isolarcloud.com.hk';

const POINT_ACTIVE_POWER_KW = 'p83022';
const POINT_TODAY_ENERGY_KWH = 'p83025';
const POINT_TOTAL_ENERGY_KWH = 'p83033';
const POINT_DC_POWER_KW = 'p83020';
const POINT_GRID_FREQ_HZ = 'p83036';
const POINT_TEMP_C = 'p83097';

const POINT_IDS = [
  POINT_ACTIVE_POWER_KW,
  POINT_TODAY_ENERGY_KWH,
  POINT_TOTAL_ENERGY_KWH,
  POINT_DC_POWER_KW,
  POINT_GRID_FREQ_HZ,
  POINT_TEMP_C,
];

// Sungrow's `dev_status` enum (NOT device_status) → normalized.
// 1 = running, 2 = fault, 3 = offline/disconnect, 4 = standby/initialization.
const SUNGROW_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': 'active',
  '2': 'fault',
  '3': 'offline',
  '4': 'derated',
  '5': 'derated',
};

export function mapSungrowStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (raw == null || raw === '') return null;
  return SUNGROW_STATUS_MAP[String(raw)] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// Low-level HTTP helper
// ═══════════════════════════════════════════════════════════════════════

interface SungrowEnvelope<T> {
  result_code: string | number;
  result_msg?: string;
  req_serial_num?: string;
  result_data?: T;
}

async function sungrowPost<T>(
  base: string,
  path: string,
  accessKey: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<SungrowEnvelope<T>> {
  const url = `${base.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'x-access-key': accessKey,
    sys_code: '901',
  };
  if (token) headers.token = token;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new AdapterError('sungrow', `HTTP ${res.status} from ${path}`, { httpStatus: res.status });
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as SungrowEnvelope<T>;
  } catch {
    throw new AdapterError('sungrow', `Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Direct-login flow — for Shiroi-owned plants
// ═══════════════════════════════════════════════════════════════════════

export interface DirectLoginInput {
  /** Application appkey — sent in body. */
  appkey: string;
  /** Application SecretKey — sent in x-access-key header. */
  accessKey: string;
  /** Sungrow RSA public key (SPKI base64). */
  rsaPublicKey: string;
  /** iSolarCloud account username (email). */
  username: string;
  /** iSolarCloud account password — plaintext; will be RSA-encrypted before sending. */
  password: string;
  apiBase?: string;
}

export interface DirectLoginResult {
  token: string;
  user_id: string;
  /** Token lifetime in seconds, if returned. */
  expires_in?: number;
}

/**
 * POST /openapi/login — direct username+password login. Returns a session
 * token usable in the `token` header on subsequent calls.
 *
 * Token validity is in hours; cache it per poll cycle rather than logging
 * in for every inverter.
 */
export async function sungrowDirectLogin(input: DirectLoginInput): Promise<DirectLoginResult> {
  const base = (input.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const encryptedPassword = await sungrowRsaEncrypt(input.password, input.rsaPublicKey);
  const body = await sungrowPost<{
    token?: string;
    user_id?: string | number;
    expires_in?: number;
  }>(base, '/openapi/login', input.accessKey, {
    appkey: input.appkey,
    user_account: input.username,
    user_password: encryptedPassword,
    login_type: '1',
    sys_code: '901',
  });

  if (String(body.result_code) !== '1') {
    throw new AdapterError(
      'sungrow',
      `Login failed: ${body.result_msg ?? `result_code=${body.result_code}`}`,
    );
  }
  const data = body.result_data;
  if (!data?.token) {
    throw new AdapterError('sungrow', 'Login succeeded but no token returned');
  }
  return {
    token: data.token,
    user_id: String(data.user_id ?? ''),
    expires_in: data.expires_in,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Discovery helpers
// ═══════════════════════════════════════════════════════════════════════

export interface SungrowPlant {
  ps_id: number | string;
  ps_name?: string;
  ps_location?: string;
  ps_capacity_kwp?: number | string;
  install_date?: string;
  [k: string]: unknown;
}

export interface SungrowDevice {
  ps_id: number | string;
  ps_key: string;
  device_sn: string;
  device_type: number;
  device_code?: number;
  device_model_code?: string;
  device_name?: string;
  dev_status?: string | number;
  uuid?: number;
  communication_dev_sn?: string;
  [k: string]: unknown;
}

export interface DiscoveryAuth {
  appkey: string;
  accessKey: string;
  token: string;
  apiBase?: string;
}

export async function sungrowListPlants(auth: DiscoveryAuth): Promise<SungrowPlant[]> {
  const base = (auth.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const all: SungrowPlant[] = [];
  let curPage = 1;
  while (true) {
    const body = await sungrowPost<{
      pageList?: SungrowPlant[];
      rowCount?: number;
    }>(base, '/openapi/getPowerStationList', auth.accessKey, {
      appkey: auth.appkey,
      token: auth.token,
      curPage,
      size: 100,
    }, auth.token);

    if (String(body.result_code) !== '1') {
      throw new AdapterError('sungrow', `getPowerStationList failed: ${body.result_msg ?? body.result_code}`);
    }
    const page = body.result_data?.pageList ?? [];
    all.push(...page);
    if (page.length < 100) break;
    curPage += 1;
    if (curPage > 50) break; // safety
  }
  return all;
}

export async function sungrowListDevices(
  auth: DiscoveryAuth,
  psId: string | number,
): Promise<SungrowDevice[]> {
  const base = (auth.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const body = await sungrowPost<{
    pageList?: SungrowDevice[];
  }>(base, '/openapi/getDeviceList', auth.accessKey, {
    appkey: auth.appkey,
    token: auth.token,
    ps_id: psId,
    curPage: 1,
    size: 200,
  }, auth.token);

  if (String(body.result_code) !== '1') {
    throw new AdapterError('sungrow', `getDeviceList failed: ${body.result_msg ?? body.result_code}`);
  }
  return body.result_data?.pageList ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// Adapter — fetchReadings + healthCheck
// ═══════════════════════════════════════════════════════════════════════

interface DevicePoint {
  device_point?: Record<string, unknown>;
  [k: string]: unknown;
}

function toNumOrNull(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sungrow's `device_time` field is "YYYYMMDDHHmmss" in plant-local time (IST
 * for Shiroi). Convert → ISO UTC.
 */
function parseDeviceTime(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length !== 14) return new Date().toISOString();
  const y = raw.slice(0, 4);
  const mo = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const h = raw.slice(8, 10);
  const mi = raw.slice(10, 12);
  const s = raw.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`).toISOString();
}

export const sungrowAdapter: InverterAdapter = {
  brand: 'sungrow',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[sungrowAdapter.fetchReadings]';
    const creds = input.credentials;

    // ── Credential validation ──────────────────────────────────────────
    if (!creds.appkey) throw new InvalidCredentialsError('sungrow', 'appkey');
    if (!creds.access_key) throw new InvalidCredentialsError('sungrow', 'access_key');
    if (!creds.oauth_token) throw new InvalidCredentialsError('sungrow', 'oauth_token');
    if (!input.monitoring_site_id) throw new InvalidCredentialsError('sungrow', 'monitoring_site_id');
    if (!input.monitoring_device_id) throw new InvalidCredentialsError('sungrow', 'monitoring_device_id');

    // ── Synthetic mode ─────────────────────────────────────────────────
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      const ratedCapacity = Number(creds.rated_capacity_kw ?? '5');
      return { readings: [syntheticReading(ratedCapacity)], string_readings: [] };
    }

    // ── Real API call ──────────────────────────────────────────────────
    const base = (creds.api_base ?? DEFAULT_API_BASE).replace(/\/$/, '');
    // monitoring_device_id stores Sungrow's ps_key (`{ps_id}_{type}_{code}_{chnnl_id}`)
    // rather than the bare serial — the API matches on ps_key. We accept either form
    // and let the API resolve via sn_list as a fallback.
    const looksLikePsKey = input.monitoring_device_id.includes('_');
    const body = await sungrowPost<{
      device_point_list?: DevicePoint[];
      fail_ps_key_list?: string[];
    }>(base, '/openapi/getDeviceRealTimeData', creds.access_key, {
      appkey: creds.appkey,
      token: creds.oauth_token,
      ps_key_list: looksLikePsKey ? [input.monitoring_device_id] : undefined,
      sn_list: looksLikePsKey ? undefined : [input.monitoring_device_id],
      device_type: Number(creds.device_type ?? '1'),
      point_id_list: POINT_IDS,
    }, creds.oauth_token);

    if (String(body.result_code) !== '1') {
      throw new AdapterError(
        'sungrow',
        body.result_msg ?? `result_code ${body.result_code}`,
      );
    }
    const list = body.result_data?.device_point_list ?? [];
    const fail = body.result_data?.fail_ps_key_list ?? [];
    if (fail.length > 0 || list.length === 0) {
      console.warn(`${op} no data for ${input.monitoring_device_id}; fail=${JSON.stringify(fail)}`);
      return { readings: [], string_readings: [] };
    }

    const point = list[0]?.device_point ?? {};
    const reading: NormalizedReading = {
      recorded_at: parseDeviceTime(point['device_time']),
      ac_power_kw: toNumOrNull(point[POINT_ACTIVE_POWER_KW]),
      dc_power_kw: toNumOrNull(point[POINT_DC_POWER_KW]),
      ac_voltage_v: null, // not requested — would need separate point
      ac_current_a: null,
      ac_frequency_hz: toNumOrNull(point[POINT_GRID_FREQ_HZ]),
      temperature_c: toNumOrNull(point[POINT_TEMP_C]),
      energy_today_kwh: toNumOrNull(point[POINT_TODAY_ENERGY_KWH]),
      energy_total_kwh: toNumOrNull(point[POINT_TOTAL_ENERGY_KWH]),
      status: mapSungrowStatus(
        point['dev_status'] != null ? String(point['dev_status']) : undefined,
      ),
      error_code: point['dev_fault_status'] != null ? String(point['dev_fault_status']) : null,
      raw_payload: point,
    };
    return { readings: [reading], string_readings: [] };
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.appkey) return { ok: false, message: 'Missing appkey' };
    if (!credentials.access_key) return { ok: false, message: 'Missing access_key (Sungrow SecretKey)' };
    if (!credentials.oauth_token) return { ok: false, message: 'Missing oauth_token — log in first' };

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed', vendor_api_version: 'synthetic' };
    }

    const base = (credentials.api_base ?? DEFAULT_API_BASE).replace(/\/$/, '');
    try {
      const body = await sungrowPost<{ rowCount?: number; pageList?: unknown[] }>(
        base,
        '/openapi/getPowerStationList',
        credentials.access_key,
        { appkey: credentials.appkey, token: credentials.oauth_token, curPage: 1, size: 1 },
        credentials.oauth_token,
      );
      if (String(body.result_code) !== '1') {
        return { ok: false, message: body.result_msg ?? `result_code=${body.result_code}` };
      }
      const count = body.result_data?.rowCount ?? '?';
      return { ok: true, message: `Connected — ${count} plant(s)`, vendor_api_version: 'iSolarCloud OpenAPI v2' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  },
};
