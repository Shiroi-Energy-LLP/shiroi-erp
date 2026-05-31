'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import type { Database } from '@repo/types/database';
import { ok, err, type ActionResult } from './types/actions';
import { routeLeadAndAssign } from '@/lib/ai/lead-router';
import { emitErpEvent } from '@/lib/n8n/emit';

type LeadStatus = Database['public']['Enums']['lead_status'];
type CustomerSegment = Database['public']['Enums']['customer_segment'];
type LeadSource = Database['public']['Enums']['lead_source'];
type SystemType = Database['public']['Enums']['system_type'];

export interface CreateLeadInput {
  customer_name: string;
  phone: string;
  email?: string | null;
  city: string;
  state?: string;
  pincode?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  segment: CustomerSegment;
  source: LeadSource;
  system_type?: SystemType | null;
  estimated_size_kwp?: number | null;
  expected_close_date?: string | null;
  map_link?: string | null;
  notes?: string | null;
  channel_partner_id?: string | null;
}

/**
 * Create a new lead and fire-and-forget AI routing.
 *
 * This server action is the preferred path for all lead creation — it ensures
 * AI routing fires on every new lead regardless of source.
 */
export async function createLead(
  input: CreateLeadInput,
): Promise<ActionResult<{ id: string }>> {
  const op = '[createLead]';
  try {
    const supabase = await createClient();
    const newId = crypto.randomUUID();

    const { error: insertError } = await supabase.from('leads').insert({
      id: newId,
      customer_name: input.customer_name.trim(),
      phone: input.phone,
      email: input.email?.trim() || null,
      city: input.city.trim(),
      state: input.state || 'Tamil Nadu',
      pincode: input.pincode?.trim() || null,
      address_line1: input.address_line1?.trim() || null,
      address_line2: input.address_line2?.trim() || null,
      segment: input.segment,
      source: input.source,
      system_type: input.system_type ?? null,
      estimated_size_kwp: input.estimated_size_kwp ?? null,
      expected_close_date: input.expected_close_date || null,
      map_link: input.map_link?.trim() || null,
      notes: input.notes?.trim() || null,
      channel_partner_id: input.channel_partner_id ?? null,
      status: 'new' as const,
    });

    if (insertError) {
      console.error(`${op} Insert failed`, { error: insertError, timestamp: new Date().toISOString() });
      return err(insertError.message, insertError.code);
    }

    revalidatePath('/leads');
    revalidatePath('/sales');

    // Fire-and-forget AI routing — must not block or fail lead creation.
    void routeLeadAndAssign(newId);

    // Fire-and-forget event bus emit — n8n router fans out to sales head
    // digest, lead-routed downstream notifications, etc.
    void emitErpEvent('lead.created', {
      lead_id: newId,
      lead_name: input.customer_name.trim(),
      lead_phone: input.phone,
      lead_source: input.source,
      segment: input.segment,
      city: input.city.trim(),
      estimated_size_kwp: input.estimated_size_kwp ?? null,
      erp_url: `https://erp.shiroienergy.com/sales/${newId}`,
    });

    return ok({ id: newId });
  } catch (e) {
    console.error(`${op} threw`, { error: e, timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Tiny invalidation helper called from client components (e.g. status-change.tsx)
 * that write lead.status directly via the browser Supabase client.
 * Those components cannot call revalidateTag themselves — so they call this
 * server action after a successful write to flush the stage-count cache.
 */
export async function invalidateLeadStageCounts(): Promise<void> {
  revalidateTag('lead-stage-counts');
}

/**
 * Companion to the cache-flush helper above — also fires the
 * `lead.stage_changed` event so n8n notification workflows can react.
 * Called from client components after they update lead.status directly.
 * Fire-and-forget; never throws.
 */
export async function notifyLeadStageChanged(input: {
  leadId: string;
  newStatus: LeadStatus;
  previousStatus?: LeadStatus | null;
}): Promise<void> {
  const op = '[notifyLeadStageChanged]';
  try {
    const supabase = await createClient();
    const { data: lead } = await supabase
      .from('leads')
      .select('id, customer_name, phone, assigned_to')
      .eq('id', input.leadId)
      .maybeSingle();
    if (!lead) return;

    void emitErpEvent('lead.stage_changed', {
      lead_id: lead.id,
      lead_name: lead.customer_name,
      lead_phone: lead.phone,
      new_status: input.newStatus,
      previous_status: input.previousStatus ?? null,
      assigned_to: lead.assigned_to,
      erp_url: `https://erp.shiroienergy.com/sales/${lead.id}`,
    });
  } catch (e) {
    console.error(`${op} emit failed (non-blocking)`, {
      leadId: input.leadId,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}

export async function bulkAssignLeads(leadIds: string[], assignedTo: string): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkAssignLeads]';
  console.log(`${op} Starting for ${leadIds.length} leads`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };
  if (!assignedTo) return { success: false, error: 'No assignee selected' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .in('id', leadIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/sales');
  revalidatePath('/leads');
  return { success: true };
}

export async function bulkChangeLeadStatus(leadIds: string[], status: LeadStatus): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkChangeLeadStatus]';
  console.log(`${op} Starting for ${leadIds.length} leads → ${status}`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .update({
      status,
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', leadIds)
    .select('id');

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  const updatedCount = data?.length ?? 0;
  revalidateTag('lead-stage-counts');
  revalidatePath('/sales');
  revalidatePath('/leads');

  // Fire-and-forget per-lead emits for n8n. Don't block the bulk update.
  for (const row of data ?? []) {
    void notifyLeadStageChanged({ leadId: row.id, newStatus: status });
  }

  if (updatedCount < leadIds.length) {
    console.warn(`${op} Partial update: ${updatedCount} of ${leadIds.length} leads updated`, { timestamp: new Date().toISOString() });
    return {
      success: true,
      error: `Updated ${updatedCount} of ${leadIds.length} leads — check permissions for the rest`,
    };
  }

  return { success: true };
}

export async function bulkDeleteLeads(leadIds: string[]): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkDeleteLeads]';
  console.log(`${op} Starting for ${leadIds.length} leads`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', leadIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/sales');
  revalidatePath('/leads');
  return { success: true };
}

export async function mergeLeads(
  primaryId: string,
  secondaryId: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[mergeLeads]';
  console.log(`${op} Merging ${secondaryId} into ${primaryId}`);

  if (!primaryId || !secondaryId) return { success: false, error: 'Both lead IDs required' };
  if (primaryId === secondaryId) return { success: false, error: 'Cannot merge a lead with itself' };

  const supabase = await createClient();

  const [primaryResult, secondaryResult] = await Promise.all([
    supabase.from('leads').select('*').eq('id', primaryId).single(),
    supabase.from('leads').select('*').eq('id', secondaryId).single(),
  ]);

  if (primaryResult.error || !primaryResult.data) {
    return { success: false, error: `Primary lead not found: ${primaryResult.error?.message}` };
  }
  if (secondaryResult.error || !secondaryResult.data) {
    return { success: false, error: `Secondary lead not found: ${secondaryResult.error?.message}` };
  }

  const primary = primaryResult.data;
  const secondary = secondaryResult.data;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!primary.email && secondary.email) updates.email = secondary.email;
  if (!primary.address_line1 && secondary.address_line1) updates.address_line1 = secondary.address_line1;
  if (!primary.address_line2 && secondary.address_line2) updates.address_line2 = secondary.address_line2;
  if (!primary.state && secondary.state) updates.state = secondary.state;
  if (!primary.pincode && secondary.pincode) updates.pincode = secondary.pincode;
  if (!primary.estimated_size_kwp && secondary.estimated_size_kwp) updates.estimated_size_kwp = secondary.estimated_size_kwp;
  if (!primary.system_type && secondary.system_type) updates.system_type = secondary.system_type;

  if (Object.keys(updates).length > 1) {
    const { error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', primaryId);
    if (updateError) {
      console.error(`${op} Update primary failed:`, { code: updateError.code, message: updateError.message });
      return { success: false, error: `Failed to update primary lead: ${updateError.message}` };
    }
  }

  const { error: activityError } = await supabase
    .from('lead_activities')
    .update({ lead_id: primaryId })
    .eq('lead_id', secondaryId);

  if (activityError) {
    console.error(`${op} Transfer activities failed:`, { code: activityError.code, message: activityError.message });
    return { success: false, error: `Failed to transfer activities: ${activityError.message}` };
  }

  const { error: proposalError } = await supabase
    .from('proposals')
    .update({ lead_id: primaryId })
    .eq('lead_id', secondaryId);

  if (proposalError) {
    console.error(`${op} Transfer proposals failed:`, { code: proposalError.code, message: proposalError.message });
    return { success: false, error: `Failed to transfer proposals: ${proposalError.message}` };
  }

  const { error: deleteError } = await supabase
    .from('leads')
    .update({
      deleted_at: new Date().toISOString(),
      notes: `${secondary.notes ? secondary.notes + '\n' : ''}[Merged into ${primary.customer_name} on ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}]`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', secondaryId);

  if (deleteError) {
    console.error(`${op} Delete secondary failed:`, { code: deleteError.code, message: deleteError.message });
    return { success: false, error: `Failed to delete secondary lead: ${deleteError.message}` };
  }

  revalidatePath('/leads');
  return { success: true };
}

export async function archiveLead(leadId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[archiveLead]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }
  revalidatePath('/leads');
  return { success: true };
}

export async function unarchiveLead(leadId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[unarchiveLead]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ is_archived: false, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }
  revalidatePath('/leads');
  return { success: true };
}

/**
 * Toggle the proposal-gate bypass flag on a lead.
 * Restricted to founder + marketing_manager.
 * When bypass=true the DB trigger fn_block_lead_won_without_proposal will
 * allow Won without a proposal (historical cleanup only).
 */
export async function toggleProposalGateBypass(
  leadId: string,
  bypass: boolean,
): Promise<ActionResult<null>> {
  const op = '[toggleProposalGateBypass]';
  try {
    if (!leadId) return err('Missing leadId');

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
    if (!profile) return err('Profile not found');
    if (profile.role !== 'founder' && profile.role !== 'marketing_manager') {
      return err('Only a founder or marketing_manager can toggle the proposal gate bypass');
    }

    const { error } = await supabase
      .from('leads')
      .update({ proposal_gate_bypassed: bypass, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (error) {
      console.error(`${op} Failed`, { leadId, bypass, error, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    console.log(`${op} Lead ${leadId} proposal_gate_bypassed set to ${bypass}`);
    revalidatePath(`/sales/${leadId}`);
    return ok(null);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
