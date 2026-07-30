// Whole-rupee INR display — paise are NOT shown (rounded to the nearest rupee).
// Org-wide policy (2026-06-18, Vivek): "full INR only, paise not needed".
// For per-unit rates that need decimal precision (e.g. ₹14.50/Wp) use formatRate().
// Display-only — the underlying stored/computed values keep full precision.
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Precise INR for unit prices / rates — shows up to 2 decimals when present
// (e.g. ₹14.50/Wp). Use this where rounding to whole rupees would be misleading;
// use formatINR() for amounts and totals.
export function formatRate(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function shortINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`;
  return `₹${amount}`;
}

export function toIST(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date-only string ("YYYY-MM-DD") as Indian date "DD MMM YYYY".
 *
 * Date-only values are pinned to IST midnight so a UTC server doesn't render
 * them a day early. Inputs that already carry a time component (a TIMESTAMPTZ
 * ISO string) would be corrupted by that suffix — `"…T05:00:00Z" + "T00:00:00…"`
 * parses as Invalid Date — so those are delegated to formatDateFromTimestamp.
 * Callers with a known timestamp should use that function directly; this guard
 * exists because the two are easy to mix up and the failure is user-visible.
 */
export function formatDate(dateString: string): string {
  if (!dateString) return '—';
  if (dateString.includes('T') || dateString.includes(' ')) {
    return formatDateFromTimestamp(dateString);
  }
  return new Date(dateString + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Format an ISO timestamp string (or Date) as Indian date "DD MMM YYYY".
 * Use this when the input has time/timezone information that would be
 * corrupted by formatDate's date-only `+T00:00:00+05:30` suffix.
 */
export function formatDateFromTimestamp(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/**
 * Strip the "SHIROI/PROJ/" prefix from a project number so the table shows
 * just the year + sequence (e.g. "SHIROI/PROJ/2025-26/0042" → "2025-26/0042").
 * Safe for any other prefix — returns the input unchanged if nothing matches.
 */
export function formatProjectNumber(projectNumber: string | null | undefined): string {
  if (!projectNumber) return '—';
  return projectNumber.replace(/^SHIROI\/PROJ\//i, '');
}
