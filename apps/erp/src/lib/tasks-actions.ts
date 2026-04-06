'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createTask(input: {
  title: string;
  description?: string;
  entityType: string;
  entityId?: string;
  projectId?: string;
  priority: string;
  dueDate?: string;
  assignedTo?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createTask]';
  console.log(`${op} Starting: ${input.title}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get the employee ID for created_by
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  const { error } = await supabase
    .from('tasks' as any)
    .insert({
      title: input.title,
      description: input.description || null,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      project_id: input.projectId || null,
      priority: input.priority,
      due_date: input.dueDate || null,
      assigned_to: input.assignedTo || null,
      created_by: employee.id,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true };
}

export async function getActiveEmployees(): Promise<{ id: string; full_name: string }[]> {
  const op = '[getActiveEmployees]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

export async function getActiveProjects(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getActiveProjects]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .is('deleted_at', null)
    .not('status', 'in', '("completed","cancelled")')
    .order('project_number', { ascending: false })
    .limit(200);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
