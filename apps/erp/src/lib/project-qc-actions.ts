'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── QC Inspection CRUD (V2 — structured 7-section form) ──
// Extracted from project-commissioning-actions.ts (item 15a, 2026-06-06) to
// keep that file under the 500-LOC ceiling. QC gates are the quality
// checkpoints that feed the commissioning report; they share the same "site
// quality" domain but warrant their own module.

export async function createQcInspection(input: {
  projectId: string;
  data: {
    checklist_data: Record<string, unknown>; // QcChecklistData stored as JSONB
    overall_result: string; // 'approved' | 'rework_required'
    remarks?: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createQcInspection]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Auto-calculate gate number
  const { count } = await supabase
    .from('qc_gate_inspections')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  const gateNumber = (count ?? 0) + 1;

  const { error } = await supabase
    .from('qc_gate_inspections')
    .insert({
      project_id: input.projectId,
      inspected_by: employee.id,
      gate_number: gateNumber,
      milestone_id: null,
      inspection_date: new Date().toISOString().split('T')[0],
      overall_result: input.data.overall_result,
      approval_status: 'submitted',
      requires_reinspection: input.data.overall_result === 'rework_required',
      checklist_items: input.data.checklist_data as any,
      remarks: input.data.remarks ?? null,
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function approveQcInspection(input: {
  projectId: string;
  inspectionId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[approveQcInspection]';
  console.log(`${op} Approving QC for project: ${input.projectId}`);

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
    .from('qc_gate_inspections')
    .update({
      approval_status: 'approved',
      overall_result: 'approved',
      approved_by: employee.id,
      approved_at: new Date().toISOString(),
    } as any)
    .eq('id', input.inspectionId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Approve failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function requestQcRework(input: {
  projectId: string;
  inspectionId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[requestQcRework]';
  console.log(`${op} Requesting rework for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('qc_gate_inspections')
    .update({
      approval_status: 'rework_required',
      overall_result: 'rework_required',
      requires_reinspection: true,
    } as any)
    .eq('id', input.inspectionId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Rework request failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// Note: getProjectMilestones lives in projects-queries.ts (the live one used by
// the milestones page). A dead duplicate here was removed in the 2026-06-18
// redundancy sweep — it had zero import sites.
