// Pure date helpers for DateRangeFilter. No React / no server imports — safe to
// unit-test and to import from a 'use client' component. All dates are
// 'yyyy-mm-dd' strings, compared lexicographically (no timezone drift).

/** 'yyyy-mm-dd' → 'dd/mm/yyyy'. Returns '' for empty/invalid input. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Build a 'yyyy-mm-dd' string from numeric parts (month is 1-12). */
export function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface CalendarCell {
  iso: string;
  day: number;
  /** false for leading/trailing days spilled from adjacent months */
  inMonth: boolean;
}

/**
 * 6-row (42-cell) calendar matrix for the given month, weeks starting Monday.
 * Leading/trailing cells carry adjacent-month dates with inMonth=false so the
 * grid is always full and aligned.
 */
export function buildCalendarMatrix(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = (first.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(first);
  start.setUTCDate(1 - firstDow);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    cells.push({ iso: toIso(y, mo, day), day, inMonth: mo === month && y === year });
  }
  return cells;
}

/** Add `delta` months to {year, month(1-12)}. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = month - 1 + delta;
  return { year: year + Math.floor(zero / 12), month: ((zero % 12) + 12) % 12 + 1 };
}

/** Order two isos ascending; either may be ''. */
export function orderRange(a: string, b: string): [string, string] {
  if (a && b && a > b) return [b, a];
  return [a, b];
}
