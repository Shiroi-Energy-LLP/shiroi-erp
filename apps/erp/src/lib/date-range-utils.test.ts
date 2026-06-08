import { describe, it, expect } from 'vitest';
import { isoToDisplay, toIso, buildCalendarMatrix, addMonths, orderRange } from './date-range-utils';

describe('isoToDisplay', () => {
  it('formats yyyy-mm-dd as dd/mm/yyyy', () => {
    expect(isoToDisplay('2026-06-30')).toBe('30/06/2026');
  });
  it('returns empty string for invalid input', () => {
    expect(isoToDisplay('')).toBe('');
    expect(isoToDisplay('nonsense')).toBe('');
  });
});

describe('toIso', () => {
  it('zero-pads month and day', () => {
    expect(toIso(2026, 6, 3)).toBe('2026-06-03');
  });
});

describe('buildCalendarMatrix', () => {
  const cells = buildCalendarMatrix(2026, 6);
  it('returns 42 cells', () => {
    expect(cells).toHaveLength(42);
  });
  it('has exactly 30 in-month days for June', () => {
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });
  it('first in-month day is the 1st', () => {
    expect(cells.find((c) => c.inMonth)!.iso).toBe('2026-06-01');
  });
  it('starts the grid on Monday 2026-06-01', () => {
    // 2026-06-01 is a Monday, so cell 0 is in-month.
    expect(cells[0]!.iso).toBe('2026-06-01');
  });
});

describe('addMonths', () => {
  it('rolls forward across year', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('rolls backward across year', () => {
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('orderRange', () => {
  it('swaps when out of order', () => {
    expect(orderRange('2026-06-30', '2026-06-01')).toEqual(['2026-06-01', '2026-06-30']);
  });
  it('leaves ordered/partial input alone', () => {
    expect(orderRange('2026-06-01', '')).toEqual(['2026-06-01', '']);
  });
});
