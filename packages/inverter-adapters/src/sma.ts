/**
 * SMA Sunny Portal / WebConnect adapter.
 *
 * Status: STUB. Low-priority for India deployment (Sungrow + Growatt
 * cover ~90% of projects). Will be wired up if/when SMA inverters are
 * installed.
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

export const smaAdapter: InverterAdapter = {
  brand: 'sma',

  async fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult> {
    if (!input.credentials.username || !input.credentials.password) {
      throw new InvalidCredentialsError('sma', 'username/password');
    }

    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      const ratedCapacity = Number(input.credentials.rated_capacity_kw ?? '5');
      return {
        readings: [syntheticReading(ratedCapacity)],
        string_readings: [],
      };
    }

    throw new NotImplementedError('sma', 'fetchReadings');
  },

  async healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult> {
    if (!credentials.username || !credentials.password) {
      return { ok: false, message: 'Missing username or password' };
    }
    if (process.env.SYNTHETIC_INVERTER_READINGS === '1') {
      return { ok: true, message: 'Synthetic mode — credentials bypassed' };
    }
    return { ok: false, message: 'SMA adapter not yet implemented' };
  },
};
