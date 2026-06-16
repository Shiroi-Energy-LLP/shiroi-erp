/**
 * fiscal-year.ts — Indian fiscal-year (Apr–Mar) helpers shared by the projects
 * list FY filter, the editable Year column, and the status-summary header.
 * Client-safe: no server imports (NEVER-DO #21).
 *
 * FY string format: 'YYYY-YY' (e.g. '2025-26' = 1-Apr-2025 … 31-Mar-2026).
 */

const FY_RE = /^(\d{4})-(\d{2})$/;

/** FY string → the order_date to store (1-Apr of the FY start year), or null if malformed. */
export function fyToOrderDate(fy: string): string | null {
  const m = FY_RE.exec(fy);
  return m ? `${m[1]}-04-01` : null;
}

/** A date (order_date or created_at) → FY string like '2025-26', or null if absent/invalid. */
export function dateToFy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // FY starts in April (month index 3). Jan–Mar belong to the prior FY.
  const startYear = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** FY options newest-first, from the current FY down to 2014-15. */
export function fyOptions(currentYearUtc: number, currentMonthUtc: number): string[] {
  const start = currentMonthUtc >= 3 ? currentYearUtc : currentYearUtc - 1;
  const out: string[] = [];
  for (let y = start; y >= 2014; y--) out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  return out;
}
