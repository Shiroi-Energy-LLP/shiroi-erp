'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type CredRow = Database['public']['Tables']['plant_monitoring_credentials']['Row'];
type CredInsert = Database['public']['Tables']['plant_monitoring_credentials']['Insert'];
type CredUpdate = Database['public']['Tables']['plant_monitoring_credentials']['Update'];

// ═══════════════════════════════════════════════════════════════════════
// Helper — look up current employee.id from auth.uid()
// ═══════════════════════════════════════════════════════════════════════

async function getCurrentEmployeeId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  return data?.id ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// createPlantMonitoringCredential
// ═══════════════════════════════════════════════════════════════════════

export async function createPlantMonitoringCredential(input: {
  project_id: string;
  portal_url: string;
  username: string;
  password: string;
  notes?: string | null;
}): Promise<ActionResult<CredRow>> {
  const op = '[createPlantMonitoringCredential]';

  if (!input.project_id) return err('Project is required');
  if (!input.portal_url?.trim()) return err('Portal URL is required');
  if (!input.username?.trim()) return err('Username is required');
  if (!input.password?.trim()) return err('Password is required');

  const supabase = await createClient();
  const employeeId = await getCurrentEmployeeId();

  // Compute brand server-side via the same helper the trigger uses
  const { data: brandRow, error: brandErr } = await supabase.rpc(
    'plant_monitoring_detect_brand',
    { portal_url: input.portal_url },
  );

  // Fall back to 'other' if the RPC returns unexpectedly — the CHECK constraint allows it.
  const brand = (!brandErr && typeof brandRow === 'string' ? brandRow : 'other') as string;

  const insert: CredInsert = {
    project_id: input.project_id,
    portal_url: input.portal_url.trim(),
    username: input.username.trim(),
    password: input.password,
    notes: input.notes?.trim() || null,
    inverter_brand: brand,
    created_by: employeeId,
    updated_by: employeeId,
  };

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .insert(insert)
    .select()
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return err('A credential for this project and URL already exists', error.code);
    }
    return err(error?.message ?? 'Failed to create credential', error?.code);
  }

  revalidatePath('/om/plant-monitoring');
  return ok(data);
}

// ═══════════════════════════════════════════════════════════════════════
// updatePlantMonitoringCredential
// ═══════════════════════════════════════════════════════════════════════

export async function updatePlantMonitoringCredential(
  id: string,
  patch: {
    portal_url?: string;
    username?: string;
    password?: string;
    notes?: string | null;
  },
): Promise<ActionResult<CredRow>> {
  const op = '[updatePlantMonitoringCredential]';

  if (!id) return err('Credential id is required');

  const supabase = await createClient();
  const employeeId = await getCurrentEmployeeId();

  const update: CredUpdate = {
    updated_by: employeeId,
  };

  if (patch.portal_url !== undefined) {
    const trimmed = patch.portal_url.trim();
    if (!trimmed) return err('Portal URL cannot be empty');
    update.portal_url = trimmed;

    // Recompute brand when URL changes
    const { data: brandRow, error: brandErr } = await supabase.rpc(
      'plant_monitoring_detect_brand',
      { portal_url: trimmed },
    );
    if (!brandErr && typeof brandRow === 'string') {
      update.inverter_brand = brandRow;
    }
  }

  if (patch.username !== undefined) {
    const trimmed = patch.username.trim();
    if (!trimmed) return err('Username cannot be empty');
    update.username = trimmed;
  }

  if (patch.password !== undefined) {
    if (!patch.password) return err('Password cannot be empty');
    update.password = patch.password;
  }

  if (patch.notes !== undefined) {
    update.notes = patch.notes?.trim() || null;
  }

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { id, code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return err('Another credential for this project already uses this URL', error.code);
    }
    return err(error?.message ?? 'Failed to update credential', error?.code);
  }

  revalidatePath('/om/plant-monitoring');
  return ok(data);
}

// ═══════════════════════════════════════════════════════════════════════
// softDeletePlantMonitoringCredential
// ═══════════════════════════════════════════════════════════════════════

export async function softDeletePlantMonitoringCredential(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const op = '[softDeletePlantMonitoringCredential]';

  if (!id) return err('Credential id is required');

  const supabase = await createClient();
  const employeeId = await getCurrentEmployeeId();

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: employeeId,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { id, code: error?.code, message: error?.message });
    return err(error?.message ?? 'Failed to delete credential', error?.code);
  }

  revalidatePath('/om/plant-monitoring');
  return ok({ id: data.id });
}
