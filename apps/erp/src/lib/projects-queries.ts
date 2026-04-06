import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type ProjectStatus = Database['public']['Enums']['project_status'];

export interface ProjectFilters {
  status?: ProjectStatus;
  search?: string;
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
      'id, project_number, customer_name, system_type, system_size_kwp, status, completion_pct, planned_start_date, planned_end_date, actual_start_date, actual_end_date, created_at, project_manager_id, ceig_required, ceig_cleared, contracted_value, site_city, advance_amount, customer_phone, notes, employees!projects_project_manager_id_fkey(full_name)',
      { count: 'exact' },
    )
    .is('deleted_at', null);

  // Dynamic sort
  const sortCol = filters.sort ?? 'created_at';
  const sortAsc = filters.dir === 'asc';
  query = query.order(sortCol, { ascending: sortAsc });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) {
    query = query.or(
      `project_number.ilike.%${filters.search}%,customer_name.ilike.%${filters.search}%`,
    );
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load projects: ${error.message}`);
  }

  const total = count ?? 0;
  return {
    data: data ?? [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getProject(id: string) {
  const op = '[getProject]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(
      '*, employees!projects_project_manager_id_fkey(full_name), pm_supervisor:employees!projects_site_supervisor_id_fkey(full_name), project_milestones(*, project_completion_components(*)), project_delay_log(*, employees!project_delay_log_logged_by_fkey(full_name), project_milestones!project_delay_log_milestone_id_fkey(milestone_name)), project_change_orders(*, preparer:employees!project_change_orders_prepared_by_fkey(full_name), approver:employees!project_change_orders_approved_by_internal_fkey(full_name))',
    )
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load project: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { id });
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
