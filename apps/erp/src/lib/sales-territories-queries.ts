/**
 * sales-territories-queries.ts — server-side read queries for sales territories.
 *
 * NO 'use server' directive — this is a queries file, not a server actions file.
 * Import with `import type` only in 'use client' components (NEVER-DO #21).
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

export type SalesTerritory = Database['public']['Tables']['sales_territories']['Row'];

export interface TerritoryWithAssignee extends SalesTerritory {
  assignee_name: string | null;
}

/**
 * List all sales territories, joined with the assignee's full_name.
 * Returns active first, then inactive; alphabetical within each group.
 */
export async function listTerritories(): Promise<TerritoryWithAssignee[]> {
  const op = '[listTerritories]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sales_territories')
    .select(
      'id, territory_name, cities, segment, default_assignee_employee_id, active, created_at, updated_at, employees!sales_territories_default_assignee_employee_id_fkey(full_name)',
    )
    .order('active', { ascending: false })
    .order('territory_name', { ascending: true });

  if (error) {
    console.error(`${op} query failed`, { error, timestamp: new Date().toISOString() });
    return [];
  }

  return (data ?? []).map((row) => {
    const emp = row.employees as { full_name: string } | null;
    return {
      id: row.id,
      territory_name: row.territory_name,
      cities: row.cities,
      segment: row.segment,
      default_assignee_employee_id: row.default_assignee_employee_id,
      active: row.active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      assignee_name: emp?.full_name ?? null,
    };
  });
}

/**
 * Fetch a single territory by id.
 */
export async function getTerritory(id: string): Promise<TerritoryWithAssignee | null> {
  const op = '[getTerritory]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sales_territories')
    .select(
      'id, territory_name, cities, segment, default_assignee_employee_id, active, created_at, updated_at, employees!sales_territories_default_assignee_employee_id_fkey(full_name)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} query failed`, { id, error, timestamp: new Date().toISOString() });
    return null;
  }
  if (!data) return null;

  const emp = data.employees as { full_name: string } | null;
  return {
    id: data.id,
    territory_name: data.territory_name,
    cities: data.cities,
    segment: data.segment,
    default_assignee_employee_id: data.default_assignee_employee_id,
    active: data.active,
    created_at: data.created_at,
    updated_at: data.updated_at,
    assignee_name: emp?.full_name ?? null,
  };
}

/**
 * Fetch all active employees for the assignee select.
 * Returns a minimal shape: id + full_name.
 */
export async function listEmployeesForSelect(): Promise<{ id: string; full_name: string }[]> {
  const op = '[listEmployeesForSelect]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error(`${op} query failed`, { error, timestamp: new Date().toISOString() });
    return [];
  }

  return (data ?? []) as { id: string; full_name: string }[];
}
