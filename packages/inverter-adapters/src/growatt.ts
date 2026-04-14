/**
 * Growatt Server API adapter.
 *
 * Status: STUB pending API registration with Growatt India.
 *
 * API reference (once credentials land):
 *   https://server.growatt.com (Growatt ShinePhone Open API)
 *   Auth: username + MD5(password) → POST /newTwoLoginAPI.do → session cookie
 *   Plant list: GET /newPlantAPI.do?op=getUserPlantList
 *   Device list: GET /newPlantListAPI.do?op=getPlantListOfUser
 *   Real-time: GET /newInverterAPI.do?op=getInverterData&invId=<sn>
 *
 * Rate limit: 6 req/sec per account. Growatt is the strictest of the
 * major vendors so the poller will throttle per-account.
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  NotImplementedError,
  NormalizedStatus,
  syntheticReading,
} from './base';

// Growatt inverter status → our normalized enum.
// Source: ShinePhone API docs.
const GROWATT_STATUS_MAP: Record<string, NormalizedStatus> = {
  '0': 'offline',  // Waiting
  '1': 'active',   // Normal
  '2': 'fault',    // Fault
  '3': 'offline',  // Disconnect
  '4': 'derated',  // Storage battery mode
  '5': 'derated',  // Self-consumption
};

function mapGrowattStatus(raw: string | null | undefined): NormalizedStatus | null {
  if (!raw) return null;
  return GROWATT_STATUS_MAP[String(raw)] ?? null;
}

export const growattAdapter: InverterAdapter = {
  brand: 'growatt',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    const op = '[growattAdapter.fetchReadings]';

    if (!input.credentials.username) {
      throw new InvalidCredentialsError('growatt', 'username');
    }
    if (!input.credentials.password) {
      throw new InvalidCredentialsError('growatt', 'password');
    }
    if (!input.monitoring_device_id) {
      throw new InvalidCredentialsError('growatt', 'monitoring_device_id');
    }

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      console.log(`${op} synthetic mode — returning 1 reading`);
      const ratedCapacity = Number(input.credentials.rated_capacity_kw ?? '5');
      return {
        readings: [syntheticReading(ratedCapacity)],
        string_readings: [],
      };
    }

    // TODO(growatt-api): implement real HTTP calls
    throw new NotImplementedError('growatt', 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.username || !credentials.password) {
      return { ok: false, message: 'Missing username or password' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed', vendor_api_version: 'synthetic' };
    }
    return {
      ok: false,
      message: 'Growatt adapter not yet implemented — API registration pending',
    };
  },
};

export { mapGrowattStatus };
