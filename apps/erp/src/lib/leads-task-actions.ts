'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { requireAuthUser } from '@/lib/auth';
import { createTask } from '@/lib/tasks-actions';
import type { Database } from '@repo/types/database';

type TaskRow = Database['public']['Tables']['tasks']['Row'] & {
  assigned: { full_name: string } | null;
  creator: { full_name: string } | null;
};

interface CreateLeadTaskInput {
  leadId: string;
  title: string;
  description?: string;
  assignedTo: string;
  dueDate: string;
  priority?: string;
  category?: string;
}

export async function createLeadTask(input: CreateLeadTaskInput): Promise<ActionResult<void>> {
  const op = '[createLeadTask]';
  console.log(`${op} Starting for lead: ${input.leadId}`);

  if (!input.title.trim()) return err('Title is required', 'MISSING_TITLE');
  if (!input.assignedTo) return err('Assignee is required', 'MISSING_ASSIGNEE');
  if (!input.dueDate) return err('Due date is required', 'MISSING_DUE_DATE');

  // Thin wrapper over the universal createTask (tasks-actions.ts), scoped to the
  // lead entity. createTask handles auth + created_by + the insert (and already
  // revalidates /tasks + /my-tasks); we keep the lead-specific validation codes
  // and add the lead tasks page.
  const result = await createTask({
    title: input.title,
    description: input.description,
    entityType: 'lead',
    entityId: input.leadId,
    priority: input.priority ?? 'medium',
    dueDate: input.dueDate,
    assignedTo: input.assignedTo,
    category: input.category ?? 'general',
  });

  if (!result.success) return err(result.error, result.code);

  revalidatePath(`/leads/${input.leadId}/tasks`);
  return ok(undefined);
}

export async function completeLeadTask(taskId: string, leadId: string): Promise<ActionResult<void>> {
  const op = '[completeLeadTask]';
  console.log(`${op} Starting for task: ${taskId}`);

  const authed = await requireAuthUser();
  if (!authed.success) return authed;
  const { user, supabase } = authed.data;

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return err('Employee record not found', 'EMPLOYEE_MISSING');

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
    return err(error.message, error.code);
  }

  revalidatePath(`/leads/${leadId}/tasks`);
  revalidatePath('/my-tasks');
  return ok(undefined);
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

  // Auth check
  const authed = await requireAuthUser();
  if (!authed.success) return authed;
  const { user, supabase } = authed.data;

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

export async function getLeadTasks(
  leadId: string,
): Promise<ActionResult<TaskRow[]>> {
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
    console.error(`${op} Query failed:`, {
      leadId,
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return err(`Failed to load lead tasks: ${error.message}`, error.code);
  }
  return ok((data ?? []) as TaskRow[]);
}
