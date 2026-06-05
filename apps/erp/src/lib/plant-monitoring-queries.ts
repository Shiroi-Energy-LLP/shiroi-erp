'use server';

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type CredRow = Database['public']['Tables']['plant_monitoring_credentials']['Row'];
type ProjectLite = { id: string; customer_name: string; project_number: string | null };

// Note: post-mig-158 the table stores password_encrypted (BYTEA) but the
// search RPC returns a decrypted plaintext `password` field for UI display.
// We model the UI-facing shape with `password` as plaintext string.
// RPC fields are all inferred as nullable by PostgREST even though the
// underlying columns are NOT NULL. Loosen the types here and let the
// consumer handle the (impossible-in-practice) null case.
export type PlantMonitoringCredential = Omit<CredRow, 'password_encrypted' | 'project_id'> & {
  project_id: string | null;
  password: string | null;
  projects: ProjectLite | null;
};

// ═══════════════════════════════════════════════════════════════════════
// listPlantMonitoringCredentials — paginated, filtered
// ═══════════════════════════════════════════════════════════════════════

export interface ListFilters {
  project_id?: string;
  brand?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

// Shape returned by the search_plant_monitoring_credentials RPC.
// Mirrors the RPC RETURNS TABLE definition in migration 158:
//   id, project_id, commissioning_report_id, inverter_brand,
//   portal_url, username, password (decrypted), notes,
//   created_at, created_by, updated_at, updated_by,
//   deleted_at, deleted_by, project_customer_name, project_number, total_count
type SearchPmcRow = {
  id: string;
  project_id: string | null;
  commissioning_report_id: string | null;
  inverter_brand: string | null;
  portal_url: string;
  username: string;
  password: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  project_customer_name: string | null;
  project_number: string | null;
  total_count: number | string;
};

export async function listPlantMonitoringCredentials(
  filters: ListFilters,
): Promise<{ items: PlantMonitoringCredential[]; total: number }> {
  const op = '[listPlantMonitoringCredentials]';
  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 50;
  const from = (page - 1) * perPage;

  const supabase = await createClient();

  // Item 2b: use parameter-bound RPC instead of PostgREST .or() interpolation.
  // The RPC also re-enforces the role gate (founder / project_manager /
  // om_technician) inside the function body — SECURITY DEFINER bypass of
  // RLS means we cannot rely on policy alone.
  const trimmed = filters.search?.trim();
  const { data, error } = await supabase.rpc('search_plant_monitoring_credentials', {
    p_query: trimmed && trimmed.length > 0 ? trimmed : undefined,
    p_project_id: filters.project_id ?? undefined,
    p_brand: filters.brand ?? undefined,
    p_limit: perPage,
    p_offset: from,
  });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { items: [], total: 0 };
  }

  const rows = (data ?? []) as unknown as SearchPmcRow[];
  const total = rows.length > 0 ? Number(rows[0]!.total_count ?? 0) : 0;

  const items: PlantMonitoringCredential[] = rows.map((r) => {
    const { project_customer_name, project_number, total_count: _tc, ...credRow } = r;
    return {
      ...credRow,
      projects: r.project_id
        ? {
            id: r.project_id,
            customer_name: project_customer_name ?? '',
            project_number: project_number,
          }
        : null,
    };
  });

  return { items, total };
}

// ═══════════════════════════════════════════════════════════════════════
// getProjectsWithCredentials — for the filter dropdown
// ═══════════════════════════════════════════════════════════════════════

type CredWithProject = {
  project_id: string | null;
  projects: ProjectLite | null;
};

export async function getProjectsWithCredentials(): Promise<ProjectLite[]> {
  const op = '[getProjectsWithCredentials]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .select('project_id, projects!plant_monitoring_credentials_project_id_fkey(id, customer_name, project_number)')
    .is('deleted_at', null)
    .not('project_id', 'is', null)
    .limit(500)
    .returns<CredWithProject[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  const seen = new Set<string>();
  const result: ProjectLite[] = [];
  for (const row of data ?? []) {
    const p = row.projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({
        id: p.id,
        customer_name: p.customer_name ?? '',
        project_number: p.project_number ?? null,
      });
    }
  }
  return result.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}

// ═══════════════════════════════════════════════════════════════════════
// getAllActiveProjects — used by the Add dialog's project picker
// ═══════════════════════════════════════════════════════════════════════

export async function getAllActiveProjects(): Promise<ProjectLite[]> {
  const op = '[getAllActiveProjects]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id, customer_name, project_number')
    .order('customer_name', { ascending: true })
    .limit(1000);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    customer_name: p.customer_name ?? '',
    project_number: p.project_number ?? null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// getSungrowOAuthStatus — reads oauth_status from the Sungrow master cred
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns the current Sungrow OAuth authorization status by reading the
 * master inverter_monitoring_credentials row for brand='sungrow'.
 *
 * Extracted from plant-monitoring/page.tsx per NEVER-DO #15 — no inline
 * Supabase calls from page.tsx.
 */
export async function getSungrowOAuthStatus(): Promise<'not_authorized' | 'authorized' | 'expired'> {
  const op = '[getSungrowOAuthStatus]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inverter_monitoring_credentials')
    .select('config')
    .eq('brand', 'sungrow')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`${op} Failed to read Sungrow credential`, {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    return 'not_authorized';
  }

  const config = data?.config as Record<string, unknown> | null;
  const status = config?.['oauth_status'] as string | undefined;

  if (status === 'authorized') return 'authorized';
  if (status === 'expired') return 'expired';
  return 'not_authorized';
}

// ═══════════════════════════════════════════════════════════════════════
// getPlantMonitoringSummary — wraps the summary RPC
// ═══════════════════════════════════════════════════════════════════════

export interface MonitoringSummary {
  total: number;
  brands: Record<string, number>;
  missing: number;
}

export async function getPlantMonitoringSummary(): Promise<MonitoringSummary> {
  const op = '[getPlantMonitoringSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_plant_monitoring_summary');

  if (error || !data) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    return { total: 0, brands: {}, missing: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { total: 0, brands: {}, missing: 0 };
  }

  return {
    total: Number(row.total_count ?? 0),
    brands: {
      sungrow: Number(row.brand_sungrow ?? 0),
      growatt: Number(row.brand_growatt ?? 0),
      sma: Number(row.brand_sma ?? 0),
      huawei: Number(row.brand_huawei ?? 0),
      fronius: Number(row.brand_fronius ?? 0),
      solis: Number(row.brand_solis ?? 0),
      other: Number(row.brand_other ?? 0),
    },
    missing: Number(row.missing_count ?? 0),
  };
}
