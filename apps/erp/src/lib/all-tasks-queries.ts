import { createClient } from '@repo/supabase/server';
import { matchProjectIdsByText } from './helpers/project-search-ids';
import { sanitizeForIlike } from './helpers/sanitize-or-filter';

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

/**
 * Shared embed select for the tasks list views.
 *
 * The `tasks` table was renamed from `project_tasks` (mig 007f) but its FK
 * constraints kept the OLD names, so every PostgREST embed MUST use the
 * `project_tasks_*_fkey` hint. A wrong/absent hint returns a SILENT empty
 * join (PGRST200) — the root cause of the historical "tasks don't show" bugs.
 */
const TASK_SELECT =
  '*, assignee:employees!project_tasks_assigned_to_fkey(full_name), project:projects!project_tasks_project_id_fkey(project_number, customer_name), completed_by_employee:employees!project_tasks_completed_by_fkey(full_name), milestone:project_milestones!project_tasks_milestone_id_fkey(milestone_name)';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface LeadEnrichable {
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
}

/**
 * Second-pass enrichment: attach the lead's customer_name to lead-linked tasks.
 * `tasks.entity_id` has no FK to `leads` (it's a generic reference), so the
 * names are fetched separately and attached via a Map. Non-fatal on error.
 */
async function enrichLeadNames<T extends LeadEnrichable>(
  supabase: SupabaseServerClient,
  tasks: T[],
): Promise<(T & { lead_customer_name: string | null })[]> {
  const op = '[enrichLeadNames]';
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

  return tasks.map((t) =>
    t.entity_type === 'lead' && t.entity_id && !t.project_id
      ? { ...t, lead_customer_name: leadNameMap.get(t.entity_id) ?? null }
      : { ...t, lead_customer_name: null },
  );
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
    .select(TASK_SELECT, { count: 'estimated' })
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
  if (filters.search) {
    // Free-text search: match the task title OR the linked project's
    // customer/number/name (resolved via the shared projects-search RPC) so
    // typing a customer name filters the table live, like the Projects list.
    const s = sanitizeForIlike(filters.search);
    const projectIds = await matchProjectIdsByText(filters.search);
    const clauses = [`title.ilike.${s}`];
    if (projectIds.length > 0) clauses.push(`project_id.in.(${projectIds.join(',')})`);
    query = query.or(clauses.join(','));
  }
  if (filters.project_id) query = query.eq('project_id', filters.project_id);
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);
  if (filters.category) query = query.eq('category' as any, filters.category);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load tasks: ${error.message}`);
  }

  const enriched = await enrichLeadNames(supabase, data ?? []);
  return { tasks: enriched, total: count ?? 0 };
}

/**
 * All non-deleted tasks assigned to one employee (open + closed), with the same
 * embeds as the global Tasks list. Powers the /my-tasks page (KPIs + table).
 *
 * Filters by `assigned_to = employees.id` — callers MUST resolve the employee id
 * via getCurrentEmployeeId() first; passing a profiles.id / auth uid yields a
 * silent empty list (the columns hold employees.id, not the auth uid).
 *
 * Unpaginated: a single PM's task book is bounded well under PostgREST's
 * default 1000-row cap, so the page can compute exact Total/Open/Closed counts
 * from the returned array without a separate count query.
 */
export async function getMyTasksDetailed(employeeId: string) {
  const op = '[getMyTasksDetailed]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('assigned_to', employeeId)
    .is('deleted_at', null)
    .order('is_completed', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, employeeId });
    throw new Error(`Failed to load tasks: ${error.message}`);
  }

  return enrichLeadNames(supabase, data ?? []);
}
