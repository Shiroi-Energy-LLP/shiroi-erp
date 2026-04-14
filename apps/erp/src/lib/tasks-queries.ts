'use server';

import { createClient } from '@repo/supabase/server';

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  due_date: string | null;
  priority: string;
  is_completed: boolean;
}

export async function getMyTasks(employeeId: string): Promise<TaskItem[]> {
  const op = '[getMyTasks]';
  console.log(`${op} Starting for employee: ${employeeId}`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, description, entity_type, entity_id, project_id, due_date, priority, is_completed')
    .eq('assigned_to', employeeId)
    .is('deleted_at', null)
    .order('is_completed', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    console.error(`${op} Query failed:`, {
      code: error.code,
      message: error.message,
      employeeId,
    });
    throw new Error(`Failed to load tasks: ${error.message}`);
  }

  return data ?? [];
}

export async function getTaskCountForEmployee(employeeId: string): Promise<number> {
  const op = '[getTaskCountForEmployee]';
  const supabase = await createClient();

  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', employeeId)
    .eq('is_completed', false)
    .is('deleted_at', null);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return 0;
  }

  return count ?? 0;
}

/**
 * Get only projects that have at least one task.
 * Used for the project filter dropdown on /tasks page so the filter doesn't
 * show 300+ projects most of which have no tasks.
 */
export async function getProjectsWithTasks(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getProjectsWithTasks]';
  console.log(`${op} Starting`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('project_id, projects!project_tasks_project_id_fkey(id, project_number, customer_name)')
    .not('project_id', 'is', null)
    .is('deleted_at', null)
    .limit(2000);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  // Deduplicate by project_id
  const seen = new Set<string>();
  const result: { id: string; project_number: string; customer_name: string }[] = [];
  for (const row of data ?? []) {
    const p = (row as any).projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({ id: p.id, project_number: p.project_number ?? '', customer_name: p.customer_name ?? '' });
    }
  }
  return result.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''));
}
