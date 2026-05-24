/**
 * SolarMan / Deye adapter tests.
 *
 * All tests run against the STUB implementation. When the real SolarMan
 * paid Basic plan credentials arrive, only the NotImplementedError tests
 * will need updating — the synthetic-mode and credential-validation tests
 * remain valid.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { solarmanAdapter } from './solarman';
import { InvalidCredentialsError, NotImplementedError } from './base';

// ─── Constants ────────────────────────────────────────────────────────────

const VALID_CREDENTIALS = {
  api_key: 'test-app-id-123',
  api_secret: 'test-app-secret-456',
  rated_capacity_kw: '5',
};

const VALID_INPUT = {
  credentials: VALID_CREDENTIALS,
  monitoring_site_id: 'PLANT001',
  monitoring_device_id: 'DEVICE_SN_001',
  since: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('solarmanAdapter.fetchReadings', () => {
  beforeEach(() => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  it('throws InvalidCredentialsError when api_key missing', async () => {
    await expect(
      solarmanAdapter.fetchReadings({
        ...VALID_INPUT,
        credentials: { api_secret: 's' },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError when api_secret missing', async () => {
    await expect(
      solarmanAdapter.fetchReadings({
        ...VALID_INPUT,
        credentials: { api_key: 'k' },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('returns synthetic reading when SYNTHETIC_INVERTER_READINGS=1', async () => {
    process.env.SYNTHETIC_INVERTER_READINGS = '1';
    const result = await solarmanAdapter.fetchReadings({
      credentials: { api_key: 'k', api_secret: 's', rated_capacity_kw: '5' },
      monitoring_site_id: 'S',
      monitoring_device_id: 'D',
      since: null,
    });
    expect(result.readings.length).toBe(1);
    expect(result.string_readings.length).toBe(0);
    expect(result.readings[0]!.raw_payload.source).toBe('synthetic');
  });

  it('throws NotImplementedError in non-synthetic mode (real impl pending)', async () => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
    await expect(
      solarmanAdapter.fetchReadings({
        credentials: { api_key: 'k', api_secret: 's' },
        monitoring_site_id: 'S',
        monitoring_device_id: 'D',
        since: null,
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('solarmanAdapter.healthCheck', () => {
  beforeEach(() => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  it('reports not-activated when credentials missing', async () => {
    const r = await solarmanAdapter.healthCheck({});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pending/i);
  });

  it('reports not-activated when only api_key is present', async () => {
    const r = await solarmanAdapter.healthCheck({ api_key: 'k' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pending/i);
  });

  it('reports OK in synthetic mode with creds present', async () => {
    process.env.SYNTHETIC_INVERTER_READINGS = '1';
    const r = await solarmanAdapter.healthCheck({ api_key: 'k', api_secret: 's' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/synthetic/i);
    expect(r.vendor_api_version).toBe('synthetic');
  });

  it('reports not-implemented in real mode when creds present but API not wired', async () => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
    const r = await solarmanAdapter.healthCheck({ api_key: 'k', api_secret: 's' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pending/i);
  });
});
