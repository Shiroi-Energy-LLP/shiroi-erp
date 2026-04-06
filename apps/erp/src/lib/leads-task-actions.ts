'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

interface CreateLeadTaskInput {
  leadId: string;
  title: string;
  description?: string;
  assignedTo: string;
  dueDate: string;
  priority?: string;
}

export async function createLeadTask(input: CreateLeadTaskInput): Promise<{ success: boolean; error?: string }> {
  const op = '[createLeadTask]';
  console.log(`${op} Starting for lead: ${input.leadId}`);

  if (!input.title.trim()) return { success: false, error: 'Title is required' };
  if (!input.assignedTo) return { success: false, error: 'Assignee is required' };
  if (!input.dueDate) return { success: false, error: 'Due date is required' };

  const supabase = await createClient();

  // Get current user's employee record
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return { success: false, error: 'Employee record not found' };

  const { error } = await supabase.from('tasks').insert({
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description || null,
    entity_type: 'lead',
    entity_id: input.leadId,
    assigned_to: input.assignedTo,
    created_by: employee.id,
    due_date: input.dueDate,
    priority: input.priority ?? 'medium',
    is_completed: false,
  });

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads/${input.leadId}/tasks`);
  revalidatePath('/my-tasks');
  return { success: true };
}

export async function completeLeadTask(taskId: string, leadId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[completeLeadTask]';
  console.log(`${op} Starting for task: ${taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return { success: false, error: 'Employee record not found' };

  const { error } = await supabase
    .from('tasks')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      completed_by: employee.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads/${leadId}/tasks`);
  revalidatePath('/my-tasks');
  return { success: true };
}

export async function getLeadTasks(leadId: string) {
  const op = '[getLeadTasks]';
  console.log(`${op} Starting for lead: ${leadId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('*, assigned:employees!project_tasks_assigned_to_fkey(full_name), creator:employees!project_tasks_created_by_fkey(full_name)')
    .eq('entity_type', 'lead')
    .eq('entity_id', leadId)
    .is('deleted_at', null)
    .order('due_date', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load lead tasks: ${error.message}`);
  }
  return data ?? [];
}
