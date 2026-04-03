import { createClient } from '@repo/supabase/server';

export async function getAllTasks(filters: { status?: string; priority?: string; entity_type?: string; search?: string } = {}) {
  const op = '[getAllTasks]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  let query = supabase
    .from('tasks')
    .select('*, assignee:employees!project_tasks_assigned_to_fkey(full_name)')
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false });

  // Map status filter to is_completed boolean
  if (filters.status === 'completed') query = query.eq('is_completed', true);
  if (filters.status === 'pending') query = query.eq('is_completed', false);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.entity_type) query = query.eq('entity_type', filters.entity_type);
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load tasks: ${error.message}`);
  }
  return data ?? [];
}
