import { describe, it, expect } from 'vitest';
import { normalizePhone, deduplicateByPhone, parseCSV, isValidDate } from './migration-utils';

describe('normalizePhone', () => {
  it('strips +91 prefix', () => {
    expect(normalizePhone('+919876543210')).toBe('9876543210');
  });
  it('strips spaces and dashes', () => {
    expect(normalizePhone('98765-43210')).toBe('9876543210');
  });
  it('strips 91 prefix from 12 digits', () => {
    expect(normalizePhone('919876543210')).toBe('9876543210');
  });
  it('strips leading 0 from 11 digits', () => {
    expect(normalizePhone('09876543210')).toBe('9876543210');
  });
  it('returns 10 digits unchanged', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });
  it('handles mixed formatting', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
  });
  it('handles parentheses and dots', () => {
    expect(normalizePhone('(987) 654.3210')).toBe('9876543210');
  });
});

describe('deduplicateByPhone', () => {
  it('removes duplicate phone numbers', () => {
    const records = [
      { phone: '9876543210', name: 'A' },
      { phone: '+919876543210', name: 'B' },
      { phone: '9876543211', name: 'C' },
    ];
    const { unique, duplicates } = deduplicateByPhone(records);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].name).toBe('B');
  });

  it('returns all records when no duplicates', () => {
    const records = [
      { phone: '9876543210', name: 'A' },
      { phone: '9876543211', name: 'B' },
    ];
    const { unique, duplicates } = deduplicateByPhone(records);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it('normalizes phones in unique output', () => {
    const records = [{ phone: '+919876543210', name: 'A' }];
    const { unique } = deduplicateByPhone(records);
    expect(unique[0].phone).toBe('9876543210');
  });
});

describe('parseCSV', () => {
  it('parses basic CSV', () => {
    const csv = 'name,phone,city\nRaj,9876543210,Chennai\nPriya,9876543211,Bangalore';
    const records = parseCSV(csv);
    expect(records).toHaveLength(2);
    expect(records[0].name).toBe('Raj');
    expect(records[0].phone).toBe('9876543210');
    expect(records[1].city).toBe('Bangalore');
  });

  it('handles quoted values', () => {
    const csv = 'name,phone\n"Raj Kumar",9876543210';
    const records = parseCSV(csv);
    expect(records[0].name).toBe('Raj Kumar');
  });

  it('returns empty for header-only CSV', () => {
    expect(parseCSV('name,phone')).toHaveLength(0);
  });

  it('returns empty for empty string', () => {
    expect(parseCSV('')).toHaveLength(0);
  });
});

describe('isValidDate', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(isValidDate('2025-03-20')).toBe(true);
  });
  it('rejects invalid format', () => {
    expect(isValidDate('20/03/2025')).toBe(false);
  });
  it('rejects invalid date', () => {
    expect(isValidDate('2025-13-40')).toBe(false);
  });
});
