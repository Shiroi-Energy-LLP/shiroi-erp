'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { getUserProfile, getCurrentEmployeeId } from '@/lib/auth';
import { err, ok, type ActionResult } from '@/lib/types/actions';

/**
 * Mutations for the /reconciliation workspace. PM + founder only. These edit
 * project_reconciliation ONLY — the core `projects` rows are never touched here;
 * applying confirmed values back to `projects` is a separate, deliberate step.
 */

async function requirePm(): Promise<ActionResult<{ employeeId: string | null }>> {
  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated', 'UNAUTHENTICATED');
  if (!['founder', 'project_manager'].includes(profile.role)) return err('Not allowed', 'FORBIDDEN');
  const employeeId = await getCurrentEmployeeId();
  return ok({ employeeId });
}

export async function confirmReconciliation(projectId: string): Promise<ActionResult<void>> {
  const op = '[confirmReconciliation]';
  const caller = await requirePm();
  if (!caller.success) return caller;

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_reconciliation')
    .update({ status: 'confirmed', reviewed_by: caller.data.employeeId, reviewed_at: new Date().toISOString() })
    .eq('project_id', projectId);

  if (error) {
    console.error(`${op} failed`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }
  revalidatePath('/reconciliation');
  return ok(undefined);
}

export async function rejectReconciliation(projectId: string): Promise<ActionResult<void>> {
  const op = '[rejectReconciliation]';
  const caller = await requirePm();
  if (!caller.success) return caller;

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_reconciliation')
    .update({ status: 'rejected', reviewed_by: caller.data.employeeId, reviewed_at: new Date().toISOString() })
    .eq('project_id', projectId);

  if (error) {
    console.error(`${op} failed`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }
  revalidatePath('/reconciliation');
  return ok(undefined);
}

export async function updateResolvedYear(projectId: string, year: number | null): Promise<ActionResult<void>> {
  const op = '[updateResolvedYear]';
  if (year != null && (year < 2000 || year > 2100)) return err('Year out of range');
  const caller = await requirePm();
  if (!caller.success) return caller;

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_reconciliation')
    .update({ resolved_year: year })
    .eq('project_id', projectId);

  if (error) {
    console.error(`${op} failed`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }
  revalidatePath('/reconciliation');
  return ok(undefined);
}

export async function updatePreferredSource(
  projectId: string,
  source: 'erp' | 'sheet',
): Promise<ActionResult<void>> {
  const op = '[updatePreferredSource]';
  if (source !== 'erp' && source !== 'sheet') return err('Invalid source');
  const caller = await requirePm();
  if (!caller.success) return caller;

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_reconciliation')
    .update({ preferred_source: source })
    .eq('project_id', projectId);

  if (error) {
    console.error(`${op} failed`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }
  revalidatePath('/reconciliation');
  return ok(undefined);
}
