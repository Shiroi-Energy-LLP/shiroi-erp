'use server';

/**
 * S5 — F7 BOQ Variance Actions
 *
 * Manual trigger for generating (or re-generating) the BOQ variance narrative
 * for a specific project. Role-gated: founder, project_manager, finance only.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { generateBoqVarianceNarrative } from './ai/boq-variance-narrative';
import { ok, err, type ActionResult } from '@/lib/types/actions';

const ALLOWED_ROLES = new Set(['founder', 'project_manager', 'finance']);

export async function generateBoqVarianceForProject(
  projectId: string,
): Promise<ActionResult<void>> {
  const op = '[generateBoqVarianceForProject]';

  if (!projectId) {
    return err('projectId is required');
  }

  // 1. Auth check — must be an authenticated user with an allowed role
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    console.error(`${op} unauthenticated`, { projectId, timestamp: new Date().toISOString() });
    return err('Not authenticated');
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    console.error(`${op} profile fetch failed`, { userId: user.id, error: profileErr.message, timestamp: new Date().toISOString() });
    return err(profileErr.message);
  }

  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return err('Insufficient permissions — founder, project_manager, or finance role required');
  }

  // 2. Call the AI generator
  const result = await generateBoqVarianceNarrative(projectId);

  if (!result.success) {
    console.error(`${op} narrative generation failed`, { projectId, error: result.error, timestamp: new Date().toISOString() });
    return err(result.error);
  }

  // 3. Revalidate the project detail page
  revalidatePath(`/projects/${projectId}`);

  return ok(undefined);
}
