/**
 * Sungrow iSolarCloud adapter — real implementation.
 *
 * Phase 5 of the inverter integration plan (2026-05-23):
 *   Sungrow approved developer app for Shiroi. Auth is OAuth2:
 *   Manivel's one-time consent → iSolarCloud issues access_token.
 *   Tokens are stored in inverter_monitoring_credentials.config.
 *
 * API: iSolarCloud OpenAPI v2 (gateway.isolarcloud.com.hk)
 *
 * Request shape:
 *   POST /openapi/getDeviceRealTimeData
 *   Headers:
 *     x-access-key: {appkey}
 *     Authorization: Bearer {access_token}
 *   Body:
 *     { ps_id: monitoring_site_id, device_sn_list: [monitoring_device_id] }
 *
 * Response:
 *   { result_code: '1', result_data: { p_array: [ <device rows> ] } }
 *
 * Credentials map (AdapterCredentials → Sungrow):
 *   api_key       = appkey (SUNGROW_APPKEY)
 *   oauth_token   = access_token (stored in config after OAuth flow)
 *   api_base      = SUNGROW_BASE_URL (optional, defaults to gateway.isolarcloud.com.hk)
 *   rated_capacity_kw  = used in synthetic mode
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
// Status mapping
// ═══════════════════════════════════════════════════════════════════════

// The Sungrow device_status enum → our normalized enum.
// Source: iSolarCloud OpenAPI v2 docs "device_status" field.
const SUNGROW_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': 'active',   // Running
  '2': 'fault',    // Fault
  '3': 'offline',  // Disconnected
  '4': 'derated',  // Standby
  '5': 'derated',  // Initialization
};

/**
 * Maps a raw Sungrow device_status string to a NormalizedStatus.
 * Exported for test coverage.
 */
export function mapSungrowStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (!raw) return null;
  return SUNGROW_STATUS_MAP[String(raw)] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// Adapter
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_API_BASE = 'https://gateway.isolarcloud.com.hk';

export const sungrowAdapter: InverterAdapter = {
  brand: 'sungrow',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[sungrowAdapter.fetchReadings]';

    // ── Credential validation ──────────────────────────────────────────
    if (!input.credentials.api_key) {
      throw new InvalidCredentialsError('sungrow', 'api_key');
    }
    if (!input.credentials.oauth_token) {
      throw new InvalidCredentialsError('sungrow', 'oauth_token');
    }
    if (!input.monitoring_site_id) {
      throw new InvalidCredentialsError('sungrow', 'monitoring_site_id');
    }
    if (!input.monitoring_device_id) {
      throw new InvalidCredentialsError('sungrow', 'monitoring_device_id');
    }

    // ── Synthetic mode ─────────────────────────────────────────────────
    // Used when SYNTHETIC_INVERTER_READINGS=1 is set. Returns a plausible
    // reading without hitting the real API, for end-to-end testing before
    // live credentials are fully wired up.
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      console.log(`${op} synthetic mode — returning 1 reading`);
      const ratedCapacity = Number(input.credentials.rated_capacity_kw ?? '5');
      return {
        readings: [syntheticReading(ratedCapacity)],
        string_readings: [],
      };
    }

    // ── Real API path ──────────────────────────────────────────────────
    const base = (input.credentials.api_base ?? DEFAULT_API_BASE).replace(/\/$/, '');
    const url = `${base}/openapi/getDeviceRealTimeData`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': input.credentials.api_key,
          Authorization: `Bearer ${input.credentials.oauth_token}`,
        },
        body: JSON.stringify({
          ps_id: input.monitoring_site_id,
          device_sn_list: [input.monitoring_device_id],
        }),
      });

      if (!res.ok) {
        throw new AdapterError('sungrow', `HTTP ${res.status} from getDeviceRealTimeData`, {
          httpStatus: res.status,
        });
      }

      const body = (await res.json()) as {
        result_code: string | number;
        result_msg?: string;
        result_data?: { p_array?: Array<Record<string, unknown>> };
      };

      if (String(body.result_code) !== '1') {
        throw new AdapterError(
          'sungrow',
          body.result_msg ?? `result_code ${body.result_code}`,
        );
      }

      const arr = body.result_data?.p_array ?? [];

      // The API may return multiple rows if device_sn_list has multiple entries;
      // we requested only one. Find by SN, fall back to first row.
      const row =
        arr.find((r) => String(r['device_sn']) === input.monitoring_device_id) ?? arr[0];

      // Empty p_array means no data available yet for this device.
      if (!row) return { readings: [], string_readings: [] };

      // Parse update_time: Sungrow sends "YYYY-MM-DD HH:MM:SS" (local time,
      // no timezone info). The timestamp is in the timezone of the registered
      // plant location. For Shiroi (India) that is IST = UTC+5:30. We append
      // '+05:30' so JavaScript's Date normalises the offset correctly and
      // .toISOString() returns UTC. Previously '+Z' was appended which made
      // recorded_at 5.5 hours behind the real reading time.
      const updateTimeRaw = typeof row['update_time'] === 'string' ? row['update_time'] : null;
      const recordedAt = updateTimeRaw
        ? new Date(updateTimeRaw.replace(' ', 'T') + '+05:30').toISOString()
        : new Date().toISOString();

      const reading: NormalizedReading = {
        recorded_at: recordedAt,
        ac_power_kw: row['p_kw'] != null ? Number(row['p_kw']) : null,
        dc_power_kw: row['dc_p_kw'] != null ? Number(row['dc_p_kw']) : null,
        ac_voltage_v: row['grid_v'] != null ? Number(row['grid_v']) : null,
        ac_current_a: row['grid_a'] != null ? Number(row['grid_a']) : null,
        ac_frequency_hz: row['grid_freq'] != null ? Number(row['grid_freq']) : null,
        temperature_c: row['t_inverter'] != null ? Number(row['t_inverter']) : null,
        energy_today_kwh: row['today_energy_kwh'] != null ? Number(row['today_energy_kwh']) : null,
        energy_total_kwh: row['total_energy_kwh'] != null ? Number(row['total_energy_kwh']) : null,
        status: mapSungrowStatus(
          row['device_status'] != null ? String(row['device_status']) : undefined,
        ),
        error_code: row['fault_code'] != null ? String(row['fault_code']) : null,
        raw_payload: row,
      };

      return { readings: [reading], string_readings: [] };
    } catch (e) {
      // Re-throw typed adapter errors unchanged.
      if (e instanceof AdapterError || e instanceof InvalidCredentialsError) throw e;

      const message = e instanceof Error ? e.message : String(e);
      console.error(`${op} fetch failed`, {
        ps_id: input.monitoring_site_id,
        device_sn: input.monitoring_device_id,
        error: message,
        timestamp: new Date().toISOString(),
      });
      throw new AdapterError('sungrow', `Network or parsing error: ${message}`);
    }
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    const op = '[sungrowAdapter.healthCheck]';

    // ── Credential sanity checks ───────────────────────────────────────
    if (!credentials.api_key) {
      return { ok: false, message: 'Missing api_key (Sungrow appkey)' };
    }
    if (!credentials.oauth_token) {
      return { ok: false, message: 'Missing oauth_token — re-authorize via the Connect Sungrow button' };
    }

    // ── Synthetic mode bypass ──────────────────────────────────────────
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return {
        ok: true,
        message: 'Synthetic mode — credentials bypassed',
        vendor_api_version: 'synthetic',
      };
    }

    // ── Live API connectivity check ────────────────────────────────────
    // POST getPowerStationList with minimal params as a lightweight ping.
    const base = (credentials.api_base ?? DEFAULT_API_BASE).replace(/\/$/, '');
    const url = `${base}/openapi/getPowerStationList`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': credentials.api_key,
          Authorization: `Bearer ${credentials.oauth_token}`,
        },
        body: JSON.stringify({ curPage: 1, size: 1 }),
      });

      if (!res.ok) {
        return {
          ok: false,
          message: `HTTP ${res.status} from Sungrow getPowerStationList`,
        };
      }

      const json = (await res.json()) as {
        result_code: string | number;
        result_msg?: string;
        result_data?: { row_count?: number };
      };

      if (String(json.result_code) !== '1') {
        return {
          ok: false,
          message: `Sungrow API error: ${json.result_msg ?? `result_code=${json.result_code}`}`,
        };
      }

      const plantCount = json.result_data?.row_count ?? '?';
      return {
        ok: true,
        message: `Connected — ${plantCount} plant(s) accessible`,
        vendor_api_version: 'iSolarCloud OpenAPI v2',
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${op} health check failed`, {
        error: message,
        timestamp: new Date().toISOString(),
      });
      return { ok: false, message: `Health check failed: ${message}` };
    }
  },
};
