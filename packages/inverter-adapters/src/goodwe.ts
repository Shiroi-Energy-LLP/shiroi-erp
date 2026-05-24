/**
 * Goodwe SEMS Portal adapter.
 *
 * Status: STUB — email sent to Goodwe India sales requesting SEMS Portal
 * API access. No self-serve developer portal exists; approval typically
 * takes 2-6 weeks.
 *
 * Endpoint reference (once access is granted):
 *   POST https://www.semsportal.com/api/v1/Common/CrossLogin — account login
 *   POST https://www.semsportal.com/api/v1/PowerStation/GetMonitorDetailByPowerstationId
 *     — realtime readings per plant
 *
 * Auth: account-based (username + password). The login response returns a
 * token used as a Bearer header on subsequent requests.
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

export const goodweAdapter: InverterAdapter = {
  brand: 'goodwe',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    if (!input.credentials.username) {
      throw new InvalidCredentialsError('goodwe', 'username (Goodwe SEMS account email)');
    }
    if (!input.credentials.password) {
      throw new InvalidCredentialsError('goodwe', 'password (Goodwe SEMS account password)');
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return {
        readings: [syntheticReading(Number(input.credentials.rated_capacity_kw ?? '5'))],
        string_readings: [],
      };
    }
    throw new NotImplementedError('goodwe', 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.username || !credentials.password) {
      return {
        ok: false,
        message: 'Goodwe SEMS Portal API access pending — awaiting Goodwe India response',
      };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode', vendor_api_version: 'synthetic' };
    }
    return {
      ok: false,
      message: 'Goodwe adapter not yet implemented — SEMS Portal API access pending from Goodwe India',
    };
  },
};
