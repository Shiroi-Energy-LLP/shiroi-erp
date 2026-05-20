'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

export interface AddLeadActivityInput {
  leadId: string;
  activityType: 'call' | 'whatsapp' | 'email' | 'site_visit' | 'meeting' | 'follow_up' | 'note';
  summary: string;
  outcome?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  durationMinutes?: number | null;
}

export async function addLeadActivity(
  input: AddLeadActivityInput,
): Promise<ActionResult<{ activityId: string }>> {
  const op = '[addLeadActivity]';
  console.log(`${op} Starting for lead: ${input.leadId}, type: ${input.activityType}`);

  // Server-side validation (UI already enforces, but guard defensively)
  if (!input.activityType) return err('Activity type is required');
  if (!input.summary.trim()) return err('Summary is required');
  if (!input.nextActionDate) return err('Next follow-up date is required');

  const supabase = await createClient();

  // Resolve caller to employee record
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (empError || !employee) {
    console.error(`${op} Employee lookup failed:`, {
      profileId: user.id,
      error: empError,
      timestamp: new Date().toISOString(),
    });
    return err(empError?.message ?? 'Employee record not found');
  }

  const activityId = crypto.randomUUID();

  const { error: insertError } = await supabase.from('lead_activities').insert({
    id: activityId,
    lead_id: input.leadId,
    activity_type: input.activityType,
    summary: input.summary.trim(),
    outcome: input.outcome?.trim() ?? null,
    // activity_date defaults to CURRENT_DATE in the DB; omit to use DB default
    performed_by: employee.id,
    next_action: input.nextAction?.trim() ?? null,
    next_action_date: input.nextActionDate ?? null,
    duration_minutes: input.durationMinutes ?? null,
  });

  if (insertError) {
    console.error(`${op} Insert failed:`, {
      leadId: input.leadId,
      activityType: input.activityType,
      error: insertError,
      timestamp: new Date().toISOString(),
    });
    return err(insertError.message, insertError.code);
  }

  // Update lead: last_contacted_at + next_followup_date
  const { error: updateError } = await supabase
    .from('leads')
    .update({
      last_contacted_at: new Date().toISOString(),
      next_followup_date: input.nextActionDate ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.leadId);

  if (updateError) {
    // Non-fatal: activity was logged successfully; lead timestamp update is best-effort
    console.error(`${op} Lead update failed (non-fatal):`, {
      leadId: input.leadId,
      error: updateError,
      timestamp: new Date().toISOString(),
    });
  }

  revalidatePath(`/sales/${input.leadId}/activities`);
  revalidatePath(`/sales/${input.leadId}`);
  revalidatePath('/dashboard');
  // Legacy paths (pre-sales URL space migration)
  revalidatePath(`/leads/${input.leadId}/activities`);
  revalidatePath(`/leads/${input.leadId}`);

  return ok({ activityId });
}
