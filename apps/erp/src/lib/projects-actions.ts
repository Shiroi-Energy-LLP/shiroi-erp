'use server';

/**
 * Server actions for the Projects module.
 *
 * NOTE: The `projects` table is tightly coupled to the sales pipeline —
 * it requires `lead_id`, `proposal_id`, and many proposal-derived fields
 * (contracted_value, system_size_kwp, etc.). Full project creation happens
 * through the proposal-accept workflow in the Sales module.
 *
 * The `updateProjectType` action here is the minimal action needed to
 * set `project_type` on existing projects (backfilled to 'sales' in migration 066).
 */

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

export async function updateProjectType(
  projectId: string,
  projectType: 'sales' | 'internal',
): Promise<ActionResult<void>> {
  const op = '[updateProjectType]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('projects')
    .update({ project_type: projectType })
    .eq('id', projectId);

  if (error) {
    console.error(`${op} failed`, { projectId, projectType, error });
    return err(error.message, error.code);
  }
  revalidatePath('/projects');
  revalidatePath(`/projects/${projectId}`);
  return ok(undefined as void);
}
