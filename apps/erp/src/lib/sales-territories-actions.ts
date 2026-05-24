'use server';

/**
 * sales-territories-actions.ts — mutations for the sales territories admin UI.
 *
 * Role gate: founder + marketing_manager only (mirrors the RLS policy on the table).
 * Returns ActionResult<T> — never throws across the RSC boundary (NEVER-DO #19).
 */

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';
import { parseCities } from './sales-territories-constants';

type TerritoryInsert = Database['public']['Tables']['sales_territories']['Insert'];
type TerritoryUpdate = Database['public']['Tables']['sales_territories']['Update'];

// ── Role guard ────────────────────────────────────────────────────────────────

async function assertCanManageTerritories(): Promise<
  { ok: true } | { ok: false; error: string; code: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    console.error('[assertCanManageTerritories] profile lookup failed', {
      error,
      timestamp: new Date().toISOString(),
    });
    return { ok: false, error: 'Profile lookup failed', code: 'PROFILE_MISSING' };
  }

  if (profile.role !== 'founder' && profile.role !== 'marketing_manager') {
    return {
      ok: false,
      error: 'Only founders and marketing managers can manage territories',
      code: 'ROLE_DENIED',
    };
  }

  return { ok: true };
}

// ── Input type (shared between create + update) ───────────────────────────────

export interface TerritoryInput {
  territory_name: string;
  cities: string; // raw comma-separated string from form; we normalise internally
  segment?: string | null;
  default_assignee_employee_id?: string | null;
  active?: boolean;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createTerritory(
  input: TerritoryInput,
): Promise<ActionResult<{ id: string }>> {
  const op = '[createTerritory]';

  const guard = await assertCanManageTerritories();
  if (!guard.ok) return err(guard.error, guard.code);

  const name = input.territory_name.trim();
  if (!name) return err('Territory name is required');

  const cities = parseCities(input.cities);
  if (cities.length === 0) return err('At least one city is required');

  try {
    const supabase = await createClient();
    const payload: TerritoryInsert = {
      id: crypto.randomUUID(),
      territory_name: name,
      cities,
      segment: input.segment || null,
      default_assignee_employee_id: input.default_assignee_employee_id || null,
      active: input.active ?? true,
    };

    const { data, error } = await supabase
      .from('sales_territories')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error(`${op} insert failed`, { input, error, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/sales/territories');
    return ok({ id: data.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { input, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

export async function updateTerritory(
  id: string,
  input: TerritoryInput,
): Promise<ActionResult<void>> {
  const op = '[updateTerritory]';

  const guard = await assertCanManageTerritories();
  if (!guard.ok) return err(guard.error, guard.code);

  const name = input.territory_name.trim();
  if (!name) return err('Territory name is required');

  const cities = parseCities(input.cities);
  if (cities.length === 0) return err('At least one city is required');

  try {
    const supabase = await createClient();
    const patch: TerritoryUpdate = {
      territory_name: name,
      cities,
      segment: input.segment || null,
      default_assignee_employee_id: input.default_assignee_employee_id || null,
      active: input.active ?? true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('sales_territories').update(patch).eq('id', id);

    if (error) {
      console.error(`${op} update failed`, { id, input, error, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/sales/territories');
    return ok(undefined as void);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { id, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/**
 * Soft-delete: set active = false (preserves history + AI routing integrity).
 */
export async function deleteTerritory(id: string): Promise<ActionResult<void>> {
  const op = '[deleteTerritory]';

  const guard = await assertCanManageTerritories();
  if (!guard.ok) return err(guard.error, guard.code);

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('sales_territories')
      .update({ active: false, updated_at: new Date().toISOString() } satisfies TerritoryUpdate)
      .eq('id', id);

    if (error) {
      console.error(`${op} failed`, { id, error, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/sales/territories');
    return ok(undefined as void);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { id, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

export async function toggleTerritoryActive(
  id: string,
  currentlyActive: boolean,
): Promise<ActionResult<void>> {
  const op = '[toggleTerritoryActive]';

  const guard = await assertCanManageTerritories();
  if (!guard.ok) return err(guard.error, guard.code);

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('sales_territories')
      .update({
        active: !currentlyActive,
        updated_at: new Date().toISOString(),
      } satisfies TerritoryUpdate)
      .eq('id', id);

    if (error) {
      console.error(`${op} failed`, { id, error, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }

    revalidatePath('/sales/territories');
    return ok(undefined as void);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { id, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
