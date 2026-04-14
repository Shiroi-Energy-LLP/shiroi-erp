'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
type TaskWorkLogInsert = Database['public']['Tables']['task_work_logs']['Insert'];
type TaskWorkLogRow = Database['public']['Tables']['task_work_logs']['Row'];

// ═══════════════════════════════════════════════════════════════════════
// Create Task
// ═══════════════════════════════════════════════════════════════════════

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
  milestoneId?: string;
}): Promise<ActionResult<void>> {
  const op = '[createTask]';
  console.log(`${op} Starting: ${input.title}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!employee) return err('Employee profile not found');

  const today = new Date().toISOString().split('T')[0]!;

  const insert: TaskInsert = {
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
    milestone_id: input.milestoneId || null,
  };

  const { error } = await supabase.from('tasks').insert(insert);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Update Task
// ═══════════════════════════════════════════════════════════════════════

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
  milestoneId?: string;
  completedBy?: string;
}): Promise<ActionResult<void>> {
  const op = '[updateTask]';
  console.log(`${op} Starting for task: ${input.taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const updateData: TaskUpdate = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description || null;
  if (input.category !== undefined) updateData.category = input.category || null;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.dueDate !== undefined) updateData.due_date = input.dueDate || null;
  if (input.assignedTo !== undefined) updateData.assigned_to = input.assignedTo || null;
  if (input.remarks !== undefined) updateData.remarks = input.remarks || null;
  if (input.projectId !== undefined) updateData.project_id = input.projectId || null;
  if (input.milestoneId !== undefined) updateData.milestone_id = input.milestoneId || null;
  if (input.completedBy !== undefined) {
    updateData.completed_by = input.completedBy || null;
    if (input.completedBy) {
      updateData.is_completed = true;
      updateData.completed_at = new Date().toISOString();
    }
  }

  const { error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', input.taskId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Toggle Task Status (Open/Closed)
// ═══════════════════════════════════════════════════════════════════════

export async function toggleTaskStatus(
  taskId: string,
  isCompleted: boolean,
): Promise<ActionResult<void>> {
  const op = '[toggleTaskStatus]';
  console.log(`${op} Toggling task ${taskId} to ${isCompleted ? 'closed' : 'open'}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const updateData: TaskUpdate = { is_completed: isCompleted };

  if (isCompleted) {
    updateData.completed_at = new Date().toISOString();
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (emp) updateData.completed_by = emp.id;
  } else {
    updateData.completed_at = null;
    updateData.completed_by = null;
  }

  const { error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', taskId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Delete Task (soft)
// ═══════════════════════════════════════════════════════════════════════

export async function deleteTask(taskId: string): Promise<ActionResult<void>> {
  const op = '[deleteTask]';
  console.log(`${op} Starting for task: ${taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const update: TaskUpdate = { deleted_at: new Date().toISOString() };
  const { error } = await supabase
    .from('tasks')
    .update(update)
    .eq('id', taskId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// Work Log CRUD
// ═══════════════════════════════════════════════════════════════════════

export async function addWorkLog(input: {
  taskId: string;
  description: string;
  logDate?: string;
  progressPct?: number;
  hoursSpent?: number;
}): Promise<ActionResult<void>> {
  const op = '[addWorkLog]';
  console.log(`${op} Starting for task: ${input.taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!employee) return err('Employee profile not found');

  const insert: TaskWorkLogInsert = {
    task_id: input.taskId,
    logged_by: employee.id,
    log_date: input.logDate || new Date().toISOString().split('T')[0]!,
    description: input.description,
    progress_pct: input.progressPct ?? null,
    hours_spent: input.hoursSpent ?? null,
  };

  const { error } = await supabase.from('task_work_logs').insert(insert);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  revalidatePath('/tasks');
  return ok(undefined);
}

export type WorkLogRow = Pick<
  TaskWorkLogRow,
  'id' | 'task_id' | 'log_date' | 'description' | 'progress_pct' | 'hours_spent' | 'created_at' | 'logged_by'
> & {
  employees: { full_name: string } | null;
};

export async function getWorkLogs(taskId: string): Promise<WorkLogRow[]> {
  const op = '[getWorkLogs]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('task_work_logs')
    .select(
      'id, task_id, log_date, description, progress_pct, hours_spent, created_at, logged_by, employees!task_work_logs_logged_by_fkey(full_name)',
    )
    .eq('task_id', taskId)
    .order('log_date', { ascending: false })
    .returns<WorkLogRow[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

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
    .order('customer_name', { ascending: true });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// Milestones for a project (task creation)
// ═══════════════════════════════════════════════════════════════════════

export async function getMilestonesForProject(
  projectId: string,
): Promise<{ id: string; milestone_name: string }[]> {
  const op = '[getMilestonesForProject]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_milestones')
    .select('id, milestone_name')
    .eq('project_id', projectId)
    .order('milestone_name');

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
