/**
 * Goodwe SEMS Portal adapter tests.
 *
 * All tests run against the STUB implementation. When the real Goodwe SEMS
 * Portal API access is granted, only the NotImplementedError tests
 * will need updating — the synthetic-mode and credential-validation tests
 * remain valid.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { goodweAdapter } from './goodwe';
import { InvalidCredentialsError, NotImplementedError } from './base';

// ─── Constants ────────────────────────────────────────────────────────────

const VALID_CREDENTIALS = {
  username: 'test@example.com',
  password: 'TestPass@2026',
  rated_capacity_kw: '5',
};

const VALID_INPUT = {
  credentials: VALID_CREDENTIALS,
  monitoring_site_id: 'PLANT001',
  monitoring_device_id: 'DEVICE_SN_001',
  since: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('goodweAdapter.fetchReadings', () => {
  beforeEach(() => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  it('throws InvalidCredentialsError when username missing', async () => {
    await expect(
      goodweAdapter.fetchReadings({
        ...VALID_INPUT,
        credentials: { password: 'p' },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError when password missing', async () => {
    await expect(
      goodweAdapter.fetchReadings({
        ...VALID_INPUT,
        credentials: { username: 'u' },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('returns synthetic reading when SYNTHETIC_INVERTER_READINGS=1', async () => {
    process.env.SYNTHETIC_INVERTER_READINGS = '1';
    const result = await goodweAdapter.fetchReadings({
      credentials: { username: 'u', password: 'p', rated_capacity_kw: '5' },
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
      goodweAdapter.fetchReadings({
        credentials: { username: 'u', password: 'p' },
        monitoring_site_id: 'S',
        monitoring_device_id: 'D',
        since: null,
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('goodweAdapter.healthCheck', () => {
  beforeEach(() => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  it('reports not-approved when credentials missing', async () => {
    const r = await goodweAdapter.healthCheck({});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pending/i);
  });

  it('reports not-approved when only username is present', async () => {
    const r = await goodweAdapter.healthCheck({ username: 'u' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pending/i);
  });

  it('reports OK in synthetic mode with creds present', async () => {
    process.env.SYNTHETIC_INVERTER_READINGS = '1';
    const r = await goodweAdapter.healthCheck({ username: 'u', password: 'p' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/synthetic/i);
    expect(r.vendor_api_version).toBe('synthetic');
  });

  it('reports not-implemented in real mode when creds present but API not wired', async () => {
    delete process.env.SYNTHETIC_INVERTER_READINGS;
    const r = await goodweAdapter.healthCheck({ username: 'u', password: 'p' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pending/i);
  });
});
