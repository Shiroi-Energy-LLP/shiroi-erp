'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

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

  revalidatePath('/leads');
  return { success: true };
}

export async function bulkChangeLeadStatus(leadIds: string[], status: LeadStatus): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkChangeLeadStatus]';
  console.log(`${op} Starting for ${leadIds.length} leads → ${status}`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({
      status,
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', leadIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/leads');
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
