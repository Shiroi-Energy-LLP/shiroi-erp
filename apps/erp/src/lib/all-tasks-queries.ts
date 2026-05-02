import { createClient } from '@repo/supabase/server';

export interface TaskFilters {
  status?: string;
  priority?: string;
  entity_type?: string;
  search?: string;
  project_id?: string;
  assigned_to?: string;
  category?: string;
  page?: number;
  per_page?: number;
}

export async function getAllTasks(filters: TaskFilters = {}) {
  const op = '[getAllTasks]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page || 1;
  const perPage = filters.per_page || 50;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .from('tasks')
    .select(
      '*, assignee:employees!project_tasks_assigned_to_fkey(full_name), project:projects!project_tasks_project_id_fkey(project_number, customer_name), completed_by_employee:employees!project_tasks_completed_by_fkey(full_name), milestone:project_milestones!project_tasks_milestone_id_fkey(milestone_name)',
      { count: 'estimated' },
    )
    .is('deleted_at', null)
    .order('is_completed', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .range(from, to);

  // Map status filter to is_completed boolean
  if (filters.status === 'completed' || filters.status === 'closed')
    query = query.eq('is_completed', true);
  if (filters.status === 'pending' || filters.status === 'open')
    query = query.eq('is_completed', false);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.entity_type) query = query.eq('entity_type', filters.entity_type);
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);
  if (filters.project_id) query = query.eq('project_id', filters.project_id);
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);
  if (filters.category) query = query.eq('category' as any, filters.category);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load tasks: ${error.message}`);
  }

  const tasks = data ?? [];

  // Second-pass: enrich lead-linked tasks with customer_name.
  // tasks.entity_id has no FK to leads (it's a generic reference), so we
  // fetch the names in a separate query and attach them via a Map.
  const leadIds = tasks
    .filter((t) => t.entity_type === 'lead' && t.entity_id && !t.project_id)
    .map((t) => t.entity_id as string);

  const leadNameMap = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leadRows, error: leadErr } = await supabase
      .from('leads')
      .select('id, customer_name')
      .in('id', leadIds);
    if (leadErr) {
      console.error(`${op} Lead enrichment failed:`, { code: leadErr.code, message: leadErr.message });
      // Non-fatal: continue without names
    } else {
      for (const row of leadRows ?? []) {
        leadNameMap.set(row.id, row.customer_name);
      }
    }
  }

  const enriched = tasks.map((t) => {
    if (t.entity_type === 'lead' && t.entity_id && !t.project_id) {
      return { ...t, lead_customer_name: leadNameMap.get(t.entity_id) ?? null };
    }
    return { ...t, lead_customer_name: null };
  });

  return { tasks: enriched, total: count ?? 0 };
}
