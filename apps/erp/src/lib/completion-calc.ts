import Decimal from 'decimal.js';

interface MilestoneWeight {
  completion_pct: number;
  weight: number;
}

/**
 * Calculates weighted project completion from milestone weights and their individual completion %.
 * Completion % is NEVER a direct input — always computed from milestone weights.
 *
 * Formula: sum(milestone_completion_pct * weight) / 100
 */
export function calcWeightedCompletion(milestones: MilestoneWeight[]): number {
  if (milestones.length === 0) return 0;

  const weightedSum = milestones.reduce(
    (sum, m) => sum.add(new Decimal(m.completion_pct).mul(new Decimal(m.weight))),
    new Decimal(0),
  );

  return weightedSum.div(100).toDP(2).toNumber();
}

/**
 * Validates that milestone weights sum to exactly 100%.
 * DB trigger enforces this, but we validate client-side too.
 */
export function validateMilestoneWeights(weights: number[]): { valid: boolean; sum: number } {
  const sum = weights.reduce(
    (s, w) => new Decimal(s).add(new Decimal(w)).toNumber(),
    0,
  );
  return { valid: sum === 100, sum };
}
