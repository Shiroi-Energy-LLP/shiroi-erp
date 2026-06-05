'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { requireAuthUser } from '@/lib/auth';

// ── Allowed roles ─────────────────────────────────────────────────────────────

const REQUEST_ROLES = new Set(['project_manager', 'founder', 'marketing_manager']);
const COMPLETE_ROLES = new Set(['designer', 'founder', 'project_manager']);

// ── Helper: resolve authenticated caller's role + employee.id ──────────────

async function getCallerRoleAndEmployee(): Promise<{
  role: string | null;
  employeeId: string | null;
}> {
  const authed = await requireAuthUser();
  if (!authed.success) return { role: null, employeeId: null };
  const { user, supabase } = authed.data;

  const [profileRes, employeeRes] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('employees').select('id').eq('profile_id', user.id).maybeSingle(),
  ]);

  return {
    role: (profileRes.data?.role as string) ?? null,
    employeeId: employeeRes.data?.id ?? null,
  };
}

// ── requestSiteDesign ─────────────────────────────────────────────────────────

/**
 * Sets needs_site_design=TRUE on a project, recording who requested it,
 * when, and an optional note. Only project_manager, founder, and
 * marketing_manager may call this.
 */
export async function requestSiteDesign(
  projectId: string,
  note: string,
): Promise<ActionResult<null>> {
  const op = '[requestSiteDesign]';

  if (!projectId) {
    console.error(`${op} Missing projectId`);
    return err('Missing project ID');
  }

  const { role, employeeId } = await getCallerRoleAndEmployee();

  if (!role) {
    console.warn(`${op} Not authenticated`);
    return err('Not authenticated');
  }
  if (!REQUEST_ROLES.has(role)) {
    console.warn(`${op} Role not allowed`, { role, projectId });
    return err('Only project managers, marketing managers, and founders can request site design');
  }
  if (!employeeId) {
    console.warn(`${op} No employee record for caller`, { role, projectId });
    return err('Your account is not linked to an employee record');
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from('projects')
      .update({
        needs_site_design: true,
        needs_site_design_requested_at: new Date().toISOString(),
        needs_site_design_requested_by: employeeId,
        needs_site_design_note: note.trim() || null,
      })
      .eq('id', projectId);

    if (error) {
      console.error(`${op} Update failed`, {
        code: error.code,
        message: error.message,
        projectId,
        timestamp: new Date().toISOString(),
      });
      return err(error.message, error.code);
    }

    revalidatePath('/design');
    revalidatePath(`/projects/${projectId}`);

    return ok(null);
  } catch (e) {
    console.error(`${op} Unexpected error`, {
      error: e instanceof Error ? e.message : String(e),
      projectId,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Unexpected error');
  }
}

// ── markSiteDesignComplete ────────────────────────────────────────────────────

/**
 * Clears the site design request on a project (needs_site_design=FALSE,
 * audit columns cleared). Only designer, founder, and project_manager
 * may call this.
 */
export async function markSiteDesignComplete(
  projectId: string,
): Promise<ActionResult<null>> {
  const op = '[markSiteDesignComplete]';

  if (!projectId) {
    console.error(`${op} Missing projectId`);
    return err('Missing project ID');
  }

  const { role } = await getCallerRoleAndEmployee();

  if (!role) {
    console.warn(`${op} Not authenticated`);
    return err('Not authenticated');
  }
  if (!COMPLETE_ROLES.has(role)) {
    console.warn(`${op} Role not allowed`, { role, projectId });
    return err('Only designers, project managers, and founders can mark site design complete');
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from('projects')
      .update({
        needs_site_design: false,
        needs_site_design_requested_at: null,
        needs_site_design_requested_by: null,
        needs_site_design_note: null,
      })
      .eq('id', projectId);

    if (error) {
      console.error(`${op} Update failed`, {
        code: error.code,
        message: error.message,
        projectId,
        timestamp: new Date().toISOString(),
      });
      return err(error.message, error.code);
    }

    revalidatePath('/design');
    revalidatePath(`/projects/${projectId}`);

    return ok(null);
  } catch (e) {
    console.error(`${op} Unexpected error`, {
      error: e instanceof Error ? e.message : String(e),
      projectId,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Unexpected error');
  }
}
