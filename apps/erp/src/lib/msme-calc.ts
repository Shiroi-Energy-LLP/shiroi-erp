/**
 * MSME 45-day compliance calculations.
 * Pure functions — no DB or API calls.
 *
 * Legal rule: MSME vendor payments due within 45 days of delivery.
 * Alert thresholds: Day 40 = amber, Day 44 = red, Day 46+ = overdue.
 */

export type MSMEAlertLevel = 'none' | 'amber' | 'red' | 'overdue';

/**
 * Calculates the number of whole days between a delivery date and a reference date.
 * Both dates are treated as date-only (time portion ignored).
 */
export function daysSinceDelivery(deliveryDate: Date, today: Date): number {
  const msPerDay = 86_400_000;
  const deliveryUTC = Date.UTC(deliveryDate.getFullYear(), deliveryDate.getMonth(), deliveryDate.getDate());
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((todayUTC - deliveryUTC) / msPerDay);
}

/**
 * Returns the MSME alert level based on days since delivery.
 *
 * - none:    < 40 days
 * - amber:   40-43 days (approaching deadline)
 * - red:     44-45 days (critical / due)
 * - overdue: > 45 days (legally overdue)
 */
export function getMSMEAlertLevel(days: number): MSMEAlertLevel {
  if (days > 45) return 'overdue';
  if (days >= 44) return 'red';
  if (days >= 40) return 'amber';
  return 'none';
}

/**
 * Calculates the MSME payment due date (45 days from delivery).
 */
export function getMSMEDueDate(deliveryDate: Date): Date {
  const due = new Date(deliveryDate);
  due.setDate(due.getDate() + 45);
  return due;
}
