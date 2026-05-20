/**
 * Repro the "Cannot read properties of null (reading 'props')" Quick Quote
 * PDF render error. Builds a minimal-but-realistic ProposalPDFData directly
 * from the admin client (no cookies dependency) and feeds it to renderToBuffer.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import React from 'react';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY!;

async function loadPdfData(proposalNumber: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: p } = await supabase
    .from('proposals')
    .select('*, leads!proposals_lead_id_fkey(customer_name, phone, email, city, segment)')
    .eq('proposal_number', proposalNumber)
    .single();

  if (!p) throw new Error(`Proposal ${proposalNumber} not found`);

  const { data: bom } = await supabase
    .from('proposal_bom_lines')
    .select('*')
    .eq('proposal_id', p.id)
    .order('line_number');

  const { data: ms } = await supabase
    .from('proposal_payment_schedule')
    .select('*')
    .eq('proposal_id', p.id)
    .order('milestone_order');

  const lead = (p as any).leads ?? {};

  return {
    proposalNumber:       p.proposal_number ?? proposalNumber,
    createdAt:            p.created_at ?? new Date().toISOString(),
    validUntil:           p.valid_until ?? '',
    isBudgetary:          !!p.is_budgetary,
    status:               p.status ?? 'draft',
    systemType:           p.system_type ?? 'on_grid',
    systemSizeKwp:        Number(p.system_size_kwp ?? 0),
    structureType:        p.structure_type,
    notes:                p.notes,
    panelBrand:           p.panel_brand,
    panelModel:           p.panel_model,
    panelWattage:         p.panel_wattage,
    panelCount:           p.panel_count,
    inverterBrand:        p.inverter_brand,
    inverterModel:        p.inverter_model,
    inverterCapacityKw:   p.inverter_capacity_kw,
    batteryBrand:         p.battery_brand,
    batteryModel:         p.battery_model,
    batteryCapacityKwh:   p.battery_capacity_kwh,
    customerName:         lead.customer_name ?? 'Customer',
    customerPhone:        lead.phone ?? null,
    customerEmail:        lead.email ?? null,
    customerCity:         lead.city ?? null,
    segment:              lead.segment ?? 'residential',
    subtotalSupply:       Number(p.subtotal_supply ?? 0),
    subtotalWorks:        Number(p.subtotal_works ?? 0),
    gstSupply:            Number(p.gst_supply_amount ?? 0),
    gstWorks:             Number(p.gst_works_amount ?? 0),
    totalBeforeDiscount:  Number(p.total_before_discount ?? 0),
    discountAmount:       Number(p.discount_amount ?? 0),
    totalAfterDiscount:   Number(p.total_after_discount ?? 0),
    bomLines: (bom ?? []).map((b: any) => ({
      lineNumber:  b.line_number,
      category:    b.item_category,
      description: b.item_description,
      brand:       b.brand,
      model:       b.model,
      hsnCode:     b.hsn_code,
      quantity:    Number(b.quantity),
      unit:        b.unit,
      unitPrice:   Number(b.unit_price),
      totalPrice:  Number(b.total_price),
      gstType:     b.gst_type,
      gstRate:     Number(b.gst_rate),
      gstAmount:   Number(b.gst_amount),
      scopeOwner:  b.scope_owner,
    })),
    milestones: (ms ?? []).map((m: any) => ({
      order:       m.milestone_order,
      name:        m.milestone_name,
      percentage:  Number(m.percentage),
      amount:      Number(m.amount),
      trigger:     m.due_trigger,
    })),
    simulation: null,
  };
}

async function main() {
  const proposalNumber = process.argv[2] ?? 'SHIROI/PROP/2026-27/0299';

  const data = await loadPdfData(proposalNumber);
  console.log(`Loaded ${proposalNumber}:`, {
    isBudgetary:       data.isBudgetary,
    systemSizeKwp:     data.systemSizeKwp,
    bomLineCount:      data.bomLines.length,
    milestoneCount:    data.milestones.length,
    customerName:      data.customerName,
    structureType:     data.structureType,
    totalAfterDiscount: data.totalAfterDiscount,
  });

  const { BudgetaryQuotePDF } = await import('../apps/erp/src/lib/pdf/budgetary-quote-pdf');
  const { DetailedProposalPDF } = await import('../apps/erp/src/lib/pdf/detailed-proposal-pdf');

  const Component = data.isBudgetary ? BudgetaryQuotePDF : DetailedProposalPDF;

  console.log(`\nRendering ${data.isBudgetary ? 'BudgetaryQuotePDF' : 'DetailedProposalPDF'} ...`);
  try {
    const buf = await renderToBuffer(React.createElement(Component, { data: data as any }) as any);
    console.log(`✓ Render succeeded, ${buf.length} bytes`);
  } catch (e: any) {
    console.error('✗ Render failed:', e.message);
    console.error('\nStack:\n', e.stack);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
