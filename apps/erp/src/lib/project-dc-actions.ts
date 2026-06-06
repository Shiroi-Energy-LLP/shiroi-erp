'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { emitErpEvent } from '@/lib/n8n/emit';

// Item 15a (2026-06-06): milestone seed/update + tasks + employee dropdown
// moved to project-milestone-actions.ts to keep this file under the 500-LOC
// ceiling. What lives here: vendor delivery challan (incoming GRN) + outgoing
// delivery challan + the increment_boq_dispatched_qty caller + site-address
// helper for DC autofill.

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
