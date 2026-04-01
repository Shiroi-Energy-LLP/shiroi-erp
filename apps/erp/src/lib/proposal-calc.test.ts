import { describe, it, expect } from 'vitest';
import { calcGST, calcLineTotal, calcProposalTotals, validatePaymentSchedule, calcMarginPct } from './proposal-calc';

describe('calcGST', () => {
  it('calculates 5% GST for supply', () => {
    expect(calcGST(100000, 'supply')).toBe(5000);
  });
  it('calculates 18% GST for works_contract', () => {
    expect(calcGST(100000, 'works_contract')).toBe(18000);
  });
  it('handles zero amount', () => {
    expect(calcGST(0, 'supply')).toBe(0);
  });
  it('handles decimal amounts precisely', () => {
    expect(calcGST(100001, 'supply')).toBe(5000.05);
  });
});

describe('calcLineTotal', () => {
  it('calculates quantity * unit_price', () => {
    expect(calcLineTotal(10, 5000)).toBe(50000);
  });
  it('handles decimal quantities', () => {
    expect(calcLineTotal(2.5, 4000)).toBe(10000);
  });
});

describe('calcProposalTotals', () => {
  it('sums supply and works separately with GST', () => {
    const lines = [
      { total_price: 100000, gst_type: 'supply' as const, scope_owner: 'shiroi' as const },
      { total_price: 50000, gst_type: 'works_contract' as const, scope_owner: 'shiroi' as const },
    ];
    const result = calcProposalTotals(lines, 0);
    expect(result.subtotalSupply).toBe(100000);
    expect(result.subtotalWorks).toBe(50000);
    expect(result.gstSupply).toBe(5000);
    expect(result.gstWorks).toBe(9000);
    expect(result.totalBeforeDiscount).toBe(164000);
    expect(result.totalAfterDiscount).toBe(164000);
  });

  it('excludes non-shiroi scope from totals', () => {
    const lines = [
      { total_price: 100000, gst_type: 'supply' as const, scope_owner: 'shiroi' as const },
      { total_price: 50000, gst_type: 'supply' as const, scope_owner: 'client' as const },
    ];
    const result = calcProposalTotals(lines, 0);
    expect(result.subtotalSupply).toBe(100000);
  });

  it('applies discount correctly', () => {
    const lines = [
      { total_price: 100000, gst_type: 'supply' as const, scope_owner: 'shiroi' as const },
    ];
    const result = calcProposalTotals(lines, 5000);
    expect(result.totalBeforeDiscount).toBe(105000);
    expect(result.totalAfterDiscount).toBe(100000);
  });

  it('handles empty lines', () => {
    const result = calcProposalTotals([], 0);
    expect(result.subtotalSupply).toBe(0);
    expect(result.subtotalWorks).toBe(0);
    expect(result.totalBeforeDiscount).toBe(0);
  });

  it('excludes builder and excluded scope owners', () => {
    const lines = [
      { total_price: 100000, gst_type: 'supply' as const, scope_owner: 'shiroi' as const },
      { total_price: 30000, gst_type: 'supply' as const, scope_owner: 'builder' as const },
      { total_price: 20000, gst_type: 'works_contract' as const, scope_owner: 'excluded' as const },
    ];
    const result = calcProposalTotals(lines, 0);
    expect(result.subtotalSupply).toBe(100000);
    expect(result.subtotalWorks).toBe(0);
  });
});

describe('validatePaymentSchedule', () => {
  it('returns valid when percentages sum to 100', () => {
    expect(validatePaymentSchedule([30, 40, 30])).toEqual({ valid: true, sum: 100 });
  });
  it('returns invalid when percentages do not sum to 100', () => {
    expect(validatePaymentSchedule([30, 40, 20])).toEqual({ valid: false, sum: 90 });
  });
  it('returns invalid when percentages exceed 100', () => {
    expect(validatePaymentSchedule([50, 40, 20])).toEqual({ valid: false, sum: 110 });
  });
  it('handles empty array', () => {
    expect(validatePaymentSchedule([])).toEqual({ valid: false, sum: 0 });
  });
  it('handles single milestone of 100%', () => {
    expect(validatePaymentSchedule([100])).toEqual({ valid: true, sum: 100 });
  });
});

describe('calcMarginPct', () => {
  it('calculates margin percentage', () => {
    expect(calcMarginPct(100000, 80000)).toBe(20);
  });
  it('returns 0 when revenue is 0', () => {
    expect(calcMarginPct(0, 50000)).toBe(0);
  });
  it('handles negative margin', () => {
    expect(calcMarginPct(100000, 120000)).toBe(-20);
  });
});
