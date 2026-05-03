import { createClient } from '@repo/supabase/server';
import { type ActionResult, ok, err } from '@/lib/types/actions';

export type SalesTeamTaskRow = {
  id: string;
  title: string;
  category: string | null;
  entity_type: string;
  entity_id: string | null;
  customer_name: string | null;
  // DB-level NOT NULL is enforced by mig 108; types are still typed as
  // `string | null` because database.ts hasn't been regenerated against the
  // post-mig-108 schema. Treat as non-null at runtime.
  assigned_to: string | null;
  assignee_name: string;
  due_date: string | null;
  is_completed: boolean;
  priority: string;
  created_at: string;
};

export type SalesTeamTasksSort = 'assignee_name' | 'due_date' | 'created_at';

export async function getSalesTeamTasks(opts: {
  sortBy?: SalesTeamTasksSort;
  sortDir?: 'asc' | 'desc';
  includeCompleted?: boolean;
}): Promise<ActionResult<SalesTeamTaskRow[]>> {
  const op = '[getSalesTeamTasks]';
  console.log(`${op} Starting`, opts);

  const supabase = await createClient();

  // Query tasks in the sales domain:
  //   - lead_followup tasks (entity_type='lead', category='lead_followup')
  //   - any other lead tasks
  //   - payment_followup / payment_escalation (sales owns payment chasing)
  // Excludes: pure project-execution tasks (structure, panel, electrical, etc.)
  const SALES_CATEGORIES = [
    'lead_followup',
    'payment_followup',
    'payment_escalation',
    'general',
    'advance_payment',
  ] as const;

  let query = supabase
    .from('tasks')
    .select(
      'id, title, category, entity_type, entity_id, assigned_to, due_date, is_completed, priority, created_at, assignee:employees!project_tasks_assigned_to_fkey(full_name)',
    )
    .is('deleted_at', null)
    .or(
      `entity_type.eq.lead,and(entity_type.eq.project,category.in.(${SALES_CATEGORIES.filter((c) => c !== 'lead_followup').join(',')}))`,
    );

  if (!opts.includeCompleted) {
    query = query.eq('is_completed', false);
  }

  // Sorting — assignee_name requires a second pass; others are native
  const sortDb = opts.sortBy === 'assignee_name' ? 'created_at' : (opts.sortBy ?? 'due_date');
  const ascending = (opts.sortDir ?? 'asc') === 'asc';
  query = query.order(sortDb, { ascending, nullsFirst: false });

  const { data, error } = await query;

  if (error) {
    console.error(`${op} Query failed`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return err(`Failed to load sales team tasks: ${error.message}`, error.code);
  }

  const tasks = data ?? [];

  // Enrich with customer_name for lead-type tasks
  const leadIds = tasks
    .filter((t) => t.entity_type === 'lead' && t.entity_id)
    .map((t) => t.entity_id as string);

  const leadNameMap = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leadRows, error: leadErr } = await supabase
      .from('leads')
      .select('id, customer_name')
      .in('id', leadIds);
    if (leadErr) {
      console.error(`${op} Lead enrichment failed`, { code: leadErr.code, message: leadErr.message, timestamp: new Date().toISOString() });
    } else {
      for (const row of leadRows ?? []) {
        leadNameMap.set(row.id, row.customer_name);
      }
    }
  }

  // Enrich with customer_name for project-type tasks
  const projectIds = tasks
    .filter((t) => t.entity_type === 'project' && t.entity_id)
    .map((t) => t.entity_id as string);

  const projectNameMap = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projRows, error: projErr } = await supabase
      .from('projects')
      .select('id, customer_name')
      .in('id', projectIds);
    if (projErr) {
      console.error(`${op} Project enrichment failed`, { code: projErr.code, message: projErr.message, timestamp: new Date().toISOString() });
    } else {
      for (const row of projRows ?? []) {
        projectNameMap.set(row.id, row.customer_name);
      }
    }
  }

  const rows: SalesTeamTaskRow[] = tasks.map((t) => {
    const assigneeRaw = t.assignee as { full_name: string } | null;
    const customerName =
      t.entity_type === 'lead'
        ? (leadNameMap.get(t.entity_id ?? '') ?? null)
        : (projectNameMap.get(t.entity_id ?? '') ?? null);

    return {
      id: t.id,
      title: t.title,
      category: t.category,
      entity_type: t.entity_type,
      entity_id: t.entity_id,
      customer_name: customerName,
      assigned_to: t.assigned_to,
      assignee_name: assigneeRaw?.full_name ?? '—',
      due_date: t.due_date,
      is_completed: t.is_completed,
      priority: t.priority,
      created_at: t.created_at,
    };
  });

  // Secondary sort for assignee_name (can't be done in SQL directly here)
  if (opts.sortBy === 'assignee_name') {
    const dir = (opts.sortDir ?? 'asc') === 'asc' ? 1 : -1;
    rows.sort((a, b) => dir * a.assignee_name.localeCompare(b.assignee_name, 'en-IN'));
  }

  return ok(rows);
}
