/**
 * Sungrow iSolarCloud adapter.
 *
 * Status: STUB pending API registration with Sungrow India.
 *
 * API reference (once credentials land):
 *   https://developer-api.isolarcloud.com
 *   Auth: appkey + secretkey → POST /openapi/login → access_token
 *   Power list: POST /openapi/getRealTimePlantData
 *   Device list: POST /openapi/getDeviceList
 *   Real-time: POST /openapi/getRealTimeData
 *
 * Typical polling cost per inverter: 3 requests (login once per session
 * + getDeviceList cached + getRealTimeData per device). Sungrow rate
 * limit: 60 req/min per account. At 100 inverters across 10 accounts
 * we're well under.
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  NotImplementedError,
  NormalizedReading,
  NormalizedStatus,
  syntheticReading,
} from './base';

// The Sungrow status enum → our normalized enum.
// Source: iSolarCloud API docs "device_status" field.
const SUNGROW_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': 'active',   // Running
  '2': 'fault',    // Fault
  '3': 'offline',  // Disconnected
  '4': 'derated',  // Standby
  '5': 'derated',  // Initialization
};

function mapSungrowStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (!raw) return null;
  return SUNGROW_STATUS_MAP[String(raw)] ?? null;
}

export const sungrowAdapter: InverterAdapter = {
  brand: 'sungrow',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[sungrowAdapter.fetchReadings]';

    // Credential validation
    if (!input.credentials.api_key) {
      throw new InvalidCredentialsError('sungrow', 'api_key');
    }
    if (!input.credentials.api_secret) {
      throw new InvalidCredentialsError('sungrow', 'api_secret');
    }
    if (!input.monitoring_device_id) {
      throw new InvalidCredentialsError('sungrow', 'monitoring_device_id');
    }

    // Synthetic mode: used when SYNTHETIC_INVERTER_READINGS=1 is set in
    // the env. Returns a plausible reading instead of hitting the real
    // API, so the poller + rollups + auto-ticket path can be end-to-end
    // tested before live credentials arrive.
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      console.log(`${op} synthetic mode — returning 1 reading`);
      const ratedCapacity = Number(input.credentials.rated_capacity_kw ?? '5');
      return {
        readings: [syntheticReading(ratedCapacity)],
        string_readings: [],
      };
    }

    // ── Real API path ────────────────────────────────────────────────
    // TODO(sungrow-api): Implement once API registration lands:
    //
    //   1. POST /openapi/login with appkey + secretkey
    //      → access_token (cache for 2h, per-account)
    //   2. POST /openapi/getRealTimeData
    //      { ps_id: monitoring_site_id, device_sn: monitoring_device_id,
    //        _token: access_token }
    //      → realtime dict { p: ac_power_w, daily_generation_kwh, ... }
    //   3. Normalize + return
    //
    // Until then, block so the poller knows to skip us and not silently
    // return []:
    throw new NotImplementedError('sungrow', 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.api_key || !credentials.api_secret) {
      return { ok: false, message: 'Missing api_key or api_secret' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed', vendor_api_version: 'synthetic' };
    }
    // TODO(sungrow-api): Ping /openapi/login and check for a 200.
    return {
      ok: false,
      message: 'Sungrow adapter not yet implemented — API registration pending',
    };
  },
};

/**
 * Export the mapper so tests can exercise it directly.
 * Not part of the InverterAdapter contract.
 */
export { mapSungrowStatus };
