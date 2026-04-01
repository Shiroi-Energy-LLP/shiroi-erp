import Decimal from 'decimal.js';

type GSTType = 'supply' | 'works_contract';
type ScopeOwner = 'shiroi' | 'client' | 'builder' | 'excluded';

const GST_RATES: Record<GSTType, string> = {
  supply: '0.05',
  works_contract: '0.18',
};

export function calcGST(amount: number, gstType: GSTType): number {
  return new Decimal(amount).mul(GST_RATES[gstType]).toNumber();
}

export function calcLineTotal(quantity: number, unitPrice: number): number {
  return new Decimal(quantity).mul(unitPrice).toNumber();
}

interface BOMLine {
  total_price: number;
  gst_type: GSTType;
  scope_owner: ScopeOwner;
}

export interface ProposalTotals {
  subtotalSupply: number;
  subtotalWorks: number;
  gstSupply: number;
  gstWorks: number;
  totalBeforeDiscount: number;
  totalAfterDiscount: number;
}

export function calcProposalTotals(lines: BOMLine[], discount: number): ProposalTotals {
  const shiroiLines = lines.filter(l => l.scope_owner === 'shiroi');

  const subtotalSupply = shiroiLines
    .filter(l => l.gst_type === 'supply')
    .reduce((sum, l) => sum.add(new Decimal(l.total_price)), new Decimal(0))
    .toNumber();

  const subtotalWorks = shiroiLines
    .filter(l => l.gst_type === 'works_contract')
    .reduce((sum, l) => sum.add(new Decimal(l.total_price)), new Decimal(0))
    .toNumber();

  const gstSupply = calcGST(subtotalSupply, 'supply');
  const gstWorks = calcGST(subtotalWorks, 'works_contract');
  const totalBeforeDiscount = new Decimal(subtotalSupply)
    .add(subtotalWorks)
    .add(gstSupply)
    .add(gstWorks)
    .toNumber();
  const totalAfterDiscount = new Decimal(totalBeforeDiscount).sub(discount).toNumber();

  return {
    subtotalSupply,
    subtotalWorks,
    gstSupply,
    gstWorks,
    totalBeforeDiscount,
    totalAfterDiscount,
  };
}

export function validatePaymentSchedule(percentages: number[]): { valid: boolean; sum: number } {
  const sum = percentages.reduce(
    (s, p) => new Decimal(s).add(new Decimal(p)).toNumber(),
    0
  );
  return { valid: sum === 100, sum };
}

export function calcMarginPct(revenue: number, cost: number): number {
  if (revenue === 0) return 0;
  return new Decimal(revenue).sub(cost).div(revenue).mul(100).toDP(2).toNumber();
}
