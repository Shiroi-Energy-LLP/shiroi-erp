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

  // Post-mig-158: password is encrypted at rest. Use the RPC that encrypts
  // server-side and writes via SECURITY DEFINER with role gate.
  const { data: newId, error } = await (supabase.rpc as any)(
    'upsert_plant_monitoring_credential',
    {
      p_id: null,
      p_project_id: input.project_id,
      p_portal_url: input.portal_url.trim(),
      p_username: input.username.trim(),
      p_password: input.password,
      p_notes: input.notes?.trim() || null,
      p_inverter_brand: null, // server auto-detects from URL
    },
  );

  if (error || !newId) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return err('A credential for this project and URL already exists', error.code);
    }
    return err(error?.message ?? 'Failed to create credential', error?.code);
  }

  // Fetch back the inserted row (without password — that comes via search RPC)
  const { data: row } = await supabase
    .from('plant_monitoring_credentials')
    .select('*')
    .eq('id', newId as string)
    .single();

  revalidatePath('/om/plant-monitoring');
  return ok((row ?? { id: newId as string }) as CredRow);
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

  // Post-mig-158: route through SECURITY DEFINER RPC that encrypts password
  // and re-detects brand from URL. Pass NULLs for unchanged fields — RPC
  // uses COALESCE to preserve them.
  const { error } = await (supabase.rpc as any)(
    'upsert_plant_monitoring_credential',
    {
      p_id: id,
      p_project_id: null, // not updatable here
      p_portal_url: patch.portal_url?.trim() ?? null,
      p_username: patch.username?.trim() ?? null,
      p_password: patch.password ?? null,
      p_notes: patch.notes !== undefined ? (patch.notes?.trim() || null) : null,
      p_inverter_brand: null,
    },
  );

  if (error) {
    console.error(`${op} Failed:`, { id, code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return err('Another credential for this project already uses this URL', error.code);
    }
    return err(error?.message ?? 'Failed to update credential', error?.code);
  }

  const { data: row } = await supabase
    .from('plant_monitoring_credentials')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  revalidatePath('/om/plant-monitoring');
  return ok((row ?? { id }) as CredRow);
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
