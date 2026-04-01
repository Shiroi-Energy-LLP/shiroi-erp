import { describe, it, expect } from 'vitest';
import { formatINR, shortINR, toIST, formatDate } from './formatters';

describe('formatINR', () => {
  it('formats whole rupees with Indian grouping', () => {
    expect(formatINR(123456)).toBe('₹1,23,456');
  });
  it('formats crores correctly', () => {
    expect(formatINR(10000000)).toBe('₹1,00,00,000');
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
