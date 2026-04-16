'use server';

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type CredRow = Database['public']['Tables']['plant_monitoring_credentials']['Row'];
type ProjectLite = { id: string; customer_name: string; project_number: string | null };

export type PlantMonitoringCredential = CredRow & {
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

export async function listPlantMonitoringCredentials(
  filters: ListFilters,
): Promise<{ items: PlantMonitoringCredential[]; total: number }> {
  const op = '[listPlantMonitoringCredentials]';
  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 50;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const supabase = await createClient();

  let query = supabase
    .from('plant_monitoring_credentials')
    .select(
      'id, project_id, commissioning_report_id, inverter_brand, portal_url, username, password, notes, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, projects!plant_monitoring_credentials_project_id_fkey(id, customer_name, project_number)',
      { count: 'estimated' },
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (filters.project_id) {
    query = query.eq('project_id', filters.project_id);
  }

  if (filters.brand) {
    query = query.eq('inverter_brand', filters.brand);
  }

  if (filters.search && filters.search.trim().length > 0) {
    const term = filters.search.trim();
    // Search username and notes. Project-name search is handled via the
    // project_id filter (user selects a project from the dropdown).
    query = query.or(`username.ilike.%${term}%,notes.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { items: [], total: 0 };
  }

  return {
    items: (data ?? []) as unknown as PlantMonitoringCredential[],
    total: count ?? 0,
  };
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
