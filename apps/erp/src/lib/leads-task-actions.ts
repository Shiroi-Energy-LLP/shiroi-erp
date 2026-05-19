'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

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

/**
 * Upsert an open lead_followup task for a given lead.
 *
 * - If an open task exists: UPDATE its due_date.
 * - Else: INSERT a new task with category='lead_followup'.
 *
 * This is a fire-and-forget complement to the DB trigger
 * (trg_sync_lead_followup_task from mig 108) which handles
 * next_followup_date changes on the leads table. This action
 * handles explicit follow-up date changes from the UI.
 */
export async function upsertLeadFollowupTask(
  leadId: string,
  dueDate: string,
): Promise<ActionResult<{ taskId: string; created: boolean }>> {
  const op = '[upsertLeadFollowupTask]';
  console.log(`${op} Starting for lead: ${leadId}, dueDate: ${dueDate}`);

  if (!leadId) return err('leadId is required');
  if (!dueDate) return err('dueDate is required');

  const supabase = await createClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: callerEmployee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!callerEmployee) return err('Employee record not found');

  const callerEmployeeId = callerEmployee.id;

  // Look up lead for customer_name and assigned_to
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, customer_name, assigned_to')
    .eq('id', leadId)
    .is('deleted_at', null)
    .single();

  if (leadError || !lead) {
    console.error(`${op} Lead lookup failed:`, {
      leadId,
      error: leadError,
      timestamp: new Date().toISOString(),
    });
    return err(leadError?.message ?? 'Lead not found');
  }

  // Find existing open follow-up task
  const { data: existing, error: searchError } = await supabase
    .from('tasks')
    .select('id')
    .eq('entity_type', 'lead')
    .eq('entity_id', leadId)
    .eq('category', 'lead_followup')
    .eq('is_completed', false)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (searchError) {
    console.error(`${op} Task search failed:`, {
      leadId,
      error: searchError,
      timestamp: new Date().toISOString(),
    });
    return err(searchError.message);
  }

  if (existing) {
    // UPDATE existing task's due_date
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ due_date: dueDate, updated_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (updateError) {
      console.error(`${op} Update failed:`, {
        taskId: existing.id,
        leadId,
        error: updateError,
        timestamp: new Date().toISOString(),
      });
      return err(updateError.message);
    }

    revalidatePath('/sales/tasks');
    revalidatePath('/dashboard');
    revalidatePath(`/sales/${leadId}/tasks`);
    return ok({ taskId: existing.id as string, created: false });
  }

  // INSERT new task
  const newTaskId = crypto.randomUUID();
  const assignedTo = lead.assigned_to ?? callerEmployeeId;

  const { error: insertError } = await supabase.from('tasks').insert({
    id: newTaskId,
    entity_type: 'lead',
    entity_id: leadId,
    category: 'lead_followup',
    title: `Follow up with ${lead.customer_name}`,
    assigned_to: assignedTo,
    created_by: callerEmployeeId,
    due_date: dueDate,
    priority: 'medium',
    is_completed: false,
  });

  if (insertError) {
    console.error(`${op} Insert failed:`, {
      leadId,
      error: insertError,
      timestamp: new Date().toISOString(),
    });
    return err(insertError.message);
  }

  revalidatePath('/sales/tasks');
  revalidatePath('/dashboard');
  revalidatePath(`/sales/${leadId}/tasks`);
  return ok({ taskId: newTaskId, created: true });
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
