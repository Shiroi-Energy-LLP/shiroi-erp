'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { getCurrentEmployeeId, getUserProfile } from '@/lib/auth';
import { err, ok, type ActionResult } from '@/lib/types/actions';

const MANAGE_ROLES = new Set<string>(['founder', 'project_manager']);

export interface ActivityInput {
  activityDate: string;        // 'YYYY-MM-DD'
  stageId: string | null;
  stageCustom: string | null;
  doneBy: string | null;
  description: string;
  seCount: number;
  osCount: number;
  contractorCount: number;
  notes: string | null;
}

function validate(input: ActivityInput): string | null {
  if (!input.description?.trim()) return 'Description is required';
  if (!input.activityDate) return 'Date is required';
  for (const [label, n] of [
    ['SE', input.seCount], ['OS', input.osCount], ['Contractor', input.contractorCount],
  ] as const) {
    if (!Number.isInteger(n) || n < 0) return `${label} count must be a non-negative whole number`;
  }
  return null;
}

async function requirePmCaller(): Promise<
  ActionResult<{ employeeId: string }>
> {
  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated', 'UNAUTHENTICATED');
  if (!MANAGE_ROLES.has(profile.role)) {
    return err('Only the Project Manager can manage activities.', 'FORBIDDEN');
  }
  const employeeId = await getCurrentEmployeeId();
  if (!employeeId) return err('No employee record linked to your account.');
  return ok({ employeeId });
}

function revalidate(projectId?: string) {
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath('/activities');
}

export async function addProjectActivity(input: {
  projectId?: string;
  projectNameCustom?: string;
  data: ActivityInput;
}): Promise<ActionResult<{ id: string }>> {
  const op = '[addProjectActivity]';
  const invalid = validate(input.data);
  if (invalid) return err(invalid);
  if (!input.projectId && !input.projectNameCustom?.trim()) {
    return err('A project or a project name is required');
  }

  const caller = await requirePmCaller();
  if (!caller.success) return caller;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_activities')
    .insert({
      project_id: input.projectId || null,
      project_name_custom: input.projectId ? null : (input.projectNameCustom?.trim() || null),
      activity_date: input.data.activityDate,
      stage_id: input.data.stageId ? input.data.stageId : null,
      stage_custom: input.data.stageId ? null : (input.data.stageCustom?.trim() || null),
      done_by: input.data.doneBy?.trim() || null,
      description: input.data.description.trim(),
      se_count: input.data.seCount,
      os_count: input.data.osCount,
      contractor_count: input.data.contractorCount,
      notes: input.data.notes?.trim() || null,
      created_by: caller.data.employeeId,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, {
      code: error.code, message: error.message, projectId: input.projectId,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }

  revalidate(input.projectId);
  return ok({ id: data.id });
}

export async function updateProjectActivity(input: {
  activityId: string;
  projectId?: string;
  data: ActivityInput;
}): Promise<ActionResult<void>> {
  const op = '[updateProjectActivity]';
  const invalid = validate(input.data);
  if (invalid) return err(invalid);

  const caller = await requirePmCaller();
  if (!caller.success) return caller;

  const supabase = await createClient();
  // Match by the unique activity id only — supports custom-project rows (project_id NULL).
  const { error } = await supabase
    .from('project_activities')
    .update({
      activity_date: input.data.activityDate,
      stage_id: input.data.stageId ? input.data.stageId : null,
      stage_custom: input.data.stageId ? null : (input.data.stageCustom?.trim() || null),
      done_by: input.data.doneBy?.trim() || null,
      description: input.data.description.trim(),
      se_count: input.data.seCount,
      os_count: input.data.osCount,
      contractor_count: input.data.contractorCount,
      notes: input.data.notes?.trim() || null,
    })
    .eq('id', input.activityId)
    .is('deleted_at', null);

  if (error) {
    console.error(`${op} Update failed:`, {
      code: error.code, message: error.message, activityId: input.activityId,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }

  revalidate(input.projectId);
  return ok(undefined as void);
}

export async function deleteProjectActivity(input: {
  activityId: string;
  projectId?: string;
}): Promise<ActionResult<void>> {
  const op = '[deleteProjectActivity]';
  const caller = await requirePmCaller();
  if (!caller.success) return caller;

  const supabase = await createClient();
  // Soft delete — RLS has no DELETE policy by design. Match by unique id only
  // (supports custom-project rows where project_id is NULL).
  const { error } = await supabase
    .from('project_activities')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', input.activityId)
    .is('deleted_at', null);

  if (error) {
    console.error(`${op} Soft delete failed:`, {
      code: error.code, message: error.message, activityId: input.activityId,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }

  revalidate(input.projectId);
  return ok(undefined as void);
}
