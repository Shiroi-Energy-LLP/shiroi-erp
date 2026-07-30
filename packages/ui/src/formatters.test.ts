import { describe, it, expect } from 'vitest';
import { formatINR, formatRate, shortINR, toIST, formatDate } from './formatters';

describe('formatINR', () => {
  it('formats whole rupees with Indian grouping', () => {
    expect(formatINR(123456)).toBe('₹1,23,456');
  });
  it('formats crores correctly', () => {
    expect(formatINR(10000000)).toBe('₹1,00,00,000');
  });
  it('rounds paise away — full INR only (2026-06-18 policy)', () => {
    expect(formatINR(1234.78)).toBe('₹1,235');
    expect(formatINR(1234.4)).toBe('₹1,234');
  });
});

describe('formatRate', () => {
  it('keeps up to 2 decimals for unit rates', () => {
    expect(formatRate(14.5)).toBe('₹14.5');
    expect(formatRate(1234.78)).toBe('₹1,234.78');
  });
  it('drops trailing zeros for whole rates', () => {
    expect(formatRate(1500)).toBe('₹1,500');
  });
});

describe('shortINR', () => {
  it('formats crores', () => expect(shortINR(15000000)).toBe('₹1.5Cr'));
  it('formats lakhs', () => expect(shortINR(250000)).toBe('₹2.5L'));
  it('formats thousands', () => expect(shortINR(5000)).toBe('₹5K'));
  it('formats small amounts', () => expect(shortINR(500)).toBe('₹500'));
});

describe('toIST', () => {
  it('converts UTC timestamp to IST string', () => {
    const result = toIST('2025-03-20T08:30:00Z');
    expect(result).toContain('20');
    expect(result).toContain('Mar');
    expect(result).toContain('2025');
  });
});

describe('formatDate', () => {
  it('formats YYYY-MM-DD to readable date', () => {
    const result = formatDate('2025-03-20');
    expect(result).toContain('20');
    expect(result).toContain('Mar');
    expect(result).toContain('2025');
  });
});

describe('formatDate (date-only, server-tz-safe)', () => {
  it('renders the given calendar day in IST regardless of runtime TZ', () => {
    // Pre-fix, under TZ=UTC this returned the previous day ("09 Jun 2026").
    expect(formatDate('2026-06-10')).toBe('10 Jun 2026');
    expect(formatDate('2026-01-01')).toBe('01 Jan 2026');
  });
});

describe('formatDate (timestamp tolerance)', () => {
  // Pre-fix these all returned "Invalid Date": appending 'T00:00:00+05:30' to a
  // string that already had a time component produced an unparseable date.
  // This was the Service Ticket "Created" and AMC "Completed Date" bug.
  it('accepts a TIMESTAMPTZ ISO string', () => {
    expect(formatDate('2026-07-30T05:00:00.000Z')).toBe('30 Jul 2026');
  });

  it('converts to IST before picking the calendar day', () => {
    // 23:00 UTC on the 29th is 04:30 IST on the 30th.
    expect(formatDate('2026-07-29T23:00:00.000Z')).toBe('30 Jul 2026');
  });

  it('accepts a space-separated Postgres timestamp', () => {
    expect(formatDate('2026-07-30 05:00:00+00')).toBe('30 Jul 2026');
  });

  it('returns an em dash for empty input', () => {
    expect(formatDate('')).toBe('—');
  });
});
