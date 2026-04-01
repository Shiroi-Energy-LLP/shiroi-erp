import { describe, it, expect } from 'vitest';
import { daysUntilPayroll, classifyInvestment } from './dashboard-helpers';

describe('daysUntilPayroll', () => {
  it('returns days until 25th from March 10', () => {
    expect(daysUntilPayroll(new Date('2026-03-10'))).toBe(15);
  });
  it('returns negative days after 25th', () => {
    expect(daysUntilPayroll(new Date('2026-03-28'))).toBe(-3);
  });
});

describe('classifyInvestment', () => {
  it('marks negative position as invested', () => {
    expect(classifyInvestment(-50000)).toBe(true);
  });
  it('marks positive as not invested', () => {
    expect(classifyInvestment(10000)).toBe(false);
  });
});
