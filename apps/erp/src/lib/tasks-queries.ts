import { createClient } from '@repo/supabase/server';

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  entity_type: string;
  entity_id: string | null;
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
    .select('id, title, description, entity_type, entity_id, due_date, priority, is_completed')
    .eq('assigned_to', employeeId)
    .eq('is_completed', false)
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false });

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
