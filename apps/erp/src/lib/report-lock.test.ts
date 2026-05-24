import { describe, it, expect, vi, afterEach } from 'vitest';
import { isReportLocked, hoursUntilLock, canEditReport } from './report-lock';

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

describe('isReportLocked', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for report less than 48h old', () => {
    // Pin "now" so the test doesn't flake depending on current UTC time vs the IST boundary.
    // 2026-03-30 06:00 IST = 2026-03-30 00:30 UTC. Yesterday's report (2026-03-29) locks at
    // 2026-03-29 00:00 IST + 48h = 2026-03-31 00:00 IST. We're well before that.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(isReportLocked('2026-03-29')).toBe(false);
  });

  it('returns true for report more than 48h old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(isReportLocked('2026-03-27')).toBe(true);
  });

  it('returns true for report exactly at 48h boundary', () => {
    // Use a fixed time so we can control the boundary precisely.
    // Set "now" to 2026-03-30 05:30 UTC (= 2026-03-30 11:00 IST).
    // report_date = '2026-03-28'. Lock deadline = 2026-03-28 00:00 IST + 48h
    //   = 2026-03-30 00:00 IST = 2026-03-29 18:30 UTC.
    // "now" is well past that → locked.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T05:30:00Z'));
    expect(isReportLocked('2026-03-28')).toBe(true);
    vi.useRealTimers();
  });

  it('returns true if is_locked flag is true regardless of time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(isReportLocked('2026-03-30', true)).toBe(true);
  });

  it('returns false for today report without is_locked flag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(isReportLocked('2026-03-30', false)).toBe(false);
  });
});

describe('hoursUntilLock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns positive hours for recent report', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    const hours = hoursUntilLock('2026-03-30');
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThanOrEqual(48);
  });

  it('returns 0 for already locked report', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(hoursUntilLock('2026-03-27')).toBe(0);
  });

  it('returns 0 when is_locked flag is true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(hoursUntilLock('2026-03-30', true)).toBe(0);
  });
});

describe('canEditReport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for recent unlocked report', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(canEditReport('2026-03-30', false)).toBe(true);
  });

  it('returns false for old report', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(canEditReport('2026-03-27', false)).toBe(false);
  });

  it('returns false when is_locked is true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:30:00Z'));
    expect(canEditReport('2026-03-30', true)).toBe(false);
  });
});
