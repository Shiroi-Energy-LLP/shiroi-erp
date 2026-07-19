/**
 * Tests for shared adapter helpers (base.ts).
 */
import { describe, it, expect } from 'vitest';
import { clampRecordedAt } from './base';

describe('clampRecordedAt', () => {
  const now = new Date('2026-06-09T05:00:00.000Z');

  it('keeps a normal recent timestamp unchanged', () => {
    expect(clampRecordedAt('2026-06-09T04:55:00.000Z', now)).toBe('2026-06-09T04:55:00.000Z');
  });

  it('clamps a future timestamp (datalogger clock ahead) to now — the 2026-06-09 prod case', () => {
    // A reading dated next month has no partition → upsert would hard-error.
    expect(clampRecordedAt('2026-07-15T09:00:00.000Z', now)).toBe(now.toISOString());
  });

  it('allows a small future skew inside the grace window', () => {
    expect(clampRecordedAt('2026-06-09T05:30:00.000Z', now)).toBe('2026-06-09T05:30:00.000Z');
  });

  it('clamps a stale/ancient timestamp (older than the oldest partition) to now', () => {
    expect(clampRecordedAt('2026-04-01T00:00:00.000Z', now)).toBe(now.toISOString());
  });

  it('falls back to now for an unparseable value', () => {
    expect(clampRecordedAt('not-a-date', now)).toBe(now.toISOString());
  });

  it('normalizes an in-range IST offset timestamp to UTC ISO', () => {
    expect(clampRecordedAt('2026-06-09T10:15:00+05:30', now)).toBe('2026-06-09T04:45:00.000Z');
  });
});
