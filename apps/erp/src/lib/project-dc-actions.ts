'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { emitErpEvent } from '@/lib/n8n/emit';

// TODO(NEVER-DO #14): this file is 620 LOC. A follow-up could split it into
// project-dc-actions.ts (DC + vendor DC + delivery challan, ~360 LOC) and
// project-milestone-actions.ts (milestone seed/update + tasks + employee
// dropdown, ~260 LOC). Kept merged here because the spec mandated a 5-file
// target.

// ── Vendor Delivery Challan CRUD (legacy — incoming from vendors) ──

export async function createVendorDeliveryChallan(input: {
  projectId: string;
  data: {
    vendor_dc_number: string;
    vendor_dc_date: string;
    vendor_id: string | null;
    received_date: string | null;
    status: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createVendorDeliveryChallan]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return { success: false, error: 'Employee profile not found' };

  const { data: inserted, error } = await supabase
    .from('vendor_delivery_challans')
    .insert({
      project_id: input.projectId,
      received_by: employee.id,
      vendor_dc_number: input.data.vendor_dc_number,
      vendor_dc_date: input.data.vendor_dc_date,
      vendor_id: input.data.vendor_id,
      received_date: input.data.received_date,
      status: input.data.status || 'pending',
    } as any)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  if (inserted) {
    void emitGrnRecorded(inserted.id, input.projectId, employee.id);
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

async function emitGrnRecorded(
  grnId: string,
  projectId: string,
  receivedByEmployeeId: string,
): Promise<void> {
  const op = '[emitGrnRecorded]';
  try {
    const supabase = await createClient();
    const { data: grn } = await supabase
      .from('vendor_delivery_challans')
      .select('id, vendor_dc_number, vendor_id, received_date')
      .eq('id', grnId)
      .maybeSingle();
    if (!grn) return;

    const { data: project } = await supabase
      .from('projects')
      .select('project_number')
      .eq('id', projectId)
      .maybeSingle();

    let vendorName: string | null = null;
    if (grn.vendor_id) {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('company_name')
        .eq('id', grn.vendor_id)
        .maybeSingle();
      vendorName = vendor?.company_name ?? null;
    }

    let receivedByName: string | null = null;
    let financeHeadWhatsapp: string | null = null;
    const { data: receiver } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', receivedByEmployeeId)
      .maybeSingle();
    receivedByName = receiver?.full_name ?? null;

    const { data: finance } = await supabase
      .from('employees')
      .select('whatsapp_number, profiles!inner(role)')
      .eq('profiles.role', 'finance')
      .limit(1)
      .maybeSingle();
    financeHeadWhatsapp = (finance as { whatsapp_number?: string | null } | null)?.whatsapp_number ?? null;

    await emitErpEvent('grn.recorded', {
      grn_id: grn.id,
      grn_number: grn.vendor_dc_number,
      project_id: projectId,
      project_code: project?.project_number ?? null,
      vendor_id: grn.vendor_id,
      vendor_name: vendorName,
      received_date: grn.received_date,
      received_by_name: receivedByName,
      finance_head_whatsapp: financeHeadWhatsapp,
      erp_url: `https://erp.shiroienergy.com/projects/${projectId}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      grnId,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Helper: Get vendors for delivery form ──

export async function getVendorsForDropdown(): Promise<{ id: string; company_name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('vendors')
    .select('id, company_name')
    .is('deleted_at', null)
    .order('company_name', { ascending: true })
    .limit(200);
  return data ?? [];
}

// ── Delivery Challan: Create from BOQ items ──
// Calls increment_boq_dispatched_qty RPC to atomically bump dispatched_qty on
// each BOQ item that's being shipped out. Single UPDATE per item avoids the
// lost-update race that two parallel challan dispatches would otherwise hit.

export async function createDeliveryChallan(input: {
  projectId: string;
  items: { boqItemId: string; quantity: number; description: string; unit: string; hsnCode?: string | null; itemCategory?: string | null }[];
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  transportMode?: string;
  dispatchFrom?: string;
  dispatchTo?: string;
  notes?: string;
}): Promise<{ success: boolean; challanId?: string; error?: string }> {
  const op = '[createDeliveryChallan]';
  console.log(`${op} Creating DC for project: ${input.projectId} with ${input.items.length} items`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  // Generate DC number — sequential per project (DC-001, DC-002, etc.)
  const { count } = await supabase
    .from('delivery_challans')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  const dcNumber = `DC-${String((count ?? 0) + 1).padStart(3, '0')}`;

  // Create challan
  const now = new Date();
  const { data: challanRaw, error: challanError } = await supabase
    .from('delivery_challans')
    .insert({
      project_id: input.projectId,
      dc_number: dcNumber,
      dc_date: now.toISOString().split('T')[0],
      vehicle_number: input.vehicleNumber || null,
      driver_name: input.driverName || null,
      driver_phone: input.driverPhone || null,
      transport_mode: input.transportMode || null,
      dispatch_from: input.dispatchFrom || null,
      dispatch_to: input.dispatchTo || null,
      dispatched_by: employee?.id || null,
      status: 'draft',
      notes: input.notes || null,
    } as any)
    .select('id')
    .single();

  const challan = challanRaw as any;

  if (challanError) {
    console.error(`${op} Challan create failed:`, { code: challanError.code, message: challanError.message });
    return { success: false, error: challanError.message };
  }

  // Create challan items (with hsn_code + item_category)
  const challanItems = input.items.map((item) => ({
    challan_id: challan.id,
    boq_item_id: item.boqItemId,
    quantity: item.quantity,
    item_description: item.description,
    unit: item.unit,
    hsn_code: item.hsnCode || null,
    item_category: item.itemCategory || null,
  }));

  const { error: itemsError } = await supabase
    .from('delivery_challan_items')
    .insert(challanItems as any);

  if (itemsError) {
    console.error(`${op} Items insert failed:`, { code: itemsError.code, message: itemsError.message });
    return { success: false, error: itemsError.message };
  }

  // Update dispatched_qty on BOQ items via atomic RPC (migration 143).
  // Single UPDATE per item avoids the lost-update race that two parallel
  // challan dispatches would otherwise hit with a read-then-write block.
  // TODO: drop the `as any` cast on `.rpc` once packages/types/database.ts
  // is regenerated to include increment_boq_dispatched_qty.
  for (const item of input.items) {
    const { error: rpcError } = await (supabase.rpc as any)(
      'increment_boq_dispatched_qty',
      {
        p_boq_item_id: item.boqItemId,
        p_delta: item.quantity,
      },
    );
    if (rpcError) {
      console.error(`${op} increment_boq_dispatched_qty failed for ${item.boqItemId}:`, {
        code: rpcError.code,
        message: rpcError.message,
      });
      // Non-fatal: challan + line items already inserted; surface the issue
      // in logs but don't roll the user's DC creation back.
    }
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, challanId: challan.id };
}

// ── DC: Submit (finalize) a delivery challan ──

export async function submitDeliveryChallan(input: {
  projectId: string;
  challanId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[submitDeliveryChallan]';
  console.log(`${op} Submitting DC ${input.challanId} for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('delivery_challans')
    .update({
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
    } as any)
    .eq('id', input.challanId)
    .eq('project_id', input.projectId)
    .eq('status', 'draft');

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── DC: Get project site address for auto-fill ──

export async function getProjectSiteAddress(input: {
  projectId: string;
}): Promise<string> {
  const op = '[getProjectSiteAddress]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('site_address_line1, site_address_line2, site_city, site_state, site_pincode')
    .eq('id', input.projectId)
    .single();

  if (error || !data) {
    console.error(`${op} Query failed:`, { error: error?.message, projectId: input.projectId });
    return '';
  }

  return [data.site_address_line1, data.site_address_line2, data.site_city, data.site_state, data.site_pincode]
    .filter(Boolean)
    .join(', ');
}

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
