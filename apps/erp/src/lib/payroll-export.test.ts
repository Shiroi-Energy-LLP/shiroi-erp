import { describe, it, expect } from 'vitest';
import { daysUntilPayrollExport, isCertificationExpiringSoon, generatePayrollFilename } from './hr-helpers';

describe('daysUntilPayrollExport', () => {
  it('returns days until 25th', () => {
    expect(daysUntilPayrollExport(new Date('2026-03-10'))).toBe(15);
  });
  it('returns negative after 25th', () => {
    expect(daysUntilPayrollExport(new Date('2026-03-28'))).toBe(-3);
  });
  it('returns zero on the 25th', () => {
    expect(daysUntilPayrollExport(new Date('2026-03-25'))).toBe(0);
  });
});

describe('isCertificationExpiringSoon', () => {
  it('returns true when expiry < 30 days away', () => {
    const today = new Date('2026-03-01');
    expect(isCertificationExpiringSoon('2026-03-25', today)).toBe(true);
  });
  it('returns false when expiry > 30 days away', () => {
    const today = new Date('2026-03-01');
    expect(isCertificationExpiringSoon('2026-05-01', today)).toBe(false);
  });
  it('returns true when already expired', () => {
    const today = new Date('2026-03-01');
    expect(isCertificationExpiringSoon('2026-02-15', today)).toBe(true);
  });
  it('returns false for null expiry', () => {
    expect(isCertificationExpiringSoon(null, new Date())).toBe(false);
  });
});

describe('generatePayrollFilename', () => {
  it('generates correct filename format', () => {
    expect(generatePayrollFilename(2026, 3)).toBe('shiroi-payroll-2026-03.csv');
  });
  it('pads single-digit months', () => {
    expect(generatePayrollFilename(2026, 1)).toBe('shiroi-payroll-2026-01.csv');
  });
});
