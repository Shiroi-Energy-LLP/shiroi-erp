/**
 * Pure helper functions for the Project Cash Position dashboard.
 * No database access — safe for both server and client use.
 */

/**
 * Computes the escalation level for an overdue invoice based on days overdue.
 *
 * Levels:
 *  0 = not overdue
 *  1 = Day 1–4: sales alert
 *  2 = Day 5–9: manager escalation
 *  3 = Day 10–29: founder escalation
 *  4 = Day 30+: legal flag
 */
export function getEscalationLevel(daysOverdue: number): number {
  if (daysOverdue <= 0) return 0;
  if (daysOverdue < 5) return 1;
  if (daysOverdue < 10) return 2;
  if (daysOverdue < 30) return 3;
  return 4;
}

const ESCALATION_LABELS: Record<number, string> = {
  0: 'Current',
  1: 'Sales Alert',
  2: 'Manager',
  3: 'Founder',
  4: 'Legal',
};

export function getEscalationLabel(level: number): string {
  return ESCALATION_LABELS[level] ?? 'Unknown';
}

/**
 * Returns the badge colour variant for an escalation level.
 * Maps to the Badge component's variant prop.
 */
export function getEscalationVariant(
  level: number,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (level) {
    case 0:
      return 'default';
    case 1:
      return 'secondary';
    case 2:
    case 3:
      return 'outline';
    case 4:
      return 'destructive';
    default:
      return 'default';
  }
}

/**
 * Calculates the number of days between a due date and today.
 * Returns a positive number if overdue, zero or negative if not yet due.
 */
export function calcDaysOverdue(dueDate: string): number {
  const due = new Date(dueDate + 'T00:00:00+05:30');
  const now = new Date();
  // Convert to IST date for comparison
  const istNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
  );
  const diffMs = istNow.getTime() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Classifies a project's cash position.
 */
export type CashClassification = 'invested' | 'positive' | 'neutral';

export function classifyCashPosition(netCashPosition: number): CashClassification {
  if (netCashPosition < 0) return 'invested';
  if (netCashPosition > 0) return 'positive';
  return 'neutral';
}

/**
 * Returns a CSS colour class based on cash classification.
 */
export function cashPositionColor(netCashPosition: number): string {
  const classification = classifyCashPosition(netCashPosition);
  switch (classification) {
    case 'invested':
      return 'text-red-600';
    case 'positive':
      return 'text-green-700';
    case 'neutral':
      return 'text-gray-600';
  }
}
