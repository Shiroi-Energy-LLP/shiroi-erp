'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Create Task ──

export async function createTask(input: {
  title: string;
  description?: string;
  entityType: string;
  entityId?: string;
  projectId?: string;
  priority: string;
  dueDate?: string;
  assignedTo?: string;
  category?: string;
  remarks?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createTask]';
  console.log(`${op} Starting: ${input.title}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  const today = new Date().toISOString().split('T')[0];

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
      category: input.category || null,
      remarks: input.remarks || null,
      assigned_date: today,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true };
}

// ── Update Task ──

export async function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  dueDate?: string;
  assignedTo?: string;
  remarks?: string;
  projectId?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateTask]';
  console.log(`${op} Starting for task: ${input.taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description || null;
  if (input.category !== undefined) updateData.category = input.category || null;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.dueDate !== undefined) updateData.due_date = input.dueDate || null;
  if (input.assignedTo !== undefined) updateData.assigned_to = input.assignedTo || null;
  if (input.remarks !== undefined) updateData.remarks = input.remarks || null;
  if (input.projectId !== undefined) updateData.project_id = input.projectId || null;

  const { error } = await supabase
    .from('tasks' as any)
    .update(updateData as any)
    .eq('id', input.taskId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true };
}

// ── Delete Task (soft-delete) ──

export async function deleteTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteTask]';
  console.log(`${op} Starting for task: ${taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('tasks' as any)
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', taskId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true };
}

// ── Work Log CRUD ──

export async function addWorkLog(input: {
  taskId: string;
  description: string;
  logDate?: string;
  progressPct?: number;
  hoursSpent?: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addWorkLog]';
  console.log(`${op} Starting for task: ${input.taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  const { error } = await supabase
    .from('task_work_logs' as any)
    .insert({
      task_id: input.taskId,
      logged_by: employee.id,
      log_date: input.logDate || new Date().toISOString().split('T')[0],
      description: input.description,
      progress_pct: input.progressPct ?? null,
      hours_spent: input.hoursSpent ?? null,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/tasks');
  return { success: true };
}

export async function getWorkLogs(taskId: string): Promise<any[]> {
  const op = '[getWorkLogs]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('task_work_logs' as any)
    .select('id, task_id, log_date, description, progress_pct, hours_spent, created_at, logged_by, employees!task_work_logs_logged_by_fkey(full_name)' as any)
    .eq('task_id', taskId)
    .order('log_date', { ascending: false });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []) as any[];
}

// ── Helpers ──

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
