export function formatINR(amount: number): string {
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

export function formatDate(dateString: string): string {
  return new Date(dateString + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
