/**
 * Pure helper functions for HR module.
 * No database access — safe for both server and client use.
 */

/**
 * Returns number of days until the 25th of the current month (payroll export day).
 * Negative if past the 25th. Uses date math for accuracy across month boundaries.
 */
export function daysUntilPayrollExport(today: Date = new Date()): number {
  const target = new Date(today.getFullYear(), today.getMonth(), 25);
  const days = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return days === 0 ? 0 : days; // avoid -0
}

/**
 * Returns true if a certification's expiry date is within 30 days or already expired.
 * Returns false for null/undefined expiry (no expiry = never expires).
 */
export function isCertificationExpiringSoon(
  expiryDate: string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate + 'T00:00:00+05:30');
  const todayStart = new Date(today.toISOString().split('T')[0] + 'T00:00:00+05:30');
  const diffMs = expiry.getTime() - todayStart.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return diffDays < 30;
}

/**
 * Returns certification expiry status for badge colouring.
 * red = expired or <30 days, amber = <90 days, green = >90 days
 */
export function certificationExpiryStatus(
  expiryDate: string | null | undefined,
  today: Date = new Date(),
): 'red' | 'amber' | 'green' | 'none' {
  if (!expiryDate) return 'none';
  const expiry = new Date(expiryDate + 'T00:00:00+05:30');
  const todayStart = new Date(today.toISOString().split('T')[0] + 'T00:00:00+05:30');
  const diffMs = expiry.getTime() - todayStart.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 30) return 'red';
  if (diffDays < 90) return 'amber';
  return 'green';
}

/**
 * Generates the payroll CSV filename in the expected format.
 */
export function generatePayrollFilename(year: number, month: number): string {
  const paddedMonth = String(month).padStart(2, '0');
  return `shiroi-payroll-${year}-${paddedMonth}.csv`;
}

/**
 * Masks a sensitive field, showing only the last 4 characters.
 * Returns '****' if value is null/undefined/too short.
 */
export function maskSensitiveField(value: string | null | undefined): string {
  if (!value || value.length < 4) return '****';
  return '****' + value.slice(-4);
}
