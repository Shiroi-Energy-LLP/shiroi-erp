'use server';

import { createClient } from '@repo/supabase/server';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';

type GSTType = 'supply' | 'works_contract';
type ScopeOwner = 'shiroi' | 'client' | 'builder' | 'excluded';
type SystemType = 'on_grid' | 'hybrid' | 'off_grid';

const GST_RATES: Record<GSTType, string> = {
  supply: '0.05',
  works_contract: '0.18',
};

// Maps wizard trigger display strings → DB enum values
const TRIGGER_MAP: Record<string, string> = {
  'On booking': 'on_acceptance',
  'On material delivery': 'on_material_delivery',
  'On structure erection': 'mid_installation',
  'On panel mounting': 'mid_installation',
  'On commissioning': 'on_commissioning',
  'On net metering approval': 'after_net_metering',
};

// Maps wizard category display labels → DB enum values
const CATEGORY_MAP: Record<string, string> = {
  'Solar Panels': 'panel',
  'Inverter': 'inverter',
  'Battery': 'battery',
  'Mounting Structure': 'structure',
  'Electrical': 'dc_cable',
  'Civil Works': 'civil_work',
  'Labour': 'installation_labour',
  'Net Metering': 'net_meter',
  'Safety Equipment': 'earthing',
  'Other': 'other',
};

interface BOMLineInput {
  item_category: string;
  item_description: string;
  brand: string;
  model: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_type: GSTType;
  scope_owner: ScopeOwner;
}

interface MilestoneInput {
  milestone_name: string;
  percentage: number;
  due_trigger: string;
  custom_trigger_description: string;
  invoice_type: string;
}

interface CreateProposalInput {
  leadId: string;
  systemType: SystemType;
  systemSizeKwp: number;
  panelBrand: string;
  panelModel: string;
  panelWattage: number;
  panelCount: number;
  inverterBrand: string;
  inverterModel: string;
  inverterCapacity: number;
  batteryBrand: string;
  batteryModel: string;
  batteryCapacity: number;
  structureType: string;
  discount: number;
  notes: string;
  bomLines: BOMLineInput[];
  milestones: MilestoneInput[];
}

export async function createProposalAction(input: CreateProposalInput): Promise<{ proposalId?: string; error?: string }> {
  const op = '[createProposalAction]';
  console.log(`${op} Starting for lead: ${input.leadId}`);

  try {
    const supabase = await createClient();

    // Get current user's employee record
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .single();
    if (!employee) return { error: 'Employee record not found' };

    // Generate proposal number
    const { data: docNum, error: docErr } = await supabase.rpc('generate_doc_number', { doc_type: 'PROP' });
    if (docErr || !docNum) {
      console.error(`${op} Failed to generate proposal number:`, docErr);
      return { error: `Failed to generate proposal number: ${docErr?.message}` };
    }

    // Compute BOM line totals
    const computedLines = input.bomLines.map((line, idx) => {
      const totalPrice = new Decimal(line.quantity).mul(line.unit_price).toNumber();
      const gstRate = line.gst_type === 'supply' ? 5.0 : 18.0;
      const gstAmount = new Decimal(totalPrice).mul(GST_RATES[line.gst_type]).toNumber();
      const dbCategory = CATEGORY_MAP[line.item_category] || line.item_category;

      return {
        line_number: idx + 1,
        item_category: dbCategory,
        item_description: line.item_description,
        brand: line.brand || null,
        model: line.model || null,
        hsn_code: line.hsn_code || null,
        quantity: line.quantity,
        unit: line.unit.toLowerCase(),
        unit_price: line.unit_price,
        total_price: totalPrice,
        gst_type: line.gst_type,
        gst_rate: gstRate,
        gst_amount: gstAmount,
        scope_owner: line.scope_owner,
      };
    });

    // Compute proposal totals (Shiroi scope only)
    const shiroiLines = computedLines.filter(l => l.scope_owner === 'shiroi');
    const subtotalSupply = shiroiLines
      .filter(l => l.gst_type === 'supply')
      .reduce((sum, l) => sum.add(l.total_price), new Decimal(0))
      .toNumber();
    const subtotalWorks = shiroiLines
      .filter(l => l.gst_type === 'works_contract')
      .reduce((sum, l) => sum.add(l.total_price), new Decimal(0))
      .toNumber();
    const gstSupply = new Decimal(subtotalSupply).mul('0.05').toNumber();
    const gstWorks = new Decimal(subtotalWorks).mul('0.18').toNumber();
    const totalBeforeDiscount = new Decimal(subtotalSupply).add(subtotalWorks).add(gstSupply).add(gstWorks).toNumber();
    const totalAfterDiscount = new Decimal(totalBeforeDiscount).sub(input.discount).toNumber();

    // Margin calculation
    const shiroiRevenue = new Decimal(subtotalSupply).add(subtotalWorks).toNumber();
    const shiroiCost = shiroiRevenue; // No correction factors applied yet
    const grossMarginAmount = new Decimal(shiroiRevenue).sub(shiroiCost).toNumber();
    const grossMarginPct = shiroiRevenue > 0
      ? new Decimal(grossMarginAmount).div(shiroiRevenue).mul(100).toDP(2).toNumber()
      : 0;

    // Valid for 30 days
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    // Insert proposal
    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .insert({
        lead_id: input.leadId,
        proposal_number: docNum,
        prepared_by: employee.id,
        system_size_kwp: input.systemSizeKwp,
        system_type: input.systemType,
        panel_brand: input.panelBrand || null,
        panel_model: input.panelModel || null,
        panel_wattage: input.panelWattage || null,
        panel_count: input.panelCount || null,
        inverter_brand: input.inverterBrand || null,
        inverter_model: input.inverterModel || null,
        inverter_capacity_kw: input.inverterCapacity || null,
        battery_brand: input.batteryBrand || null,
        battery_model: input.batteryModel || null,
        battery_capacity_kwh: input.batteryCapacity || null,
        structure_type: input.structureType || null,
        subtotal_supply: subtotalSupply,
        subtotal_works: subtotalWorks,
        gst_supply_amount: gstSupply,
        gst_works_amount: gstWorks,
        total_before_discount: totalBeforeDiscount,
        discount_amount: input.discount,
        total_after_discount: totalAfterDiscount,
        shiroi_cost: shiroiCost,
        shiroi_revenue: shiroiRevenue,
        gross_margin_amount: grossMarginAmount,
        gross_margin_pct: grossMarginPct,
        valid_until: validUntil.toISOString().split('T')[0],
        status: 'draft',
        notes: input.notes || null,
      })
      .select('id')
      .single();

    if (propErr) {
      console.error(`${op} Proposal insert failed:`, { code: propErr.code, message: propErr.message });
      return { error: `Failed to create proposal: ${propErr.message}` };
    }

    // Insert BOM lines
    if (computedLines.length > 0) {
      const bomInserts = computedLines.map(line => ({
        proposal_id: proposal.id,
        ...line,
      }));
      const { error: bomErr } = await supabase.from('proposal_bom_lines').insert(bomInserts);
      if (bomErr) {
        console.error(`${op} BOM lines insert failed:`, bomErr.message);
        // Don't fail the whole operation — proposal is created, BOM can be added later
      }
    }

    // Insert payment milestones
    if (input.milestones.length > 0) {
      const milestoneInserts = input.milestones.map((m, idx) => ({
        proposal_id: proposal.id,
        milestone_order: idx + 1,
        milestone_name: m.milestone_name,
        percentage: m.percentage,
        amount: new Decimal(totalAfterDiscount).mul(m.percentage).div(100).toDP(2).toNumber(),
        due_trigger: TRIGGER_MAP[m.due_trigger] || 'custom',
        custom_trigger_description: m.custom_trigger_description || null,
        invoice_type: m.invoice_type || 'proforma',
      }));
      const { error: msErr } = await supabase.from('proposal_payment_schedule').insert(milestoneInserts);
      if (msErr) {
        console.error(`${op} Payment schedule insert failed:`, msErr.message);
      }
    }

    console.log(`${op} Created proposal ${docNum} (id: ${proposal.id})`);
    return { proposalId: proposal.id };

  } catch (error) {
    console.error(`${op} Failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ─── Budgetary Quote (Quick Quote) ─────────────────────────────────────

interface BudgetaryQuoteActionInput {
  leadId: string;
  systemSizeKwp: number;
  systemType: SystemType;
  segment: string;
  structureType: string;
  includeLiaison: boolean;
  includeCivil: boolean;
}

export async function createBudgetaryQuoteAction(
  input: BudgetaryQuoteActionInput
): Promise<{ proposalId?: string; error?: string }> {
  const op = '[createBudgetaryQuoteAction]';
  console.log(`${op} Starting for lead: ${input.leadId}`);

  try {
    const supabase = await createClient();

    // Get current user's employee record
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .single();
    if (!employee) return { error: 'Employee record not found' };

    // Fetch price book and correction factors
    const { getActivePriceBookItems, getCorrectionFactors } = await import('./price-book-queries');
    const { generateBudgetaryBOM } = await import('./budgetary-quote');

    const priceBook = await getActivePriceBookItems();
    const corrections = await getCorrectionFactors(input.systemType, input.segment);

    if (priceBook.length === 0) {
      return { error: 'Price book is empty. Add items to the price book first.' };
    }

    // Generate BOM lines
    const bomLines = generateBudgetaryBOM(
      {
        systemSizeKwp: input.systemSizeKwp,
        systemType: input.systemType,
        segment: input.segment,
        structureType: input.structureType,
        includeLiaison: input.includeLiaison,
        includeCivil: input.includeCivil,
      },
      priceBook,
      corrections,
    );

    if (bomLines.length === 0) {
      return { error: 'Could not generate BOM — no matching price book items found.' };
    }

    // Generate proposal number
    const { data: docNum, error: docErr } = await supabase.rpc('generate_doc_number', { doc_type: 'PROP' });
    if (docErr || !docNum) {
      console.error(`${op} Failed to generate proposal number:`, docErr);
      return { error: `Failed to generate proposal number: ${docErr?.message}` };
    }

    // Compute totals from generated BOM lines
    const shiroiLines = bomLines.filter(l => l.scope_owner === 'shiroi');
    const subtotalSupply = shiroiLines
      .filter(l => l.gst_type === 'supply')
      .reduce((sum, l) => sum.add(l.total_price), new Decimal(0))
      .toNumber();
    const subtotalWorks = shiroiLines
      .filter(l => l.gst_type === 'works_contract')
      .reduce((sum, l) => sum.add(l.total_price), new Decimal(0))
      .toNumber();
    const gstSupply = new Decimal(subtotalSupply).mul('0.05').toNumber();
    const gstWorks = new Decimal(subtotalWorks).mul('0.18').toNumber();
    const totalBeforeDiscount = new Decimal(subtotalSupply).add(subtotalWorks).add(gstSupply).add(gstWorks).toNumber();
    const totalAfterDiscount = totalBeforeDiscount; // No discount on budgetary quotes

    const shiroiRevenue = new Decimal(subtotalSupply).add(subtotalWorks).toNumber();

    // Get panel info from generated BOM
    const panelLine = bomLines.find(l => l.item_category === 'panel');
    const inverterLine = bomLines.find(l => l.item_category === 'inverter');

    // Valid for 30 days
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    // Insert proposal
    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .insert({
        lead_id: input.leadId,
        proposal_number: docNum,
        prepared_by: employee.id,
        system_size_kwp: input.systemSizeKwp,
        system_type: input.systemType,
        panel_brand: panelLine?.brand ?? null,
        panel_model: panelLine?.model ?? null,
        panel_wattage: panelLine ? parseInt(panelLine.model ?? '0', 10) || null : null,
        panel_count: panelLine?.quantity ?? null,
        inverter_brand: inverterLine?.brand ?? null,
        inverter_model: inverterLine?.model ?? null,
        inverter_capacity_kw: input.systemSizeKwp,
        structure_type: input.structureType,
        subtotal_supply: subtotalSupply,
        subtotal_works: subtotalWorks,
        gst_supply_amount: gstSupply,
        gst_works_amount: gstWorks,
        total_before_discount: totalBeforeDiscount,
        discount_amount: 0,
        total_after_discount: totalAfterDiscount,
        shiroi_cost: shiroiRevenue,
        shiroi_revenue: shiroiRevenue,
        gross_margin_amount: 0,
        gross_margin_pct: 0,
        valid_until: validUntil.toISOString().split('T')[0],
        status: 'draft',
        is_budgetary: true,
        notes: `Auto-generated budgetary quote. Structure: ${input.structureType}. Liaison: ${input.includeLiaison ? 'included' : 'excluded'}. Civil: ${input.includeCivil ? 'included' : 'excluded'}.`,
      })
      .select('id')
      .single();

    if (propErr) {
      console.error(`${op} Proposal insert failed:`, { code: propErr.code, message: propErr.message });
      return { error: `Failed to create proposal: ${propErr.message}` };
    }

    // Insert BOM lines
    const bomInserts = bomLines.map((line, idx) => ({
      proposal_id: proposal.id,
      line_number: idx + 1,
      item_category: line.item_category,
      item_description: line.item_description,
      brand: line.brand,
      model: line.model,
      hsn_code: line.hsn_code,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      total_price: line.total_price,
      gst_type: line.gst_type,
      gst_rate: line.gst_rate,
      gst_amount: line.gst_amount,
      scope_owner: line.scope_owner,
      raw_estimated_cost: line.raw_estimated_cost,
      correction_factor: line.correction_factor,
      corrected_cost: line.corrected_cost,
    }));
    const { error: bomErr } = await supabase.from('proposal_bom_lines').insert(bomInserts);
    if (bomErr) {
      console.error(`${op} BOM lines insert failed:`, bomErr.message);
    }

    // Insert default payment schedule: 50/40/10
    const defaultMilestones = [
      { milestone_name: 'Advance Payment', percentage: 50, due_trigger: 'on_acceptance' },
      { milestone_name: 'Material Delivery', percentage: 40, due_trigger: 'on_material_delivery' },
      { milestone_name: 'Commissioning', percentage: 10, due_trigger: 'on_commissioning' },
    ];
    const milestoneInserts = defaultMilestones.map((m, idx) => ({
      proposal_id: proposal.id,
      milestone_order: idx + 1,
      milestone_name: m.milestone_name,
      percentage: m.percentage,
      amount: new Decimal(totalAfterDiscount).mul(m.percentage).div(100).toDP(2).toNumber(),
      due_trigger: m.due_trigger,
      invoice_type: 'proforma',
    }));
    const { error: msErr } = await supabase.from('proposal_payment_schedule').insert(milestoneInserts);
    if (msErr) {
      console.error(`${op} Payment schedule insert failed:`, msErr.message);
    }

    console.log(`${op} Created budgetary quote ${docNum} (id: ${proposal.id})`);
    return { proposalId: proposal.id };

  } catch (error) {
    console.error(`${op} Failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
