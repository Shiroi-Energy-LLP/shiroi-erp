import { describe, it, expect } from 'vitest';
import {
  normalizeBrand,
  normalizeDate,
  matchProject,
  type RawRow,
  type ProjectStub,
} from './import-plant-monitoring-credentials';
import { FIXTURE_RAW_ROWS, FIXTURE_PROJECTS } from './import-plant-monitoring-credentials.fixtures';

describe('normalizeBrand', () => {
  it('maps Deye to solarman (single API path for both)', () => {
    expect(normalizeBrand('Deye')).toBe('solarman');
    expect(normalizeBrand('deye')).toBe('solarman');
    expect(normalizeBrand('DEYE')).toBe('solarman');
  });

  it('lowercases known brands', () => {
    expect(normalizeBrand('Sungrow')).toBe('sungrow');
    expect(normalizeBrand('Growatt')).toBe('growatt');
    expect(normalizeBrand('Goodwe')).toBe('goodwe');
    expect(normalizeBrand('Fimer')).toBe('fimer');
    expect(normalizeBrand('Polycab')).toBe('polycab');
    expect(normalizeBrand('Havells')).toBe('havells');
    expect(normalizeBrand('Flin Energy')).toBe('flin_energy');
    expect(normalizeBrand('Fronius')).toBe('fronius');
  });

  it('infers from monitoring URL when brand is empty', () => {
    expect(normalizeBrand('', 'https://home.solarmanpv.com/login')).toBe('solarman');
    expect(normalizeBrand('', 'https://www.isolarcloud.com.hk/#/login')).toBe('sungrow');
    expect(normalizeBrand('', 'https://server.growatt.com/login')).toBe('growatt');
  });

  it('returns other for unknown brand and unknown URL', () => {
    expect(normalizeBrand('XYZ Inverters')).toBe('other');
    expect(normalizeBrand('')).toBe('other');
  });
});

describe('normalizeDate', () => {
  it('parses YYYY-MM-DD as is', () => {
    expect(normalizeDate('2025-11-21')).toBe('2025-11-21');
  });
  it('parses M/D/YYYY US-style', () => {
    expect(normalizeDate('12/3/2025')).toBe('2025-12-03');
  });
  it('parses 4/18/2026', () => {
    expect(normalizeDate('4/18/2026')).toBe('2026-04-18');
  });
  it('returns null on empty', () => {
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate(undefined as unknown as string)).toBeNull();
  });
  it('returns null on garbage', () => {
    expect(normalizeDate('not a date')).toBeNull();
  });
});

describe('matchProject', () => {
  const projects = FIXTURE_PROJECTS;

  it('exact match wins', () => {
    const result = matchProject('GRN Ambili Srinivas', projects);
    expect(result?.id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('token-subset match handles prefix labels', () => {
    const result = matchProject('Mr Ravi / Tiruvannamalai', projects);
    expect(result?.id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('handles honorific case differences', () => {
    const result = matchProject('Mr Sridhar Rajan', projects);
    expect(result?.id).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('returns null when no project matches', () => {
    const result = matchProject('Completely Unknown Customer', projects);
    expect(result).toBeNull();
  });
});
