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

/**
 * Update the linked company and project name on a project.
 *
 * Uses the silent-RLS zero-rows guard: Supabase returns success on
 * RLS-blocked UPDATEs, so we `.select('id')` and treat an empty result
 * as "Update blocked".
 */
export async function updateProjectCompanyProject(
  projectId: string,
  input: { companyId: string | null; projectName: string | null },
): Promise<ActionResult<void>> {
  const op = '[updateProjectCompanyProject]';
  try {
    if (!projectId) return err('Missing project ID');

    const trimmedProjectName = input.projectName?.trim() || null;

    const supabase = await createClient();

    const { data: updatedRows, error } = await supabase
      .from('projects')
      .update({
        company_id: input.companyId,
        project_name: trimmedProjectName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .select('id');

    if (error) {
      console.error(`${op} Failed`, {
        code: error.code,
        message: error.message,
        projectId,
        timestamp: new Date().toISOString(),
      });
      return err(error.message, error.code);
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.error(`${op} 0 rows affected — RLS blocked or project missing`, {
        projectId,
        timestamp: new Date().toISOString(),
      });
      return err('Update blocked — permission denied or row missing', 'NO_ROWS_AFFECTED');
    }

    revalidatePath('/projects');
    revalidatePath(`/projects/${projectId}`);
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, {
      error: e instanceof Error ? e.message : String(e),
      projectId,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
