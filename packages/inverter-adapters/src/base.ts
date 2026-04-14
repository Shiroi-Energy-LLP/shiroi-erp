/**
 * Inverter adapter contract. Every vendor (Sungrow, Growatt, SMA, Huawei,
 * Fronius) implements this interface so the poller Edge Function can
 * polymorphically fetch readings without vendor-specific branching.
 *
 * Adapters are STATELESS — they take credentials + an inverter reference
 * on every call. The poller manages the scheduling and persistence; the
 * adapter only knows how to talk to one vendor's API.
 *
 * Design principles:
 *   1. Normalize everything. Vendor-specific field names, units, enums
 *      → NormalizedReading. Anything we can't fit into the common shape
 *      goes into `raw_payload` (JSONB) so it's preserved but doesn't
 *      force schema changes.
 *   2. Fail per-inverter, not per-batch. If one inverter's API call
 *      throws, the adapter surfaces it; the poller logs it to
 *      inverter_poll_failures and moves on.
 *   3. Respect rate limits. Adapters MAY implement internal throttling.
 *      The poller batches 100 inverters/run and runs every 5 min, so
 *      ~2000 req/hour across all vendors is the ceiling.
 *   4. Idempotent. Readings are upserted by (inverter_id, recorded_at),
 *      so replaying a window is safe.
 */

export type InverterBrand =
  | 'sungrow'
  | 'growatt'
  | 'sma'
  | 'huawei'
  | 'fronius';

/**
 * Normalized inverter status — every adapter translates its vendor
 * enum into one of these values. Matches the CHECK constraint on
 * inverter_readings.status.
 */
export type NormalizedStatus = 'active' | 'offline' | 'fault' | 'derated';

/**
 * Normalized reading shape. Units are SI with kilo prefixes so the
 * numbers are small and human-readable:
 *   - power in kW (not W or MW)
 *   - energy in kWh (not Wh)
 *   - voltage in V, current in A, frequency in Hz, temperature in °C
 *
 * All fields are nullable because vendor APIs often omit them. The
 * raw_payload object preserves the vendor's full response for debugging
 * and for fields we don't normalize yet.
 */
export interface NormalizedReading {
  recorded_at: string; // ISO 8601 UTC
  ac_power_kw: number | null;
  dc_power_kw: number | null;
  ac_voltage_v: number | null;
  ac_current_a: number | null;
  ac_frequency_hz: number | null;
  temperature_c: number | null;
  energy_today_kwh: number | null;
  energy_total_kwh: number | null;
  status: NormalizedStatus | null;
  error_code: string | null;
  raw_payload: Record<string, unknown>;
}

/**
 * Per-string reading. Many modern inverters expose 4-20 strings per
 * MPPT input; we persist each individually so the "string imbalance"
 * diagnostic can compare them.
 */
export interface NormalizedStringReading {
  string_number: number;
  recorded_at: string;
  voltage_v: number | null;
  current_a: number | null;
  power_kw: number | null;
}

/**
 * Opaque credential bag passed to every adapter call. The actual shape
 * depends on the vendor — some use API key + secret, some use
 * OAuth2 refresh tokens, some use username/password sessions.
 *
 * The poller reads these from Supabase Vault (via the
 * inverter_monitoring_credentials.vault_secret_ref column). The
 * adapter is responsible for validating that the fields it needs
 * are present and throwing InvalidCredentialsError if not.
 */
export interface AdapterCredentials {
  api_key?: string;
  api_secret?: string;
  username?: string;
  password?: string;
  account_id?: string;
  endpoint_url?: string;
  oauth_token?: string;
  oauth_refresh_token?: string;
  [key: string]: string | undefined;
}

/**
 * Input for a single fetchReadings call. `since` is the high-water
 * mark — the adapter should return readings strictly AFTER this
 * timestamp, so the poller can advance safely without re-fetching.
 *
 * If `since` is null, the adapter fetches the most recent reading
 * (useful for first-time polls and for smoke-testing).
 */
export interface AdapterFetchInput {
  credentials: AdapterCredentials;
  monitoring_site_id: string | null;
  monitoring_device_id: string | null;
  since: Date | null;
}

/**
 * What an adapter returns from fetchReadings. The poller attaches
 * `inverter_id` before upserting into inverter_readings /
 * inverter_string_readings, so adapters don't need to know it.
 */
export interface AdapterFetchResult {
  readings: NormalizedReading[];
  string_readings: NormalizedStringReading[];
}

/**
 * Health-check result for the admin "test credentials" UI.
 */
export interface AdapterHealthCheckResult {
  ok: boolean;
  message?: string;
  vendor_api_version?: string;
}

/**
 * The adapter interface every vendor implementation satisfies.
 */
export interface InverterAdapter {
  readonly brand: InverterBrand;

  /**
   * Fetch recent readings for ONE inverter. Throws on error — the
   * poller catches, logs to inverter_poll_failures, and moves on.
   */
  fetchReadings(input: AdapterFetchInput): Promise<AdapterFetchResult>;

  /**
   * Validate credentials + API connectivity without actually fetching
   * readings. Used by the credential management UI.
   */
  healthCheck(credentials: AdapterCredentials): Promise<AdapterHealthCheckResult>;
}

// ═══════════════════════════════════════════════════════════════════════
// Error classes — adapters throw these; the poller catches and logs.
// ═══════════════════════════════════════════════════════════════════════

export class AdapterError extends Error {
  readonly brand: InverterBrand;
  readonly httpStatus?: number;
  readonly payloadExcerpt?: string;

  constructor(
    brand: InverterBrand,
    message: string,
    opts?: { httpStatus?: number; payloadExcerpt?: string },
  ) {
    super(message);
    this.name = 'AdapterError';
    this.brand = brand;
    this.httpStatus = opts?.httpStatus;
    this.payloadExcerpt = opts?.payloadExcerpt;
  }
}

export class InvalidCredentialsError extends AdapterError {
  constructor(brand: InverterBrand, field: string) {
    super(brand, `Invalid credentials: missing or invalid "${field}"`);
    this.name = 'InvalidCredentialsError';
  }
}

export class NotImplementedError extends AdapterError {
  constructor(brand: InverterBrand, method: string) {
    super(
      brand,
      `${brand} adapter ${method}() is not yet implemented. API registration is pending.`,
    );
    this.name = 'NotImplementedError';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Synthetic reading generator — for local dev + the poller smoke test
// until live adapters are wired up.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a plausible reading for testing. Given a capacity rating
 * and a timestamp, produces a solar-curve-shaped power output that
 * mirrors what a real inverter would report.
 *
 * Power follows a sinusoid peaking at solar noon (12:00 IST), scaled
 * to the rated capacity. Small random jitter simulates cloud cover.
 */
export function syntheticReading(
  ratedCapacityKw: number,
  recordedAt: Date = new Date(),
): NormalizedReading {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTs = new Date(recordedAt.getTime() + istOffsetMs);
  const hour = istTs.getUTCHours() + istTs.getUTCMinutes() / 60;

  // Solar generation: 0 before 6am, peak at 12, 0 after 6pm.
  let powerFactor = 0;
  if (hour > 6 && hour < 18) {
    // sin curve scaled to [0,1] across (6, 18)
    powerFactor = Math.sin(((hour - 6) / 12) * Math.PI);
  }
  const jitter = 0.9 + Math.random() * 0.2; // ±10%
  const acPower = ratedCapacityKw * powerFactor * jitter;
  const dcPower = acPower * 1.02; // ~2% inverter loss

  // Energy accumulates — use day-of-year modulo as a pseudo-random seed
  const doy = Math.floor(
    (istTs.getTime() - Date.UTC(istTs.getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const energyToday = ratedCapacityKw * 4.5 * (hour > 18 ? 1 : Math.max(0, (hour - 6) / 12));
  const energyTotal = ratedCapacityKw * 4.5 * doy;

  return {
    recorded_at: recordedAt.toISOString(),
    ac_power_kw: Number(acPower.toFixed(3)),
    dc_power_kw: Number(dcPower.toFixed(3)),
    ac_voltage_v: 240 + (Math.random() - 0.5) * 4,
    ac_current_a: Number((acPower * 1000 / 240).toFixed(2)),
    ac_frequency_hz: 50 + (Math.random() - 0.5) * 0.1,
    temperature_c: 35 + Math.sin(((hour - 6) / 12) * Math.PI) * 15,
    energy_today_kwh: Number(energyToday.toFixed(3)),
    energy_total_kwh: Number(energyTotal.toFixed(3)),
    status: acPower > 0 ? 'active' : 'offline',
    error_code: null,
    raw_payload: {
      source: 'synthetic',
      power_factor: powerFactor,
      jitter,
    },
  };
}
