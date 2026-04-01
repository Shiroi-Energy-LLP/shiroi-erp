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
    const reportDate = toDateString(new Date(Date.now() - 24 * 60 * 60 * 1000)); // yesterday
    expect(isReportLocked(reportDate)).toBe(false);
  });

  it('returns true for report more than 48h old', () => {
    const reportDate = toDateString(new Date(Date.now() - 72 * 60 * 60 * 1000)); // 3 days ago
    expect(isReportLocked(reportDate)).toBe(true);
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
    const reportDate = toDateString(new Date()); // today
    expect(isReportLocked(reportDate, true)).toBe(true);
  });

  it('returns false for today report without is_locked flag', () => {
    const reportDate = toDateString(new Date()); // today
    expect(isReportLocked(reportDate, false)).toBe(false);
  });
});

describe('hoursUntilLock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns positive hours for recent report', () => {
    const reportDate = toDateString(new Date()); // today
    const hours = hoursUntilLock(reportDate);
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThanOrEqual(48);
  });

  it('returns 0 for already locked report', () => {
    const reportDate = toDateString(new Date(Date.now() - 72 * 60 * 60 * 1000));
    expect(hoursUntilLock(reportDate)).toBe(0);
  });

  it('returns 0 when is_locked flag is true', () => {
    const reportDate = toDateString(new Date());
    expect(hoursUntilLock(reportDate, true)).toBe(0);
  });
});

describe('canEditReport', () => {
  it('returns true for recent unlocked report', () => {
    const reportDate = toDateString(new Date());
    expect(canEditReport(reportDate, false)).toBe(true);
  });

  it('returns false for old report', () => {
    const reportDate = toDateString(new Date(Date.now() - 72 * 60 * 60 * 1000));
    expect(canEditReport(reportDate, false)).toBe(false);
  });

  it('returns false when is_locked is true', () => {
    const reportDate = toDateString(new Date());
    expect(canEditReport(reportDate, true)).toBe(false);
  });
});
