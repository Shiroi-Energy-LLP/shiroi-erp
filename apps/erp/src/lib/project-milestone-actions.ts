'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { emitErpEvent } from '@/lib/n8n/emit';

// Extracted from project-dc-actions.ts (item 15a, 2026-06-06) to keep that
// file under the 500-LOC ceiling. Milestones + tasks + the employee dropdown
// live together because the execution-step form (milestone-form.tsx) imports
// all three side-by-side.

// ── Milestones: Seed defaults from master table ──

// Fallback if master table is empty (should not happen after migration 042)
const FALLBACK_MILESTONES = [
  { milestone_name: 'material_delivery', milestone_order: 1, is_payment_gate: false },
  { milestone_name: 'structure_installation', milestone_order: 2, is_payment_gate: false },
  { milestone_name: 'panel_installation', milestone_order: 3, is_payment_gate: false },
  { milestone_name: 'electrical_work', milestone_order: 4, is_payment_gate: true },
  { milestone_name: 'earthing_work', milestone_order: 5, is_payment_gate: false },
  { milestone_name: 'civil_work', milestone_order: 6, is_payment_gate: false },
  { milestone_name: 'testing_commissioning', milestone_order: 7, is_payment_gate: true },
  { milestone_name: 'net_metering', milestone_order: 8, is_payment_gate: false },
  { milestone_name: 'handover', milestone_order: 9, is_payment_gate: true },
  { milestone_name: 'follow_ups', milestone_order: 10, is_payment_gate: false },
];

/** Fetch milestone definitions from master table. */
export async function getExecutionMilestonesMaster(): Promise<
  { milestone_name: string; milestone_label: string; milestone_order: number; is_payment_gate: boolean }[]
> {
  const op = '[getExecutionMilestonesMaster]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('execution_milestones_master')
    .select('milestone_name, milestone_label, milestone_order, is_payment_gate')
    .eq('is_active', true)
    .order('milestone_order', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return FALLBACK_MILESTONES.map((m) => ({
      ...m,
      milestone_label: m.milestone_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));
  }
  return data ?? [];
}

export async function seedProjectMilestones(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[seedProjectMilestones]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Check if milestones already exist
  const { count: existing } = await supabase
    .from('project_milestones')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  if (existing && existing > 0) {
    return { success: false, error: 'Milestones already exist. Cannot re-seed.' };
  }

  // Read from master table (dynamic, not hardcoded)
  const masterMilestones = await getExecutionMilestonesMaster();

  // Map payment gates: electrical_work=1, testing_commissioning=2, handover=3
  const paymentGateMap: Record<string, number> = {
    electrical_work: 1,
    testing_commissioning: 2,
    handover: 3,
  };

  const milestones = masterMilestones.map((m) => ({
    project_id: input.projectId,
    milestone_name: m.milestone_name,
    milestone_order: m.milestone_order,
    is_payment_gate: m.is_payment_gate,
    payment_gate_number: paymentGateMap[m.milestone_name] ?? null,
    status: 'pending',
    completion_pct: 0,
  }));

  const { error: insertError } = await supabase
    .from('project_milestones')
    .insert(milestones as any);

  if (insertError) {
    console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
    return { success: false, error: insertError.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, count: milestones.length };
}

// ── Milestones: Update status and dates ──

export async function updateMilestoneStatus(input: {
  projectId: string;
  milestoneId: string;
  status?: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  actual_start_date?: string | null;
  actual_end_date?: string | null;
  is_blocked?: boolean;
  blocked_reason?: string | null;
  notes?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateMilestoneStatus]';
  console.log(`${op} Updating milestone ${input.milestoneId}`);

  const supabase = await createClient();

  const updateData: Record<string, any> = {};

  if (input.status !== undefined) {
    updateData.status = input.status;
    // Auto-set dates based on status transitions
    if (input.status === 'in_progress' && !input.actual_start_date) {
      updateData.actual_start_date = new Date().toISOString().split('T')[0];
    }
    if (input.status === 'completed' && !input.actual_end_date) {
      updateData.actual_end_date = new Date().toISOString().split('T')[0];
      updateData.completion_pct = 100;
    }
  }

  if (input.planned_start_date !== undefined) updateData.planned_start_date = input.planned_start_date;
  if (input.planned_end_date !== undefined) updateData.planned_end_date = input.planned_end_date;
  if (input.actual_start_date !== undefined) updateData.actual_start_date = input.actual_start_date;
  if (input.actual_end_date !== undefined) updateData.actual_end_date = input.actual_end_date;
  if (input.notes !== undefined) updateData.notes = input.notes;

  if (input.is_blocked !== undefined) {
    updateData.is_blocked = input.is_blocked;
    if (input.is_blocked) {
      updateData.blocked_reason = input.blocked_reason ?? null;
      updateData.blocked_since = new Date().toISOString();
      updateData.status = 'blocked';
    } else {
      updateData.blocked_reason = null;
      updateData.blocked_since = null;
      // Revert to in_progress when unblocked
      if (!input.status) updateData.status = 'in_progress';
    }
  }

  if (Object.keys(updateData).length === 0) {
    return { success: true }; // nothing to update
  }

  const { error } = await supabase
    .from('project_milestones')
    .update(updateData as any)
    .eq('id', input.milestoneId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  if (input.status === 'completed') {
    void emitMilestoneComplete(input.projectId, input.milestoneId);
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

async function emitMilestoneComplete(projectId: string, milestoneId: string): Promise<void> {
  const op = '[emitMilestoneComplete]';
  try {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from('projects')
      .select('id, project_number, customer_name, customer_phone')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return;

    const { data: milestone } = await supabase
      .from('project_milestones')
      .select('milestone_name, actual_end_date')
      .eq('id', milestoneId)
      .maybeSingle();
    if (!milestone) return;

    await emitErpEvent('project.milestone_complete', {
      project_id: project.id,
      project_number: project.project_number,
      customer_name: project.customer_name,
      customer_phone: project.customer_phone,
      milestone_name: milestone.milestone_name,
      completed_at: milestone.actual_end_date ?? new Date().toISOString().split('T')[0],
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      projectId,
      milestoneId,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Quick Task: Create from Execution step ──
// Tasks are grouped with milestones because they live in the same execution
// step and the form (milestone-form.tsx) imports both alongside each other.

export async function createQuickTask(input: {
  projectId: string;
  milestoneId?: string;
  title: string;
  priority?: string;
  dueDate?: string;
  assignedTo?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const op = '[createQuickTask]';
  console.log(`${op} Creating task for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee not found' };

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      project_id: input.projectId,
      milestone_id: input.milestoneId || null,
      title: input.title,
      priority: input.priority || 'medium',
      due_date: input.dueDate || null,
      entity_type: 'project',
      entity_id: input.projectId,
      created_by: employee.id,
      assigned_to: input.assignedTo || employee.id,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true, taskId: task?.id };
}

// ── Task: Toggle completion ──

export async function toggleTaskCompletion(input: {
  taskId: string;
  isCompleted: boolean;
  projectId?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[toggleTaskCompletion]';
  console.log(`${op} Setting task ${input.taskId} to ${input.isCompleted ? 'completed' : 'pending'}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, unknown> = {
    is_completed: input.isCompleted,
  };
  if (input.isCompleted) {
    updateData.completed_at = new Date().toISOString();
  } else {
    updateData.completed_at = null;
  }

  const { error } = await supabase
    .from('tasks')
    .update(updateData as any)
    .eq('id', input.taskId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  if (input.projectId) {
    revalidatePath(`/projects/${input.projectId}`);
  }
  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true };
}

// ── Employees: Get active list for dropdowns ──

export async function getActiveEmployeesForProject(): Promise<{ id: string; full_name: string }[]> {
  const op = '[getActiveEmployeesForProject]';
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
