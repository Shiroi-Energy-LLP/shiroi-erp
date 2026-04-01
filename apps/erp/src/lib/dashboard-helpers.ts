import Decimal from 'decimal.js';

/**
 * Returns the number of days until the 25th of the current month.
 * Negative values mean the 25th has already passed.
 */
export function daysUntilPayroll(today: Date = new Date()): number {
  const target = new Date(today.getFullYear(), today.getMonth(), 25);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns true if net cash position is negative (company has invested more than received).
 */
export function classifyInvestment(netCashPosition: number): boolean {
  return new Decimal(netCashPosition).lessThan(0);
}
