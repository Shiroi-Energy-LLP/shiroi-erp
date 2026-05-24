/**
 * SolarMan / Deye adapter.
 *
 * Status: STUB — paid Basic plan email sent 2026-05-23, awaiting App ID,
 * App Secret, and Org ID from customerservice@solarmanpv.com (~1 week
 * after payment confirms).
 *
 * Endpoint reference (once credentials arrive):
 *   POST /account/v1.0/token  — login: appId + appSecret + sha256(password) + email
 *   POST /business/v1.0/plant/list — enumerate plants visible to org
 *   POST /device/v1.0/realtime — realtime reading per device sn
 *
 * Rate limit: 5M calls/year on Basic plan = ~13,700/day. 70 plants × 96 polls
 * × 1.5 calls = 10,080/day. Comfortable.
 */
import {
  AdapterFetchInput,
  AdapterFetchResult,
  AdapterHealthCheckResult,
  AdapterCredentials,
  InverterAdapter,
  InvalidCredentialsError,
  NotImplementedError,
  syntheticReading,
} from './base';

export const solarmanAdapter: InverterAdapter = {
  brand: 'solarman',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    if (!input.credentials.api_key) {
      throw new InvalidCredentialsError('solarman', 'api_key (SolarMan App ID)');
    }
    if (!input.credentials.api_secret) {
      throw new InvalidCredentialsError('solarman', 'api_secret (SolarMan App Secret)');
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return {
        readings: [syntheticReading(Number(input.credentials.rated_capacity_kw ?? '5'))],
        string_readings: [],
      };
    }
    throw new NotImplementedError('solarman', 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.api_key || !credentials.api_secret) {
      return {
        ok: false,
        message: 'SolarMan paid Basic plan not yet activated — App ID + Secret pending',
      };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode', vendor_api_version: 'synthetic' };
    }
    return {
      ok: false,
      message: 'SolarMan adapter not yet implemented — API keys pending',
    };
  },
};
