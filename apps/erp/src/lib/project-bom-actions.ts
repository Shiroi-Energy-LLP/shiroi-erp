'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { buildBoqItemDiff, type BoqItemPatch, type BoqItemSnapshot } from './boq-item-diff';
import { getCurrentEmployeeId, getUserProfile } from './auth';

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

// ── BOI Items: edit any state, audited (mig 175) ──
// PM/founder may edit BOI items even when the BOI version is locked; every
// change writes a project_boq_item_history row first. History insert failure
// ABORTS the edit — an unaudited change defeats the purpose of the override.

const BOI_EDIT_ROLES = new Set<string>(['founder', 'project_manager']);

export async function updateBoiItem(input: {
  projectId: string;
  itemId: string;
  data: BoqItemPatch;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoiItem]';

  const profile = await getUserProfile();
  if (!profile) return { success: false, error: 'Not authenticated' };
  if (!BOI_EDIT_ROLES.has(profile.role)) {
    return { success: false, error: 'Only the Project Manager can edit BOI items.' };
  }
  const employeeId = await getCurrentEmployeeId();
  if (!employeeId) return { success: false, error: 'No employee record linked to your account.' };

  const supabase = await createClient();

  const { data: current, error: readErr } = await supabase
    .from('project_boq_items')
    .select('id, project_id, boi_id, item_description, brand, model, quantity, unit, unit_price, gst_rate')
    .eq('id', input.itemId)
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (readErr) {
    console.error(`${op} Read failed:`, { code: readErr.code, message: readErr.message, itemId: input.itemId });
    return { success: false, error: readErr.message };
  }
  if (!current) return { success: false, error: 'Item not found' };

  const snapshot: BoqItemSnapshot = {
    item_description: current.item_description,
    brand: current.brand,
    model: current.model,
    quantity: current.quantity === null ? null : Number(current.quantity),
    unit: current.unit,
    unit_price: current.unit_price === null ? null : Number(current.unit_price),
    gst_rate: current.gst_rate === null ? null : Number(current.gst_rate),
  };
  const diff = buildBoqItemDiff(snapshot, input.data);
  if (Object.keys(diff).length === 0) return { success: true };

  // 1. Audit first — abort on failure.
  const { error: histErr } = await supabase.from('project_boq_item_history').insert({
    boq_item_id: current.id,
    project_id: current.project_id,
    boi_id: current.boi_id,
    changed_by: employeeId,
    changes: diff,
  });
  if (histErr) {
    console.error(`${op} History insert failed — edit aborted:`, {
      code: histErr.code, message: histErr.message, itemId: input.itemId,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: `Audit log write failed: ${histErr.message}` };
  }

  // 2. Apply the edit. Recompute total when any pricing input changed
  //    (same formula as updateBoqItem: qty × rate × (1 + gst/100)).
  const updateData: Record<string, unknown> = {};
  for (const [field, change] of Object.entries(diff)) updateData[field] = change.new;

  if ('quantity' in diff || 'unit_price' in diff || 'gst_rate' in diff) {
    const qty = ('quantity' in diff ? diff.quantity.new : snapshot.quantity) as number | null;
    const rate = ('unit_price' in diff ? diff.unit_price.new : snapshot.unit_price) as number | null;
    const gst = ('gst_rate' in diff ? diff.gst_rate.new : snapshot.gst_rate) as number | null;
    updateData.total_price = Number(qty ?? 0) * Number(rate ?? 0) * (1 + Number(gst ?? 0) / 100);
  }

  const { error: updErr } = await supabase
    .from('project_boq_items')
    .update(updateData as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (updErr) {
    console.error(`${op} Update failed (audit row already written):`, {
      code: updErr.code, message: updErr.message, itemId: input.itemId,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: updErr.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// Lazy-loaded per-item audit trail for the expandable history row.
export interface BoiItemHistoryEntry {
  id: string;
  changed_at: string;
  changed_by_name: string | null;
  changes: Record<string, { old: string | number | null; new: string | number | null }>;
}

export async function getBoiItemHistory(input: {
  itemId: string;
}): Promise<{ success: boolean; entries?: BoiItemHistoryEntry[]; error?: string }> {
  const op = '[getBoiItemHistory]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_boq_item_history')
    .select('id, changed_at, changes, employees!project_boq_item_history_changed_by_fkey(full_name)')
    .eq('boq_item_id', input.itemId)
    .order('changed_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, itemId: input.itemId });
    return { success: false, error: error.message };
  }

  return {
    success: true,
    entries: (data ?? []).map((r: any) => ({
      id: r.id,
      changed_at: r.changed_at,
      changed_by_name: r.employees?.full_name ?? null,
      changes: r.changes ?? {},
    })),
  };
}
