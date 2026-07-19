import { describe, it, expect } from 'vitest';
import { fyToOrderDate, dateToFy, fyOptions } from './fiscal-year';

describe('fyToOrderDate', () => {
  it('maps a valid FY to 1-Apr of the start year', () => {
    expect(fyToOrderDate('2025-26')).toBe('2025-04-01');
    expect(fyToOrderDate('2014-15')).toBe('2014-04-01');
  });
  it('returns null for malformed input', () => {
    expect(fyToOrderDate('2025')).toBeNull();
    expect(fyToOrderDate('garbage')).toBeNull();
    expect(fyToOrderDate('')).toBeNull();
  });
});

describe('dateToFy', () => {
  it('classifies a March date into the prior FY', () => {
    expect(dateToFy('2026-03-31T00:00:00Z')).toBe('2025-26');
  });
  it('classifies an April date into the new FY', () => {
    expect(dateToFy('2025-04-01T00:00:00Z')).toBe('2025-26');
  });
  it('round-trips with fyToOrderDate', () => {
    const orderDate = fyToOrderDate('2023-24');
    expect(orderDate).not.toBeNull();
    expect(dateToFy(orderDate!)).toBe('2023-24');
  });
  it('returns null for null/invalid', () => {
    expect(dateToFy(null)).toBeNull();
    expect(dateToFy(undefined)).toBeNull();
    expect(dateToFy('not-a-date')).toBeNull();
  });
});

describe('fyOptions', () => {
  it('lists newest-first down to 2014-15', () => {
    const opts = fyOptions(2026, 5); // June 2026 → FY 2026-27
    expect(opts[0]).toBe('2026-27');
    expect(opts[opts.length - 1]).toBe('2014-15');
  });
  it('uses the prior FY when the month is before April', () => {
    const opts = fyOptions(2026, 1); // Feb 2026 → current FY is 2025-26
    expect(opts[0]).toBe('2025-26');
  });
});
