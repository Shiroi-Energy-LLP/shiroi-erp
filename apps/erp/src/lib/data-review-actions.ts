// apps/erp/src/lib/data-review-actions.ts
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

const ALLOWED_ROLES = new Set(['founder', 'marketing_manager', 'project_manager']);

async function requireReviewRole(): Promise<ActionResult<{ userId: string }>> {
  const op = '[requireReviewRole]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'unauthenticated');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (error || !profile) {
    console.error(`${op} profile fetch failed`, { error, timestamp: new Date().toISOString() });
    return err('Profile not found', 'no_profile');
  }
  if (!ALLOWED_ROLES.has(profile.role)) {
    return err('Forbidden — requires founder, marketing_manager, or project_manager', 'forbidden');
  }
  return ok({ userId: user.id });
}

function postSuccess() {
  revalidatePath('/data-review/projects');
  revalidatePath('/dashboard');
  revalidateTag('data-review-counts');
}

// ── Confirm (save + flag clear) ───────────────────────────────────────────────

export async function confirmProjectReview(input: {
  projectId: string;
  newSizeKwp: number;
  newContractedValue: number;
}): Promise<ActionResult<{ ok: true }>> {
  const op = '[confirmProjectReview]';
  const auth = await requireReviewRole();
  if (!auth.success) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('confirm_project_review', {
    p_project_id: input.projectId,
    p_new_size_kwp: input.newSizeKwp,
    p_new_contracted_value: input.newContractedValue,
    p_made_by: auth.data.userId,
  });
  if (error) {
    console.error(op, { projectId: input.projectId, error, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }
  const row = (data as Array<{ success: boolean; code: string }>)?.[0];
  if (!row?.success) {
    console.warn(op, { projectId: input.projectId, code: row?.code });
    return err(`Cannot confirm — ${row?.code ?? 'unknown'}`, row?.code);
  }

  postSuccess();
  return ok({ ok: true });
}

// ── Mark duplicate ────────────────────────────────────────────────────────────

export async function markProjectDuplicate(input: {
  projectAId: string;
  projectBId: string;
  notes: string;
}): Promise<ActionResult<{
  keptId: string;
  deletedId: string;
  keptScore: number;
  deletedScore: number;
}>> {
  const op = '[markProjectDuplicate]';
  if (!input.notes?.trim()) return err('Notes required for duplicate', 'notes_required');

  const auth = await requireReviewRole();
  if (!auth.success) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mark_project_duplicate', {
    p_project_a_id: input.projectAId,
    p_project_b_id: input.projectBId,
    p_notes: input.notes,
    p_made_by: auth.data.userId,
  });
  if (error) {
    console.error(op, { projectAId: input.projectAId, projectBId: input.projectBId, error, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }
  const row = (data as Array<{
    success: boolean;
    code: string;
    kept_project_id: string;
    deleted_project_id: string;
    kept_score: number;
    deleted_score: number;
  }>)?.[0];
  if (!row?.success) {
    console.warn(op, { code: row?.code });
    return err(`Cannot mark duplicate — ${row?.code ?? 'unknown'}`, row?.code);
  }

  postSuccess();
  return ok({
    keptId: row.kept_project_id,
    deletedId: row.deleted_project_id,
    keptScore: row.kept_score,
    deletedScore: row.deleted_score,
  });
}

// ── Undo last decision ────────────────────────────────────────────────────────

export async function undoLastDecision(input: {
  projectId: string;
}): Promise<ActionResult<{ ok: true }>> {
  const op = '[undoLastDecision]';
  const auth = await requireReviewRole();
  if (!auth.success) return auth;

  // Extra role check: undo is only for founder + marketing_manager
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'unauthenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  const undoRoles = new Set(['founder', 'marketing_manager']);
  if (!profile || !undoRoles.has(profile.role)) {
    return err('Undo requires founder or marketing_manager role', 'forbidden');
  }

  const { data, error } = await supabase.rpc('undo_project_review', {
    p_project_id: input.projectId,
    p_made_by: user.id,
  });
  if (error) {
    console.error(op, { projectId: input.projectId, error, timestamp: new Date().toISOString() });
    return err(error.message, error.code);
  }
  const row = (data as Array<{ success: boolean; code: string }>)?.[0];
  if (!row?.success) {
    console.warn(op, { projectId: input.projectId, code: row?.code });
    return err(`Cannot undo — ${row?.code ?? 'unknown'}`, row?.code);
  }

  postSuccess();
  return ok({ ok: true });
}
