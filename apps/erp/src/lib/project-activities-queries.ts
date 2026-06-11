import { createClient } from '@repo/supabase/server';
import type {
  ActivitiesSummary,
  ActivityStageOption,
  ManpowerType,
  ProjectActivityRow,
} from './project-activities-constants';

export const ACTIVITIES_PAGE_SIZE = 50;

export interface ListActivitiesFilters {
  projectId?: string;
  from?: string;        // 'YYYY-MM-DD'
  to?: string;          // 'YYYY-MM-DD'
  stageId?: string;
  manpower?: ManpowerType; // rows where that count > 0
  page?: number;        // 1-based; ignored when paginate=false
  paginate?: boolean;   // default true; the project sub-tab passes false
}

/**
 * List activities, newest first. Avoids count() entirely (NEVER-DO #13):
 * fetches pageSize+1 rows and reports hasMore.
 */
export async function listProjectActivities(
  filters: ListActivitiesFilters,
): Promise<{ rows: ProjectActivityRow[]; hasMore: boolean }> {
  const op = '[listProjectActivities]';
  const supabase = await createClient();
  const paginate = filters.paginate !== false;
  const page = Math.max(1, filters.page ?? 1);

  let query = supabase
    .from('project_activities')
    .select(
      'id, project_id, activity_date, stage_id, done_by, description, se_count, os_count, contractor_count, notes, ' +
      'execution_milestones_master(milestone_label), ' +
      'employees!project_activities_created_by_fkey(full_name), ' +
      'projects!project_activities_project_id_fkey(project_number, customer_name, project_name)',
    )
    .is('deleted_at', null)
    .order('activity_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters.projectId) query = query.eq('project_id', filters.projectId);
  if (filters.from) query = query.gte('activity_date', filters.from);
  if (filters.to) query = query.lte('activity_date', filters.to);
  if (filters.stageId) query = query.eq('stage_id', filters.stageId);
  if (filters.manpower === 'se') query = query.gt('se_count', 0);
  if (filters.manpower === 'os') query = query.gt('os_count', 0);
  if (filters.manpower === 'contractor') query = query.gt('contractor_count', 0);

  if (paginate) {
    const fromIdx = (page - 1) * ACTIVITIES_PAGE_SIZE;
    query = query.range(fromIdx, fromIdx + ACTIVITIES_PAGE_SIZE); // +1 row for hasMore
  } else {
    query = query.limit(500);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, filters });
    return { rows: [], hasMore: false };
  }

  const raw = data ?? [];
  const hasMore = paginate && raw.length > ACTIVITIES_PAGE_SIZE;
  const sliced = hasMore ? raw.slice(0, ACTIVITIES_PAGE_SIZE) : raw;

  const rows: ProjectActivityRow[] = sliced.map((r: any) => {
    const project = r.projects ?? null;
    const customer = project
      ? [project.customer_name, project.project_name].filter(Boolean).join(' — ')
      : null;
    return {
      id: r.id,
      project_id: r.project_id,
      activity_date: r.activity_date,
      stage_id: r.stage_id,
      stage_label: r.execution_milestones_master?.milestone_label ?? null,
      done_by: r.done_by,
      description: r.description,
      se_count: Number(r.se_count ?? 0),
      os_count: Number(r.os_count ?? 0),
      contractor_count: Number(r.contractor_count ?? 0),
      notes: r.notes,
      created_by_name: r.employees?.full_name ?? null,
      project_number: project?.project_number ?? null,
      project_customer: customer,
    };
  });

  return { rows, hasMore };
}

/** Manpower totals via the SQL RPC — never reduce counts in JS for display. */
export async function getActivitiesSummary(filters: {
  projectId?: string;
  from?: string;
  to?: string;
  stageId?: string;
}): Promise<ActivitiesSummary> {
  const op = '[getActivitiesSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_project_activities_summary', {
    p_project_id: filters.projectId ?? undefined,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_stage_id: filters.stageId ?? undefined,
  });

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message, filters });
    return { total_activities: 0, total_se: 0, total_os: 0, total_contractor: 0, distinct_projects: 0 };
  }

  const row: any = Array.isArray(data) ? data[0] : data;
  return {
    total_activities: Number(row?.total_activities ?? 0),
    total_se: Number(row?.total_se ?? 0),
    total_os: Number(row?.total_os ?? 0),
    total_contractor: Number(row?.total_contractor ?? 0),
    distinct_projects: Number(row?.distinct_projects ?? 0),
  };
}

/** Stage dropdown options — the 10 active execution milestones. */
export async function getActivityStageOptions(): Promise<ActivityStageOption[]> {
  const op = '[getActivityStageOptions]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('execution_milestones_master')
    .select('id, milestone_label')
    .eq('is_active', true)
    .order('milestone_order', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((m) => ({ id: m.id, label: m.milestone_label }));
}

/** Light project list for the global filter combobox (mirrors /expenses). */
export async function getProjectOptionsForActivities(): Promise<
  { id: string; project_number: string | null; customer_name: string }[]
> {
  const op = '[getProjectOptionsForActivities]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    project_number: p.project_number,
    customer_name: p.customer_name ?? p.project_number ?? p.id.slice(0, 8),
  }));
}
