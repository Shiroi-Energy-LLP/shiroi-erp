'use server';

/**
 * closure-actions.ts — the discount band state machine for the Closure Soon stage.
 *
 * Band thresholds (set by founder, starting defaults for post-revamp):
 *   Green  ≥ 10% → marketing_manager can approve alone, one-click flip to won
 *   Amber  8-10% → founder approval required via lead_closure_approvals
 *   Red    < 8%  → won transition blocked, lead must be renegotiated up or lost
 *
 * Gross margin formula (consultant commission NOT included — see plan D4):
 *
 *   Gross Margin = (base_quote_price - BOM Cost - Site Expenses Est.)
 *                  / base_quote_price * 100
 *
 * BOM Cost = sum(raw_estimated_cost) on the accepted/draft detailed proposal.
 * Site Expenses Est. = lead-level override (TBD; defaults to 0 for now).
 *
 * Non-async helpers (thresholds, Band type, classifyBand, computeSnapshot-
 * FromValues) live in `closure-helpers.ts` — Next.js forbids non-async
 * exports from a `'use server'` file.
 */

import Decimal from 'decimal.js';
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { ok, err, type ActionResult } from './types/actions';
import {
  AMBER_BAND_MIN_PCT,
  computeSnapshotFromValues,
  type MarginSnapshot,
} from './closure-helpers';

// Re-export type so existing callers that imported types from this file
// (notably components/sales/closure-band-badge.tsx on the `Band` type)
// keep working. Re-exported `type` is a pure type re-export and is
// allowed even from a 'use server' file.
export type { Band } from './closure-helpers';

type LeadStatus = Database['public']['Enums']['lead_status'];

/**
 * Compute the current margin + band for a lead based on its BOM + base price.
 * Pure read - does not mutate the lead.
 */
export async function computeMargin(leadId: string): Promise<ActionResult<MarginSnapshot>> {
  const op = '[computeMargin]';
  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();

    // Fetch lead + its draft or sent proposal + BOM lines
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, base_quote_price, draft_proposal_id')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, leadErr.code);
    if (!lead) return err('Lead not found');

    const basePrice = Number(lead.base_quote_price ?? 0);

    // Find the relevant proposal (draft, sent, or negotiating - not rejected/superseded)
    const { data: proposals, error: propErr } = await supabase
      .from('proposals')
      .select('id, status, is_budgetary, shiroi_cost, total_after_discount')
      .eq('lead_id', leadId)
      .in('status', ['draft', 'sent', 'viewed', 'negotiating'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (propErr) return err(propErr.message, propErr.code);
    const proposal = proposals?.[0];

    let bomCost = 0;
    if (proposal) {
      // Recompute BOM cost from lines (don't trust the stored shiroi_cost if it's stale)
      const { data: lines, error: bomErr } = await supabase
        .from('proposal_bom_lines')
        .select('raw_estimated_cost, scope_owner')
        .eq('proposal_id', proposal.id);
      if (bomErr) return err(bomErr.message, bomErr.code);

      bomCost = (lines ?? [])
        .filter((l) => l.scope_owner === 'shiroi')
        .reduce((sum, l) => sum.add(l.raw_estimated_cost ?? 0), new Decimal(0))
        .toNumber();

      // If basePrice wasn't set on the lead but we have a proposal total, use it
      if (basePrice === 0 && proposal.total_after_discount) {
        return computeSnapshotFromValues(Number(proposal.total_after_discount), bomCost, 0);
      }
    }

    return computeSnapshotFromValues(basePrice, bomCost, 0);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Attempt to flip a lead to 'won' from the closure_soon state.
 *
 * Behaviour by band:
 *   green  → flip immediately, no approval
 *   amber  → create a pending lead_closure_approvals row, notify founder, DO NOT flip
 *   red    → reject, return error
 */
export async function attemptWon(
  leadId: string,
  reason?: string,
): Promise<
  ActionResult<
    | { outcome: 'won'; newStatus: LeadStatus }
    | { outcome: 'approval_requested'; approvalId: string }
  >
> {
  const op = '[attemptWon]';
  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();

    // Resolve caller
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!employee) return err('Employee record not found');

    // Verify lead is in closure_soon or negotiation
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, status, base_quote_price')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, leadErr.code);
    if (!lead) return err('Lead not found');
    if (lead.status !== 'closure_soon' && lead.status !== 'negotiation') {
      return err(`Lead is in '${lead.status}' - must be in closure_soon or negotiation to flip won`);
    }

    // Compute current margin
    const snapshotResult = await computeMargin(leadId);
    if (!snapshotResult.success) return snapshotResult;
    const snapshot = snapshotResult.data;

    if (snapshot.band === 'red') {
      return err(
        `Gross margin is ${snapshot.grossMargin}% which is below the ${AMBER_BAND_MIN_PCT}% floor. Cannot flip to won - renegotiate or mark Lost.`,
      );
    }

    if (snapshot.band === 'amber') {
      // Create pending approval row
      const { data: approval, error: insErr } = await supabase
        .from('lead_closure_approvals')
        .insert({
          lead_id: leadId,
          requested_by: employee.id,
          band_at_request: 'amber',
          gross_margin_at_request: snapshot.grossMargin,
          final_base_price: snapshot.basePrice,
          reason: reason ?? null,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insErr) return err(insErr.message, insErr.code);

      // Notify founder(s)
      const { data: founders } = await supabase
        .from('employees')
        .select('id, profiles!inner(id, role)')
        .eq('profiles.role', 'founder');

      if (founders && founders.length > 0) {
        const notifications = founders.map((f) => ({
          recipient_employee_id: f.id,
          title: 'Closure approval requested',
          body: `Marketing manager requests approval to close lead at ${snapshot.grossMargin}% gross margin (amber band).`,
          notification_type: 'closure_approval',
          entity_type: 'lead',
          entity_id: leadId,
          is_read: false,
        }));
        await supabase.from('notifications').insert(notifications);
      }

      return ok({ outcome: 'approval_requested', approvalId: approval.id });
    }

    // Green band: flip to won directly
    const { error: updErr } = await supabase
      .from('leads')
      .update({
        status: 'won' as LeadStatus,
        status_updated_at: new Date().toISOString(),
        converted_to_project: true,
        converted_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updErr) return err(updErr.message, updErr.code);

    console.log(`${op} Lead ${leadId} flipped to won (green band, margin=${snapshot.grossMargin}%)`);
    return ok({ outcome: 'won', newStatus: 'won' });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Founder approves an amber-band closure request.
 * Flips the lead to won and marks the approval row 'approved'.
 */
export async function approveClosure(approvalId: string): Promise<ActionResult<null>> {
  const op = '[approveClosure]';
  try {
    if (!approvalId) return err('Missing approvalId');
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile || profile.role !== 'founder') {
      return err('Only the founder can approve closure requests');
    }

    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!employee) return err('Employee record not found');

    // Fetch the pending approval
    const { data: approval, error: readErr } = await supabase
      .from('lead_closure_approvals')
      .select('id, lead_id, status')
      .eq('id', approvalId)
      .maybeSingle();
    if (readErr) return err(readErr.message, readErr.code);
    if (!approval) return err('Approval not found');
    if (approval.status !== 'pending') {
      return err(`Approval is in '${approval.status}' - only pending approvals can be approved`);
    }

    // Mark approval as approved
    const { error: updApprovalErr } = await supabase
      .from('lead_closure_approvals')
      .update({
        status: 'approved',
        approved_by: employee.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', approvalId);
    if (updApprovalErr) return err(updApprovalErr.message, updApprovalErr.code);

    // Flip lead to won
    const { error: updLeadErr } = await supabase
      .from('leads')
      .update({
        status: 'won' as LeadStatus,
        status_updated_at: new Date().toISOString(),
        converted_to_project: true,
        converted_at: new Date().toISOString(),
      })
      .eq('id', approval.lead_id);
    if (updLeadErr) return err(updLeadErr.message, updLeadErr.code);

    console.log(`${op} Approval ${approvalId} approved, lead ${approval.lead_id} flipped to won`);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function rejectClosure(
  approvalId: string,
  reason: string,
): Promise<ActionResult<null>> {
  const op = '[rejectClosure]';
  try {
    if (!approvalId) return err('Missing approvalId');
    if (!reason || reason.trim() === '') return err('Rejection reason is required');

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile || profile.role !== 'founder') {
      return err('Only the founder can reject closure requests');
    }

    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    const { error } = await supabase
      .from('lead_closure_approvals')
      .update({
        status: 'rejected',
        approved_by: employee?.id ?? null,
        rejected_at: new Date().toISOString(),
        reason: reason.trim(),
      })
      .eq('id', approvalId);

    if (error) return err(error.message, error.code);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
