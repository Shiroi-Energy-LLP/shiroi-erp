import { describe, it, expect } from 'vitest';
import { calcWeightedCompletion, validateMilestoneWeights } from './completion-calc';

describe('calcWeightedCompletion', () => {
  it('calculates weighted completion correctly', () => {
    const milestones = [
      { completion_pct: 100, weight: 15 },
      { completion_pct: 50, weight: 25 },
      { completion_pct: 0, weight: 60 },
    ];
    // (100*15 + 50*25 + 0*60) / 100 = (1500 + 1250) / 100 = 27.5
    expect(calcWeightedCompletion(milestones)).toBe(27.5);
  });

  it('returns 0 for no milestones', () => {
    expect(calcWeightedCompletion([])).toBe(0);
  });

  it('returns 100 when all complete', () => {
    const milestones = [
      { completion_pct: 100, weight: 40 },
      { completion_pct: 100, weight: 60 },
    ];
    expect(calcWeightedCompletion(milestones)).toBe(100);
  });

  it('handles fractional weights correctly', () => {
    const milestones = [
      { completion_pct: 100, weight: 33.33 },
      { completion_pct: 100, weight: 33.33 },
      { completion_pct: 0, weight: 33.34 },
    ];
    // (100*33.33 + 100*33.33 + 0*33.34) / 100 = 66.66
    expect(calcWeightedCompletion(milestones)).toBe(66.66);
  });

  it('handles partial completion across all milestones', () => {
    const milestones = [
      { completion_pct: 50, weight: 50 },
      { completion_pct: 50, weight: 50 },
    ];
    // (50*50 + 50*50) / 100 = 50
    expect(calcWeightedCompletion(milestones)).toBe(50);
  });
});

describe('validateMilestoneWeights', () => {
  it('valid when weights sum to 100', () => {
    expect(validateMilestoneWeights([15, 25, 60])).toEqual({ valid: true, sum: 100 });
  });

  it('invalid when weights do not sum to 100', () => {
    expect(validateMilestoneWeights([15, 25, 50])).toEqual({ valid: false, sum: 90 });
  });

  it('valid with decimal weights summing to 100', () => {
    expect(validateMilestoneWeights([33.33, 33.33, 33.34])).toEqual({ valid: true, sum: 100 });
  });

  it('invalid with empty array', () => {
    expect(validateMilestoneWeights([])).toEqual({ valid: false, sum: 0 });
  });
});
