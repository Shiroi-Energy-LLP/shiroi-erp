'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';

export async function approvePendingImport(id: string): Promise<ActionResult<{ project_id: string }>> {
  const op = '[approvePendingImport]';
  try {
    const supabase = await createClient();
    const { data, error } = await (supabase.rpc as any)('approve_pending_import', { p_id: id });
    if (error) {
      console.error(`${op} Failed:`, { code: error.code, message: error.message, id, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    revalidatePath('/om/import-review');
    return ok({ project_id: data as string });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, id, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

export async function rejectPendingImport(id: string, reason: string | null): Promise<ActionResult<null>> {
  const op = '[rejectPendingImport]';
  try {
    const supabase = await createClient();
    const { error } = await (supabase.rpc as any)('reject_pending_import', { p_id: id, p_reason: reason });
    if (error) {
      console.error(`${op} Failed:`, { code: error.code, message: error.message, id, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    revalidatePath('/om/import-review');
    return ok(null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, id, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

export async function updatePendingImportField(id: string, field: string, value: string): Promise<ActionResult<null>> {
  const op = '[updatePendingImportField]';
  try {
    const supabase = await createClient();
    const { error } = await (supabase.rpc as any)('update_pending_import_field', { p_id: id, p_field: field, p_value: value });
    if (error) {
      console.error(`${op} Failed:`, { code: error.code, message: error.message, id, field, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    revalidatePath('/om/import-review');
    return ok(null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, id, field, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

export async function bulkApprovePendingImports(ids: string[]): Promise<ActionResult<{ approved: number; failed: number; errors: Array<{ id: string; error: string }> }>> {
  const op = '[bulkApprovePendingImports]';
  const errors: Array<{ id: string; error: string }> = [];
  let approved = 0;
  for (const id of ids) {
    const result = await approvePendingImport(id);
    if (result.success) approved++;
    else errors.push({ id, error: result.error });
  }
  console.log(`${op} Bulk approve complete:`, { total: ids.length, approved, failed: errors.length, timestamp: new Date().toISOString() });
  revalidatePath('/om/import-review');
  return ok({ approved, failed: errors.length, errors });
}

/**
 * Link a staged import to an EXISTING project: attaches its monitoring credential
 * (+ one inverter row only if the project has none and the import has a serial),
 * then marks the import imported. No new project is created — unlike approve.
 * Used by the Import Review "Link" action for plants that already have a project.
 */
export async function linkPendingImportToProject(
  importId: string,
  projectId: string,
): Promise<ActionResult<{ project_id: string }>> {
  const op = '[linkPendingImportToProject]';
  if (!importId) return err('Import id is required');
  if (!projectId) return err('Pick a project to link to');
  try {
    const supabase = await createClient();
    const { data, error } = await (supabase.rpc as any)('link_pending_import_to_project', {
      p_import_id: importId,
      p_project_id: projectId,
    });
    if (error) {
      console.error(`${op} Failed:`, { code: error.code, message: error.message, importId, projectId, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    revalidatePath('/om/import-review');
    revalidatePath('/om/plant-monitoring');
    return ok({ project_id: data as string });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, importId, projectId, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
