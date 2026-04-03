// apps/erp/src/lib/pdf/proposal-pdf-data.ts
import { createClient } from '@repo/supabase/server';

export interface ProposalPDFData {
  // Proposal
  proposalNumber: string;
  createdAt: string;
  validUntil: string;
  isBudgetary: boolean;
  status: string;
  systemType: string;
  systemSizeKwp: number;
  structureType: string | null;
  notes: string | null;

  // System config
  panelBrand: string | null;
  panelModel: string | null;
  panelWattage: number | null;
  panelCount: number | null;
  inverterBrand: string | null;
  inverterModel: string | null;
  inverterCapacityKw: number | null;
  batteryBrand: string | null;
  batteryModel: string | null;
  batteryCapacityKwh: number | null;

  // Customer
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerCity: string | null;
  segment: string;

  // Financials
  subtotalSupply: number;
  subtotalWorks: number;
  gstSupply: number;
  gstWorks: number;
  totalBeforeDiscount: number;
  discountAmount: number;
  totalAfterDiscount: number;

  // BOM
  bomLines: Array<{
    lineNumber: number;
    category: string;
    description: string;
    brand: string | null;
    model: string | null;
    hsnCode: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    gstType: string;
    gstRate: number;
    gstAmount: number;
    scopeOwner: string;
  }>;

  // Payment schedule
  milestones: Array<{
    order: number;
    name: string;
    percentage: number;
    amount: number;
    trigger: string;
  }>;

  // Simulation (may be null if not run yet)
  simulation: {
    annualKwh: number;
    monthlyKwh: number[];
    tariffRate: number;
    annualSavingsYr1: number;
    paybackYears: number;
    degradationRate: number;
    tariffEscalation: number;
    year1Kwh: number;
    year5Kwh: number;
    year10Kwh: number;
    year25Kwh: number;
  } | null;
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export { formatINR };

export async function assembleProposalPDFData(proposalId: string): Promise<ProposalPDFData> {
  const op = '[assembleProposalPDFData]';
  console.log(`${op} Starting for proposal: ${proposalId}`);

  const supabase = await createClient();

  // Fetch proposal with lead and BOM
  const { data: proposal, error: propErr } = await supabase
    .from('proposals')
    .select(`
      *,
      leads!proposals_lead_id_fkey(customer_name, phone, email, city, segment),
      proposal_bom_lines(*),
      proposal_payment_schedule(*)
    `)
    .eq('id', proposalId)
    .single();

  if (propErr) {
    console.error(`${op} Proposal query failed:`, { code: propErr.code, message: propErr.message });
    throw new Error(`Failed to fetch proposal: ${propErr.message}`);
  }
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

  const lead = proposal.leads as Record<string, unknown> | null;

  // Fetch simulation if exists
  const { data: sim } = await supabase
    .from('proposal_simulations')
    .select('*')
    .eq('proposal_id', proposalId)
    .eq('is_primary', true)
    .maybeSingle();

  const bomLines = ((proposal.proposal_bom_lines ?? []) as Array<Record<string, unknown>>)
    .sort((a, b) => (a.line_number as number) - (b.line_number as number))
    .map(l => ({
      lineNumber: l.line_number as number,
      category: l.item_category as string,
      description: l.item_description as string,
      brand: l.brand as string | null,
      model: l.model as string | null,
      hsnCode: l.hsn_code as string | null,
      quantity: l.quantity as number,
      unit: l.unit as string,
      unitPrice: l.unit_price as number,
      totalPrice: l.total_price as number,
      gstType: l.gst_type as string,
      gstRate: l.gst_rate as number,
      gstAmount: l.gst_amount as number,
      scopeOwner: l.scope_owner as string,
    }));

  const milestones = ((proposal.proposal_payment_schedule ?? []) as Array<Record<string, unknown>>)
    .sort((a, b) => (a.milestone_order as number) - (b.milestone_order as number))
    .map(m => ({
      order: m.milestone_order as number,
      name: m.milestone_name as string,
      percentage: m.percentage as number,
      amount: m.amount as number,
      trigger: m.due_trigger as string,
    }));

  // Build simulation data if present
  let simulation: ProposalPDFData['simulation'] = null;
  if (sim) {
    const annualKwh = (sim as Record<string, unknown>).annual_kwh as number;
    const degradation = ((sim as Record<string, unknown>).degradation_rate as number) ?? 0.005;
    simulation = {
      annualKwh,
      monthlyKwh: ((sim as Record<string, unknown>).monthly_kwh as number[]) ?? [],
      tariffRate: ((sim as Record<string, unknown>).tariff_rate as number) ?? 0,
      annualSavingsYr1: ((sim as Record<string, unknown>).annual_savings_yr1 as number) ?? 0,
      paybackYears: ((sim as Record<string, unknown>).payback_years as number) ?? 0,
      degradationRate: degradation,
      tariffEscalation: ((sim as Record<string, unknown>).tariff_escalation_pct as number) ?? 3.0,
      year1Kwh: annualKwh,
      year5Kwh: Math.round(annualKwh * Math.pow(1 - degradation, 4)),
      year10Kwh: Math.round(annualKwh * Math.pow(1 - degradation, 9)),
      year25Kwh: Math.round(annualKwh * Math.pow(1 - degradation, 24)),
    };
  }

  return {
    proposalNumber: proposal.proposal_number,
    createdAt: proposal.created_at,
    validUntil: proposal.valid_until,
    isBudgetary: proposal.is_budgetary ?? false,
    status: proposal.status,
    systemType: proposal.system_type,
    systemSizeKwp: proposal.system_size_kwp,
    structureType: proposal.structure_type,
    notes: proposal.notes,
    panelBrand: proposal.panel_brand,
    panelModel: proposal.panel_model,
    panelWattage: proposal.panel_wattage,
    panelCount: proposal.panel_count,
    inverterBrand: proposal.inverter_brand,
    inverterModel: proposal.inverter_model,
    inverterCapacityKw: proposal.inverter_capacity_kw,
    batteryBrand: proposal.battery_brand,
    batteryModel: proposal.battery_model,
    batteryCapacityKwh: proposal.battery_capacity_kwh,
    customerName: (lead?.customer_name as string) ?? 'Unknown',
    customerPhone: (lead?.phone as string) ?? null,
    customerEmail: (lead?.email as string) ?? null,
    customerCity: (lead?.city as string) ?? null,
    segment: (lead?.segment as string) ?? 'residential',
    subtotalSupply: proposal.subtotal_supply,
    subtotalWorks: proposal.subtotal_works,
    gstSupply: proposal.gst_supply_amount,
    gstWorks: proposal.gst_works_amount,
    totalBeforeDiscount: proposal.total_before_discount,
    discountAmount: proposal.discount_amount,
    totalAfterDiscount: proposal.total_after_discount,
    bomLines,
    milestones,
    simulation,
  };
}
