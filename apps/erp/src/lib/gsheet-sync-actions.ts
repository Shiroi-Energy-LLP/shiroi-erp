'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { getUserProfile, getCurrentEmployeeId } from '@/lib/auth';
import { err, ok, type ActionResult } from '@/lib/types/actions';

/**
 * Mutations for /sheet-sync. PM + founder only. Phase 1 touches only the
 * gsheet_* tables (mig 224) — core projects/tasks are never written here.
 */

async function requirePm(): Promise<ActionResult<{ employeeId: string | null }>> {
  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated', 'UNAUTHENTICATED');
  if (!['founder', 'project_manager'].includes(profile.role)) return err('Not allowed', 'FORBIDDEN');
  const employeeId = await getCurrentEmployeeId();
  return ok({ employeeId });
}

export async function linkSheetProject(
  sourceId: string,
  projectKey: string,
  projectId: string,
): Promise<ActionResult<void>> {
  const op = '[linkSheetProject]';
  const caller = await requirePm();
  if (!caller.success) return caller;
  if (!sourceId || !projectKey || !projectId) return err('Missing project link details', 'VALIDATION');

  const supabase = await createClient();
  const { error } = await supabase.from('gsheet_project_links').upsert({
    source_id: sourceId,
    project_key: projectKey,
    project_id: projectId,
    link_method: 'manual',
    linked_by: caller.data.employeeId,
    linked_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`${op} failed`, { sourceId, projectKey, code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }

  // Back-fill the link onto changes already logged for this sheet project.
  const { error: stampErr } = await supabase.from('gsheet_changes')
    .update({ project_id: projectId })
    .eq('source_id', sourceId).eq('project_key', projectKey).is('project_id', null);
  if (stampErr) console.error(`${op} change back-fill failed`, { sourceId, projectKey, code: stampErr.code, message: stampErr.message });

  revalidatePath('/sheet-sync');
  return ok(undefined);
}

export async function setSheetChangeReview(
  changeId: string,
  status: 'applied' | 'ignored' | 'pending',
): Promise<ActionResult<void>> {
  const op = '[setSheetChangeReview]';
  const caller = await requirePm();
  if (!caller.success) return caller;

  const supabase = await createClient();
  const { error } = await supabase.from('gsheet_changes')
    .update({
      review_status: status,
      reviewed_by: status === 'pending' ? null : caller.data.employeeId,
      reviewed_at: status === 'pending' ? null : new Date().toISOString(),
    })
    .eq('id', changeId);
  if (error) {
    console.error(`${op} failed`, { changeId, code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }
  revalidatePath('/sheet-sync');
  return ok(undefined);
}
