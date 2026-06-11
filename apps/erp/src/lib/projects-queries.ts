import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import { formatCustomerProject } from './customer-project';

type ProjectStatus = Database['public']['Enums']['project_status'];

export interface ProjectFilters {
  status?: ProjectStatus;
  search?: string;
  fy?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getProjects(filters: ProjectFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getProjects]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('projects')
    .select(
      'id, project_number, customer_name, system_type, system_size_kwp, status, completion_pct, planned_start_date, planned_end_date, actual_start_date, actual_end_date, created_at, project_manager_id, ceig_required, ceig_cleared, contracted_value, site_city, advance_amount, customer_phone, notes, project_name, company_id, employees!projects_project_manager_id_fkey(full_name), companies!projects_company_id_fkey(name)',
      { count: 'estimated' },
    )
    .is('deleted_at', null);

  // Dynamic sort
  const sortCol = filters.sort ?? 'created_at';
  const sortAsc = filters.dir === 'asc';
  query = query.order(sortCol, { ascending: sortAsc });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.fy && /^\d{4}-\d{2}$/.test(filters.fy)) {
    const startYear = parseInt(filters.fy.slice(0, 4), 10);
    const fyFrom = `${startYear}-04-01`;
    const fyTo = `${startYear + 1}-04-01`;
    // Internally generated dates — safe to interpolate (not user text).
    query = query.or(
      `and(order_date.gte.${fyFrom},order_date.lt.${fyTo}),and(order_date.is.null,created_at.gte.${fyFrom},created_at.lt.${fyTo})`,
    );
  }
  if (filters.search) {
    // Injection-safe: resolve matching ids via RPC, then filter by id.
    // Also makes project_name searchable (spec 2026-06-11 #3).
    const { data: hits, error: searchErr } = await supabase.rpc('search_projects_lite', {
      p_query: filters.search.trim(),
      p_limit: 500,
    });
    if (searchErr) {
      console.error(`${op} search RPC failed:`, { code: searchErr.code, message: searchErr.message });
    }
    const ids = (hits ?? []).map((h: { id: string }) => h.id);
    if (ids.length === 0) {
      return { data: [], total: 0, page, pageSize, totalPages: 0 };
    }
    query = query.in('id', ids);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load projects: ${error.message}`);
  }

  const total = count ?? 0;
  const rows = (data ?? []).map((p) => {
    const co = p.companies as { name: string } | null;
    return {
      ...p,
      company_name: co?.name ?? null,
      customer_project: formatCustomerProject({ companyName: co?.name ?? null, customerName: p.customer_name, projectName: p.project_name }),
    };
  });
  return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Lightweight project header — only fields needed for the layout header bar.
 * Used by projects/[id]/layout.tsx to avoid the expensive full getProject() call.
 */
export async function getProjectHeader(id: string) {
  const op = '[getProjectHeader]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  // Use maybeSingle() so that RLS-filtered / missing rows return null
  // instead of throwing PGRST116 ("Cannot coerce the result to a single JSON object")
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, status, system_size_kwp, system_type, contracted_value, completion_pct, ceig_required, ceig_cleared, automation_paused, boi_locked, boq_completed, commissioned_date')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load project header: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found or RLS-filtered:`, { id });
    return null;
  }
  return data;
}

export async function getProject(id: string) {
  const op = '[getProject]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  // Use maybeSingle() so that RLS-filtered / missing rows return null
  // instead of throwing PGRST116 ("Cannot coerce the result to a single JSON object").
  // The page calls notFound() when this returns null.
  const { data, error } = await supabase
    .from('projects')
    .select(
      '*, employees!projects_project_manager_id_fkey(full_name), pm_supervisor:employees!projects_site_supervisor_id_fkey(full_name), project_milestones(*, project_completion_components(*)), project_delay_log(*, employees!project_delay_log_logged_by_fkey(full_name), project_milestones!project_delay_log_milestone_id_fkey(milestone_name)), project_change_orders(*, preparer:employees!project_change_orders_prepared_by_fkey(full_name), approver:employees!project_change_orders_approved_by_internal_fkey(full_name))',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load project: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found or RLS-filtered:`, { id });
    return null;
  }
  return data;
}

export async function getProjectMilestones(projectId: string) {
  const op = '[getProjectMilestones]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_milestones')
    .select('*, project_completion_components(*)')
    .eq('project_id', projectId)
    .order('milestone_order', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load milestones: ${error.message}`);
  }
  return data ?? [];
}

export async function getProjectDelays(projectId: string) {
  const op = '[getProjectDelays]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_delay_log')
    .select(
      '*, employees!project_delay_log_logged_by_fkey(full_name), project_milestones!project_delay_log_milestone_id_fkey(milestone_name)',
    )
    .eq('project_id', projectId)
    .order('delay_start_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load delays: ${error.message}`);
  }
  return data ?? [];
}

export async function getProjectChangeOrders(projectId: string) {
  const op = '[getProjectChangeOrders]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_change_orders')
    .select(
      '*, preparer:employees!project_change_orders_prepared_by_fkey(full_name), approver:employees!project_change_orders_approved_by_internal_fkey(full_name)',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load change orders: ${error.message}`);
  }
  return data ?? [];
}

export async function getProjectQCInspections(projectId: string) {
  const op = '[getProjectQCInspections]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('qc_gate_inspections')
    .select(
      '*, employees!qc_gate_inspections_inspected_by_fkey(full_name), project_milestones!qc_gate_inspections_milestone_id_fkey(milestone_name)',
    )
    .eq('project_id', projectId)
    .order('gate_number', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load QC inspections: ${error.message}`);
  }
  return data ?? [];
}

// ── At-Site Design Queue ─────────────────────────────────────────────────────

/**
 * Returns projects that have been explicitly flagged as needing the design
 * team's at-site layout work (needs_site_design = TRUE), oldest-first
 * (FIFO: the PM who waited longest gets served first).
 */
export interface ProjectNeedingSiteDesign {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number | null;
  needs_site_design_requested_at: string | null;
  needs_site_design_note: string | null;
  requested_by_name: string | null;
}

export async function getProjectsNeedingSiteDesign(): Promise<ProjectNeedingSiteDesign[]> {
  const op = '[getProjectsNeedingSiteDesign]';
  console.log(`${op} Starting`);

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('projects')
      .select(
        'id, project_number, customer_name, system_size_kwp, needs_site_design_requested_at, needs_site_design_note, employees!projects_needs_site_design_requested_by_fkey(full_name)',
      )
      .eq('needs_site_design', true)
      .is('deleted_at', null)
      .order('needs_site_design_requested_at', { ascending: true });

    if (error) {
      console.error(`${op} Query failed`, {
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return [];
    }

    return (data ?? []).map((row) => {
      const emp = row.employees as { full_name: string } | null;
      return {
        id: row.id,
        project_number: row.project_number,
        customer_name: row.customer_name,
        system_size_kwp: row.system_size_kwp ?? null,
        needs_site_design_requested_at: row.needs_site_design_requested_at ?? null,
        needs_site_design_note: row.needs_site_design_note ?? null,
        requested_by_name: emp?.full_name ?? null,
      };
    });
  } catch (e) {
    console.error(`${op} Unexpected error`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    return [];
  }
}

type CustomerSegment = Database['public']['Enums']['customer_segment'];
type SystemType = Database['public']['Enums']['system_type'];

export async function getMilestoneWeights(segment: CustomerSegment, systemType: SystemType) {
  const op = '[getMilestoneWeights]';
  console.log(`${op} Starting for: ${segment}, ${systemType}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_milestone_weights')
    .select('milestone_name, weight_pct')
    .eq('segment', segment)
    .eq('system_type', systemType)
    .eq('is_active', true)
    .order('milestone_name');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load milestone weights: ${error.message}`);
  }
  return data ?? [];
}
