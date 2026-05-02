// apps/erp/src/lib/orphan-triage-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { isMeaningfulToken, normalizeZohoName, summarizeLinkedPayments } from './orphan-triage-helpers';

describe('isMeaningfulToken', () => {
  it('rejects stopwords', () => {
    expect(isMeaningfulToken('pvt')).toBe(false);
    expect(isMeaningfulToken('ltd')).toBe(false);
    expect(isMeaningfulToken('and')).toBe(false);
  });
  it('rejects single-char tokens', () => {
    expect(isMeaningfulToken('m')).toBe(false);
    expect(isMeaningfulToken('a')).toBe(false);
  });
  it('accepts substantive words', () => {
    expect(isMeaningfulToken('ramaniyam')).toBe(true);
    expect(isMeaningfulToken('lancor')).toBe(true);
  });
});

describe('normalizeZohoName', () => {
  it('lowercases and trims', () => {
    expect(normalizeZohoName('  LANCOR  ')).toBe('lancor');
  });
  it('collapses whitespace', () => {
    expect(normalizeZohoName('Ramaniyam   Real   Estates')).toBe('ramaniyam real estates');
  });
});

describe('summarizeLinkedPayments', () => {
  it('returns "No linked payments" for empty array', () => {
    expect(summarizeLinkedPayments([])).toBe('No linked payments');
  });
  it('returns count + total for multiple', () => {
    const payments = [
      { amount: '10000.00' },
      { amount: '25000.50' },
    ];
    expect(summarizeLinkedPayments(payments)).toBe('2 payments · ₹35,000.50');
  });
});
