'use server';

/**
 * design-actions.ts — design-workspace-specific server actions.
 *
 * Companion to quote-actions.ts. quote-actions handles the proposal side
 * (draft creation, finalization, escalation); design-actions handles the
 * design-team-side workflow moments:
 *
 *   submitDesignConfirmation(leadId)
 *     Designer clicks "Mark Design Confirmed" on /design/[leadId]. Validates
 *     that a draft proposal exists, has ≥1 BOM line with price_book_id set,
 *     and design_notes is non-empty. Flips the lead to design_confirmed and
 *     stamps design_confirmed_at + design_confirmed_by.
 *
 *   saveDesignNotes(leadId, notes)
 *     Saves the designer's notes textarea as they type (debounced by the UI).
 *
 *   sendBackToDesign(leadId)
 *     For the marketing manager: push a design_confirmed lead back to
 *     design_in_progress if they spot a problem during proposal prep.
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { ok, err, type ActionResult } from './types/actions';

type LeadStatus = Database['public']['Enums']['lead_status'];

export async function submitDesignConfirmation(
  leadId: string,
): Promise<ActionResult<{ proposalId: string }>> {
  const op = '[submitDesignConfirmation]';
  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();

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

    // Load lead + draft proposal + bom lines in parallel
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, status, draft_proposal_id, design_notes')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, leadErr.code);
    if (!lead) return err('Lead not found');

    if (!lead.draft_proposal_id) {
      return err(
        'No draft proposal linked to this lead. Transition the lead through Site Survey Scheduled to auto-create one.',
      );
    }

    if (!lead.design_notes || lead.design_notes.trim() === '') {
      return err('Design notes are required before marking design confirmed.');
    }

    const { data: bomLines, error: bomErr } = await supabase
      .from('proposal_bom_lines')
      .select('id, price_book_id')
      .eq('proposal_id', lead.draft_proposal_id);
    if (bomErr) return err(bomErr.message, bomErr.code);
    if (!bomLines || bomLines.length === 0) {
      return err('Cannot confirm design — at least one BOM line is required.');
    }

    const unmatchedLines = bomLines.filter((l) => !l.price_book_id);
    if (unmatchedLines.length > 0) {
      return err(
        `Cannot confirm design — ${unmatchedLines.length} BOM line(s) are missing a price book reference. Every line must come from the Price Book.`,
      );
    }

    // Flip lead to design_confirmed + stamp metadata
    const { error: updErr } = await supabase
      .from('leads')
      .update({
        status: 'design_confirmed' as LeadStatus,
        status_updated_at: new Date().toISOString(),
        design_confirmed_at: new Date().toISOString(),
        design_confirmed_by: employee.id,
      })
      .eq('id', leadId);
    if (updErr) return err(updErr.message, updErr.code);

    console.log(`${op} Lead ${leadId} design confirmed by ${employee.id}`);
    return ok({ proposalId: lead.draft_proposal_id });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function saveDesignNotes(
  leadId: string,
  notes: string,
): Promise<ActionResult<null>> {
  const op = '[saveDesignNotes]';
  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();
    const { error } = await supabase
      .from('leads')
      .update({ design_notes: notes })
      .eq('id', leadId);
    if (error) {
      console.error(`${op} failed`, { code: error.code, message: error.message });
      return err(error.message, error.code);
    }
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export async function sendBackToDesign(
  leadId: string,
  reason?: string,
): Promise<ActionResult<null>> {
  const op = '[sendBackToDesign]';
  try {
    if (!leadId) return err('Missing leadId');

    const supabase = await createClient();

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, status')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) return err(leadErr.message, leadErr.code);
    if (!lead) return err('Lead not found');
    if (lead.status !== 'design_confirmed' && lead.status !== 'detailed_proposal_sent') {
      return err(
        `Lead is in '${lead.status}' - only design_confirmed or detailed_proposal_sent leads can be sent back to design`,
      );
    }

    const { error: updErr } = await supabase
      .from('leads')
      .update({
        status: 'design_in_progress' as LeadStatus,
        status_updated_at: new Date().toISOString(),
        design_notes: reason
          ? `[Sent back] ${reason}\n\n`
          : '[Sent back by marketing]\n\n',
      })
      .eq('id', leadId);
    if (updErr) return err(updErr.message, updErr.code);

    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
