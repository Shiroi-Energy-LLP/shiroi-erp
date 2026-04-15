'use server';

/**
 * quote-actions.ts — the thin layer that exposes the existing proposal engine
 * as the new Sales-tab flow.
 *
 * Three new actions added for the Marketing + Design revamp (migrations 051-053):
 *
 *   1. createDraftDetailedProposal(leadId)
 *      Pre-creates a draft detailed proposal when a lead enters Path B
 *      (site_survey_scheduled). Designers build BOM directly into
 *      proposal_bom_lines via the /design/[leadId] workspace. No wizard.
 *
 *   2. finalizeDetailedProposal(proposalId)
 *      One-click finalizer fired from the Sales Quote tab after design is
 *      confirmed. Recomputes totals against current price book rates,
 *      bakes in locked consultant commission, stamps sent_at, flips the
 *      lead to detailed_proposal_sent.
 *
 *   3. escalateQuickToDetailed(leadId)
 *      For when a quick-quote lead turns out to need proper engineering.
 *      Transitions the lead status from quick_quote_sent back to
 *      site_survey_scheduled and pre-creates the draft detailed proposal.
 *      Preserves the quick quote row for reference.
 *
 * All three return ActionResult<T> and never throw.
 */

import Decimal from 'decimal.js';
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { ok, err, type ActionResult } from './types/actions';

type Lead = Database['public']['Tables']['leads']['Row'];
type Proposal = Database['public']['Tables']['proposals']['Row'];
type ProposalBomLine = Database['public']['Tables']['proposal_bom_lines']['Row'];
type LeadStatus = Database['public']['Enums']['lead_status'];

// ----------------------------------------------------------------------------
// createDraftDetailedProposal
// ----------------------------------------------------------------------------

export async function createDraftDetailedProposal(
  leadId: string,
): Promise<ActionResult<{ proposalId: string }>> {
  const op = '[createDraftDetailedProposal]';
  console.log(`${op} Starting for lead: ${leadId}`);

  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();

    // Resolve caller's employee id for prepared_by
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (empErr) return err(empErr.message, empErr.code);
    if (!employee) return err('Employee record not found for current user');

    // Fetch the lead
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, system_type, estimated_size_kwp, draft_proposal_id')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, leadErr.code);
    if (!lead) return err('Lead not found');

    // If a draft already exists for this lead, return it (idempotent)
    if (lead.draft_proposal_id) {
      const { data: existing } = await supabase
        .from('proposals')
        .select('id, status')
        .eq('id', lead.draft_proposal_id)
        .maybeSingle();
      if (existing && existing.status === 'draft') {
        return ok({ proposalId: existing.id });
      }
    }

    // Generate proposal number
    const { data: docNum, error: docErr } = await supabase.rpc('generate_doc_number', {
      doc_type: 'PROP',
    });
    if (docErr || !docNum) {
      return err(`Failed to generate proposal number: ${docErr?.message ?? 'unknown'}`);
    }

    // Insert draft proposal shell
    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .insert({
        lead_id: leadId,
        proposal_number: docNum as string,
        prepared_by: employee.id,
        system_size_kwp: lead.estimated_size_kwp ?? 0,
        system_type: lead.system_type ?? 'on_grid',
        subtotal_supply: 0,
        subtotal_works: 0,
        gst_supply_amount: 0,
        gst_works_amount: 0,
        total_before_discount: 0,
        discount_amount: 0,
        total_after_discount: 0,
        shiroi_cost: 0,
        shiroi_revenue: 0,
        gross_margin_amount: 0,
        gross_margin_pct: 0,
        status: 'draft',
        is_budgetary: false,
        notes: 'Draft detailed proposal - BOM will be composed in /design workspace.',
      } as never)
      .select('id')
      .single();

    if (propErr) return err(propErr.message, propErr.code);

    // Update lead with draft_proposal_id pointer
    const { error: updErr } = await supabase
      .from('leads')
      .update({ draft_proposal_id: proposal.id })
      .eq('id', leadId);
    if (updErr) return err(updErr.message, updErr.code);

    console.log(`${op} Created draft detailed proposal ${proposal.id} for lead ${leadId}`);
    return ok({ proposalId: proposal.id });
  } catch (e) {
    console.error(`${op} Failed:`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ----------------------------------------------------------------------------
// finalizeDetailedProposal
// ----------------------------------------------------------------------------

export async function finalizeDetailedProposal(
  proposalId: string,
): Promise<ActionResult<{ proposalId: string; totalAfterDiscount: number; baseQuotePrice: number }>> {
  const op = '[finalizeDetailedProposal]';
  console.log(`${op} Starting for proposal: ${proposalId}`);

  try {
    if (!proposalId) return err('Missing proposalId');

    const supabase = await createClient();

    // Fetch proposal + lead + bom lines in parallel
    const [proposalRes, bomRes] = await Promise.all([
      supabase
        .from('proposals')
        .select('id, lead_id, status, is_budgetary, discount_amount')
        .eq('id', proposalId)
        .maybeSingle(),
      supabase
        .from('proposal_bom_lines')
        .select(
          'id, item_category, quantity, unit_price, total_price, gst_type, gst_rate, gst_amount, scope_owner, raw_estimated_cost, price_book_id',
        )
        .eq('proposal_id', proposalId),
    ]);

    if (proposalRes.error) return err(proposalRes.error.message, proposalRes.error.code);
    if (!proposalRes.data) return err('Proposal not found');
    if (proposalRes.data.status !== 'draft') {
      return err(`Proposal is already in status '${proposalRes.data.status}' - cannot re-finalize`);
    }
    if (proposalRes.data.is_budgetary) {
      return err('Cannot finalize a budgetary quote as a detailed proposal');
    }
    if (bomRes.error) return err(bomRes.error.message, bomRes.error.code);

    type BomRow = Pick<
      ProposalBomLine,
      | 'id'
      | 'item_category'
      | 'quantity'
      | 'unit_price'
      | 'total_price'
      | 'gst_type'
      | 'gst_rate'
      | 'gst_amount'
      | 'scope_owner'
      | 'raw_estimated_cost'
      | 'price_book_id'
    >;

    const bomLines = (bomRes.data ?? []) as BomRow[];
    if (bomLines.length === 0) {
      return err('Proposal has no BOM lines - add at least one line via /design workspace before finalizing');
    }

    // Enforce price_book_id on every line (non-budgetary invariant)
    const unmatchedLines = bomLines.filter((l) => !l.price_book_id);
    if (unmatchedLines.length > 0) {
      return err(
        `${unmatchedLines.length} BOM line(s) are missing a price_book reference. Detailed proposals must be fully price-book-sourced.`,
      );
    }

    // Recompute totals (Shiroi scope only)
    const shiroiLines = bomLines.filter((l) => l.scope_owner === 'shiroi');
    const subtotalSupply = shiroiLines
      .filter((l) => l.gst_type === 'supply')
      .reduce((sum, l) => sum.add(l.total_price), new Decimal(0))
      .toNumber();
    const subtotalWorks = shiroiLines
      .filter((l) => l.gst_type === 'works_contract')
      .reduce((sum, l) => sum.add(l.total_price), new Decimal(0))
      .toNumber();
    const gstSupply = new Decimal(subtotalSupply).mul('0.05').toNumber();
    const gstWorks = new Decimal(subtotalWorks).mul('0.18').toNumber();
    const totalBeforeDiscount = new Decimal(subtotalSupply)
      .add(subtotalWorks)
      .add(gstSupply)
      .add(gstWorks)
      .toNumber();
    const totalAfterDiscount = new Decimal(totalBeforeDiscount)
      .sub(proposalRes.data.discount_amount ?? 0)
      .toNumber();

    const shiroiRevenue = new Decimal(subtotalSupply).add(subtotalWorks).toNumber();
    const shiroiCost = bomLines.reduce(
      (sum, l) => sum.add(l.raw_estimated_cost ?? 0),
      new Decimal(0),
    ).toNumber();
    const grossMarginAmount = new Decimal(shiroiRevenue).sub(shiroiCost).toNumber();
    const grossMarginPct = shiroiRevenue > 0
      ? new Decimal(grossMarginAmount).div(shiroiRevenue).mul(100).toDP(2).toNumber()
      : 0;

    const baseQuotePrice = totalAfterDiscount;

    // Update proposal
    const { error: propUpdErr } = await supabase
      .from('proposals')
      .update({
        subtotal_supply: subtotalSupply,
        subtotal_works: subtotalWorks,
        gst_supply_amount: gstSupply,
        gst_works_amount: gstWorks,
        total_before_discount: totalBeforeDiscount,
        total_after_discount: totalAfterDiscount,
        shiroi_cost: shiroiCost,
        shiroi_revenue: shiroiRevenue,
        gross_margin_amount: grossMarginAmount,
        gross_margin_pct: grossMarginPct,
        status: 'sent',
        sent_at: new Date().toISOString(),
      } as never)
      .eq('id', proposalId);

    if (propUpdErr) return err(propUpdErr.message, propUpdErr.code);

    // Update lead status + base_quote_price (triggers commission lock if partner assigned)
    const { error: leadUpdErr } = await supabase
      .from('leads')
      .update({
        status: 'detailed_proposal_sent' as LeadStatus,
        status_updated_at: new Date().toISOString(),
        base_quote_price: baseQuotePrice,
      })
      .eq('id', proposalRes.data.lead_id);

    if (leadUpdErr) return err(leadUpdErr.message, leadUpdErr.code);

    console.log(
      `${op} Finalized proposal ${proposalId}: base=${baseQuotePrice}, margin=${grossMarginPct}%`,
    );
    return ok({ proposalId, totalAfterDiscount, baseQuotePrice });
  } catch (e) {
    console.error(`${op} Failed:`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ----------------------------------------------------------------------------
// escalateQuickToDetailed
// ----------------------------------------------------------------------------

export async function escalateQuickToDetailed(
  leadId: string,
): Promise<ActionResult<{ proposalId: string }>> {
  const op = '[escalateQuickToDetailed]';
  console.log(`${op} Starting for lead: ${leadId}`);

  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();

    // Verify the lead is in a state that can be escalated
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, status, draft_proposal_id')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, leadErr.code);
    if (!lead) return err('Lead not found');
    if (lead.status !== 'quick_quote_sent' && lead.status !== 'contacted') {
      return err(`Lead is in '${lead.status}' - only quick_quote_sent or contacted leads can be escalated`);
    }

    // Transition to site_survey_scheduled
    const { error: updErr } = await supabase
      .from('leads')
      .update({
        status: 'site_survey_scheduled' as LeadStatus,
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', leadId);
    if (updErr) return err(updErr.message, updErr.code);

    // Pre-create the draft detailed proposal
    const draftResult = await createDraftDetailedProposal(leadId);
    if (!draftResult.success) {
      return err(`Transition succeeded but draft proposal creation failed: ${draftResult.error}`);
    }

    console.log(`${op} Escalated lead ${leadId} to detailed path, draft proposal ${draftResult.data.proposalId}`);
    return ok({ proposalId: draftResult.data.proposalId });
  } catch (e) {
    console.error(`${op} Failed:`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ----------------------------------------------------------------------------
// updateQuoteBomLine - inline BOM edits from the Quote tab and /design workspace
// ----------------------------------------------------------------------------

export async function addBomLineFromPriceBook(
  proposalId: string,
  priceBookId: string,
  quantity: number,
): Promise<ActionResult<{ lineId: string }>> {
  const op = '[addBomLineFromPriceBook]';

  try {
    if (!proposalId || !priceBookId) return err('Missing proposalId or priceBookId');
    if (quantity <= 0) return err('Quantity must be positive');

    const supabase = await createClient();

    // Fetch the price_book row
    const { data: pb, error: pbErr } = await supabase
      .from('price_book')
      .select('id, item_category, item_description, brand, model, hsn_code, unit, base_price, gst_type, gst_rate')
      .eq('id', priceBookId)
      .eq('is_active', true)
      .maybeSingle();
    if (pbErr) return err(pbErr.message, pbErr.code);
    if (!pb) return err('Price book item not found or inactive');

    const totalPrice = new Decimal(quantity).mul(pb.base_price).toDP(2).toNumber();
    const gstRateDecimal = pb.gst_type === 'supply' ? '0.05' : '0.18';
    const gstAmount = new Decimal(totalPrice).mul(gstRateDecimal).toDP(2).toNumber();

    // Find next line number
    const { data: maxLine } = await supabase
      .from('proposal_bom_lines')
      .select('line_number')
      .eq('proposal_id', proposalId)
      .order('line_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lineNumber = (maxLine?.line_number ?? 0) + 1;

    const { data: line, error: insErr } = await supabase
      .from('proposal_bom_lines')
      .insert({
        proposal_id: proposalId,
        line_number: lineNumber,
        price_book_id: pb.id,
        item_category: pb.item_category,
        item_description: pb.item_description,
        brand: pb.brand,
        model: pb.model,
        hsn_code: pb.hsn_code,
        quantity,
        unit: pb.unit,
        unit_price: pb.base_price,
        total_price: totalPrice,
        gst_type: pb.gst_type,
        gst_rate: pb.gst_rate,
        gst_amount: gstAmount,
        scope_owner: 'shiroi',
        raw_estimated_cost: totalPrice,
      } as never)
      .select('id')
      .single();

    if (insErr) return err(insErr.message, insErr.code);

    console.log(`${op} Added line ${line.id} to proposal ${proposalId}`);
    return ok({ lineId: line.id });
  } catch (e) {
    console.error(`${op} Failed:`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function removeBomLine(
  lineId: string,
): Promise<ActionResult<null>> {
  const op = '[removeBomLine]';
  try {
    if (!lineId) return err('Missing lineId');
    const supabase = await createClient();
    const { error } = await supabase.from('proposal_bom_lines').delete().eq('id', lineId);
    if (error) return err(error.message, error.code);
    return ok(null);
  } catch (e) {
    console.error(`${op} Failed:`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function updateBomLineQuantity(
  lineId: string,
  newQuantity: number,
): Promise<ActionResult<null>> {
  const op = '[updateBomLineQuantity]';
  try {
    if (!lineId) return err('Missing lineId');
    if (newQuantity <= 0) return err('Quantity must be positive');
    const supabase = await createClient();

    const { data: line, error: readErr } = await supabase
      .from('proposal_bom_lines')
      .select('unit_price, gst_type')
      .eq('id', lineId)
      .maybeSingle();
    if (readErr) return err(readErr.message, readErr.code);
    if (!line) return err('BOM line not found');

    const totalPrice = new Decimal(newQuantity).mul(line.unit_price).toDP(2).toNumber();
    const gstRateDecimal = line.gst_type === 'supply' ? '0.05' : '0.18';
    const gstAmount = new Decimal(totalPrice).mul(gstRateDecimal).toDP(2).toNumber();

    const { error: updErr } = await supabase
      .from('proposal_bom_lines')
      .update({
        quantity: newQuantity,
        total_price: totalPrice,
        gst_amount: gstAmount,
        raw_estimated_cost: totalPrice,
      })
      .eq('id', lineId);
    if (updErr) return err(updErr.message, updErr.code);

    return ok(null);
  } catch (e) {
    console.error(`${op} Failed:`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
