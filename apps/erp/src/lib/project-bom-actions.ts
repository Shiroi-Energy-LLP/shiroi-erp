'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── BOM Line CRUD (edit/add/delete within project's proposal) ──

export async function addBomLine(input: {
  projectId: string;
  data: {
    item_category: string;
    item_description: string;
    brand: string | null;
    model: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    gst_rate: number;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addBomLine]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get proposal_id from project
  const { data: project } = await supabase
    .from('projects')
    .select('proposal_id')
    .eq('id', input.projectId)
    .single();

  if (!project?.proposal_id) {
    return { success: false, error: 'No proposal linked to this project' };
  }

  // Get next line number
  const { data: existing } = await supabase
    .from('proposal_bom_lines')
    .select('line_number')
    .eq('proposal_id', project.proposal_id)
    .order('line_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextLine = (existing?.line_number ?? 0) + 1;

  const gstAmount = input.data.quantity * input.data.unit_price * (input.data.gst_rate / 100);
  const totalPrice = input.data.quantity * input.data.unit_price + gstAmount;

  const { error } = await supabase
    .from('proposal_bom_lines')
    .insert({
      proposal_id: project.proposal_id,
      line_number: nextLine,
      item_category: input.data.item_category,
      item_description: input.data.item_description,
      brand: input.data.brand,
      model: input.data.model,
      quantity: input.data.quantity,
      unit: input.data.unit,
      unit_price: input.data.unit_price,
      gst_rate: input.data.gst_rate,
      gst_amount: gstAmount,
      gst_type: 'supply' as any,
      total_price: totalPrice,
      scope_owner: 'shiroi' as any,
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function deleteBomLine(input: {
  projectId: string;
  lineId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteBomLine]';
  console.log(`${op} Deleting line: ${input.lineId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('proposal_bom_lines')
    .delete()
    .eq('id', input.lineId);

  if (error) {
    console.error(`${op} Delete failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOI Version Management (multi-BOI: BOI-1, BOI-2, etc.) ──
// BOI = Bill of Items, the procurement-side counterpart to the customer BOM.
// Kept in this file because BOI/BOM share the same conceptual phase
// (lock pricing before procurement).

export async function createBoiVersion(input: {
  projectId: string;
}): Promise<{ success: boolean; boiId?: string; error?: string }> {
  const op = '[createBoiVersion]';
  console.log(`${op} Creating new BOI for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', user.id).single();
  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Get next BOI number
  const { data: maxBoi } = await supabase
    .from('project_bois')
    .select('boi_number')
    .eq('project_id', input.projectId)
    .order('boi_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNumber = ((maxBoi as any)?.boi_number ?? 0) + 1;

  const { data, error } = await supabase
    .from('project_bois')
    .insert({
      project_id: input.projectId,
      boi_number: nextNumber,
      status: 'draft',
      prepared_by: employee.id,
    } as any)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, boiId: (data as any).id };
}

export async function submitBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[submitBoiVersion]';
  console.log(`${op} Submitting BOI ${input.boiId}`);

  const supabase = await createClient();

  // Verify items exist
  const { count } = await supabase
    .from('project_boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('boi_id', input.boiId);

  if (!count || count === 0) {
    return { success: false, error: 'Cannot submit empty BOI. Add items first.' };
  }

  const { error } = await supabase
    .from('project_bois')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() } as any)
    .eq('id', input.boiId)
    .eq('status', 'draft' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function approveBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[approveBoiVersion]';
  console.log(`${op} Approving BOI ${input.boiId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', user.id).single();

  const { error } = await supabase
    .from('project_bois')
    .update({
      status: 'approved',
      approved_by: employee?.id,
      approved_at: new Date().toISOString(),
    } as any)
    .eq('id', input.boiId)
    .eq('status', 'submitted' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Update project-level flag for backward compat
  await supabase
    .from('projects')
    .update({ boi_locked: true, boi_locked_by: employee?.id, boi_locked_at: new Date().toISOString() } as any)
    .eq('id', input.projectId);

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function lockBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[lockBoiVersion]';
  console.log(`${op} Locking BOI ${input.boiId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', user.id).single();

  const { error } = await supabase
    .from('project_bois')
    .update({
      status: 'locked',
      locked_by: employee?.id,
      locked_at: new Date().toISOString(),
    } as any)
    .eq('id', input.boiId)
    .eq('status', 'approved' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function unlockBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[unlockBoiVersion]';
  console.log(`${op} Unlocking BOI ${input.boiId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('project_bois')
    .update({
      status: 'approved',
      locked_by: null,
      locked_at: null,
    } as any)
    .eq('id', input.boiId)
    .eq('status', 'locked' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOI: Lock (submit) ──
// Legacy project-level boi_locked flag — predates per-version locking above.

export async function lockBoi(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[lockBoi]';
  console.log(`${op} Locking BOI for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Verify BOQ items exist
  const { count } = await supabase
    .from('project_boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  if (!count || count === 0) {
    return { success: false, error: 'No BOI items to submit. Add items first.' };
  }

  const { error } = await supabase
    .from('projects')
    .update({
      boi_locked: true,
      boi_locked_at: new Date().toISOString(),
      boi_locked_by: employee.id,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOI: Unlock (for corrections) ──

export async function unlockBoi(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[unlockBoi]';
  console.log(`${op} Unlocking BOI for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({
      boi_locked: false,
      boi_locked_at: null,
      boi_locked_by: null,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}
