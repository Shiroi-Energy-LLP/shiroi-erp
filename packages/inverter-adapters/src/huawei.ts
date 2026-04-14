/**
 * Huawei FusionSolar NetEco adapter.
 *
 * Status: STUB. Medium priority — Huawei has a growing market share
 * in India's C&I segment. Will be wired up if/when the first project
 * with a Huawei inverter is commissioned.
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

export const huaweiAdapter: InverterAdapter = {
  brand: 'huawei',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    if (!input.credentials.username || !input.credentials.password) {
      throw new InvalidCredentialsError('huawei', 'username/password');
    }

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      const ratedCapacity = Number(input.credentials.rated_capacity_kw ?? '5');
      return {
        readings: [syntheticReading(ratedCapacity)],
        string_readings: [],
      };
    }

    throw new NotImplementedError('huawei', 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.username || !credentials.password) {
      return { ok: false, message: 'Missing username or password' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed' };
    }
    return { ok: false, message: 'Huawei adapter not yet implemented' };
  },
};
