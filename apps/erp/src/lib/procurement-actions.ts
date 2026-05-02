'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { logProcurementAudit } from '@/lib/procurement-audit';
import type { VendorSearchResult } from '@/lib/procurement-queries';
import type { Database } from '@repo/types/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface POLineItem {
  itemCategory: string;
  itemDescription: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  brand?: string;
  hsnCode?: string;
  boqItemId?: string;
}

// ---------------------------------------------------------------------------
// Create PO (manual — from /procurement)
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(input: {
  projectId: string;
  vendorId: string;
  expectedDeliveryDate?: string;
  paymentTermsDays?: number;
  notes?: string;
  lineItems: POLineItem[];
}): Promise<{ success: boolean; error?: string; poId?: string }> {
  const op = '[createPurchaseOrder]';

  if (!input.lineItems.length) return { success: false, error: 'At least one line item is required' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Generate PO number
  const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'PO' });
  const poNumber = docNum || `SHIROI/PO/${new Date().getFullYear()}/TEMP`;

  // Calculate totals
  let subtotal = 0;
  let gstTotal = 0;
  for (const item of input.lineItems) {
    const lineTotal = item.quantity * item.unitPrice;
    const lineGst = lineTotal * (item.gstRate / 100);
    subtotal += lineTotal;
    gstTotal += lineGst;
  }
  const totalAmount = subtotal + gstTotal;

  // Create PO
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      project_id: input.projectId,
      vendor_id: input.vendorId,
      prepared_by: employee.id,
      po_number: poNumber,
      status: 'draft',
      po_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: input.expectedDeliveryDate || null,
      payment_terms_days: input.paymentTermsDays ?? 30,
      subtotal,
      gst_amount: gstTotal,
      total_amount: totalAmount,
      amount_paid: 0,
      amount_outstanding: totalAmount,
      notes: input.notes || null,
    })
    .select('id')
    .single();

  if (poError) {
    console.error(`${op} PO insert failed:`, { code: poError.code, message: poError.message });
    return { success: false, error: poError.message };
  }

  // Create line items
  const lineItemRows = input.lineItems.map((item, idx) => {
    const lineTotal = item.quantity * item.unitPrice;
    const lineGst = lineTotal * (item.gstRate / 100);
    return {
      purchase_order_id: po.id,
      line_number: idx + 1,
      item_category: item.itemCategory,
      item_description: item.itemDescription,
      brand: item.brand || null,
      hsn_code: item.hsnCode || null,
      unit: item.unit,
      quantity_ordered: item.quantity,
      quantity_pending: item.quantity,
      unit_price: item.unitPrice,
      total_price: lineTotal + lineGst,
      gst_rate: item.gstRate,
      gst_amount: lineGst,
      boq_item_id: item.boqItemId || null,
    };
  });

  const { error: itemsError } = await supabase
    .from('purchase_order_items')
    .insert(lineItemRows);

  if (itemsError) {
    console.error(`${op} Line items insert failed:`, { code: itemsError.code, message: itemsError.message });
    return { success: true, poId: po.id, error: `PO created but line items failed: ${itemsError.message}` };
  }

  // Update BOQ items to link to PO and set status
  const boqItemIds = input.lineItems.filter((i) => i.boqItemId).map((i) => i.boqItemId!);
  if (boqItemIds.length > 0) {
    await supabase
      .from('project_boq_items')
      .update({ purchase_order_id: po.id, procurement_status: 'order_placed' } as any)
      .in('id', boqItemIds);
  }

  revalidatePath('/procurement');
  revalidatePath(`/procurement/project/${input.projectId}`);
  return { success: true, poId: po.id };
}

// ---------------------------------------------------------------------------
// Assign Vendor to BOQ Item
// ---------------------------------------------------------------------------

export async function assignVendorToBoqItem(input: {
  boqItemId: string;
  vendorId: string | null;
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[assignVendorToBoqItem]';
  console.log(`${op} Starting: item=${input.boqItemId}, vendor=${input.vendorId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get vendor name for display
  let vendorName: string | null = null;
  if (input.vendorId) {
    const { data: vendor } = await supabase
      .from('vendors')
      .select('company_name')
      .eq('id', input.vendorId)
      .single();
    vendorName = vendor?.company_name ?? null;
  }

  const { error } = await supabase
    .from('project_boq_items')
    .update({
      vendor_id: input.vendorId,
      vendor_name: vendorName,
    } as any)
    .eq('id', input.boqItemId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/procurement/project/${input.projectId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Bulk Assign Vendor to multiple BOQ Items
// ---------------------------------------------------------------------------

export async function bulkAssignVendor(input: {
  boqItemIds: string[];
  vendorId: string;
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkAssignVendor]';
  console.log(`${op} Starting: ${input.boqItemIds.length} items, vendor=${input.vendorId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: vendor } = await supabase
    .from('vendors')
    .select('company_name')
    .eq('id', input.vendorId)
    .single();

  const { error } = await supabase
    .from('project_boq_items')
    .update({
      vendor_id: input.vendorId,
      vendor_name: vendor?.company_name ?? null,
    } as any)
    .in('id', input.boqItemIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/procurement/project/${input.projectId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Create POs from Vendor-Assigned BOQ Items (auto-group by vendor)
// ---------------------------------------------------------------------------

export async function createPOsFromAssignedItems(input: {
  projectId: string;
  boqItemIds: string[];
}): Promise<{ success: boolean; error?: string; poCount?: number }> {
  const op = '[createPOsFromAssignedItems]';
  console.log(`${op} Starting for project: ${input.projectId}, items: ${input.boqItemIds.length}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Founders can auto-approve their own quick POs; everyone else routes through
  // pending_approval → approvePO. This mirrors generatePOsFromAwards.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isFounder = profile?.role === 'founder';
  const approvalStatus = isFounder ? 'approved' : 'pending_approval';
  const requiresApproval = !isFounder;

  // Fetch the selected BOQ items with vendor assignments
  const { data: boqItems, error: fetchError } = await supabase
    .from('project_boq_items')
    .select('id, item_category, item_description, brand, model, hsn_code, quantity, unit, unit_price, gst_rate, total_price, vendor_id, vendor_name')
    .in('id', input.boqItemIds)
    .not('vendor_id', 'is', null);

  if (fetchError) {
    console.error(`${op} Fetch failed:`, { code: fetchError.code, message: fetchError.message });
    return { success: false, error: fetchError.message };
  }

  if (!boqItems || boqItems.length === 0) {
    return { success: false, error: 'No items with vendor assignments found' };
  }

  // Group by vendor
  const vendorGroups: Record<string, typeof boqItems> = {};
  for (const item of boqItems) {
    const vid = (item as any).vendor_id as string;
    if (!vendorGroups[vid]) vendorGroups[vid] = [];
    vendorGroups[vid].push(item);
  }

  let poCount = 0;

  // Create one PO per vendor
  for (const [vendorId, items] of Object.entries(vendorGroups)) {
    // Generate PO number
    const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'PO' });
    const poNumber = docNum || `SHIROI/PO/${new Date().getFullYear()}/TEMP`;

    // Calculate totals
    let subtotal = 0;
    let gstTotal = 0;
    for (const item of items) {
      const qty = Number(item.quantity || 0);
      const rate = Number(item.unit_price || 0);
      const gstRate = Number(item.gst_rate || 18);
      const lineTotal = qty * rate;
      const lineGst = lineTotal * (gstRate / 100);
      subtotal += lineTotal;
      gstTotal += lineGst;
    }
    const totalAmount = subtotal + gstTotal;

    // Insert PO
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        project_id: input.projectId,
        vendor_id: vendorId,
        prepared_by: employee.id,
        po_number: poNumber,
        status: 'draft',
        approval_status: approvalStatus,
        requires_approval: requiresApproval,
        po_date: new Date().toISOString().slice(0, 10),
        subtotal,
        gst_amount: gstTotal,
        total_amount: totalAmount,
        amount_paid: 0,
        amount_outstanding: totalAmount,
      })
      .select('id')
      .single();

    if (poError) {
      console.error(`${op} PO insert failed for vendor ${vendorId}:`, poError.message);
      continue;
    }

    // Insert PO line items
    const lineItemRows = items.map((item, idx) => {
      const qty = Number(item.quantity || 0);
      const rate = Number(item.unit_price || 0);
      const gstRate = Number(item.gst_rate || 18);
      const lineTotal = qty * rate;
      const lineGst = lineTotal * (gstRate / 100);
      return {
        purchase_order_id: po.id,
        line_number: idx + 1,
        item_category: item.item_category,
        item_description: item.item_description,
        brand: item.brand || null,
        hsn_code: (item as any).hsn_code || null,
        unit: item.unit,
        quantity_ordered: qty,
        quantity_pending: qty,
        unit_price: rate,
        total_price: lineTotal + lineGst,
        gst_rate: gstRate,
        gst_amount: lineGst,
        boq_item_id: item.id,
      };
    });

    await supabase.from('purchase_order_items').insert(lineItemRows);

    // Link BOQ items to the PO. The procurement_status flip (yet_to_place →
    // order_placed) is handled by fn_cascade_po_approval_to_boq when the PO is
    // approved — whether that happens immediately (founder path below) or later
    // via approvePO (non-founder path).
    const boqIds = items.map((i) => i.id);
    await supabase
      .from('project_boq_items')
      .update({ purchase_order_id: po.id } as any)
      .in('id', boqIds);

    // Founder quick-POs are already approved — cascade the BOQ flip now.
    if (!requiresApproval) {
      const { error: cascadeErr } = await supabase.rpc(
        'fn_cascade_po_approval_to_boq',
        { p_po_id: po.id },
      );
      if (cascadeErr) {
        console.error(`${op} cascade failed (non-fatal)`, {
          poId: po.id,
          code: cascadeErr.code,
          message: cascadeErr.message,
        });
      }
    }

    poCount++;
  }

  // Update project procurement status
  if (poCount > 0) {
    // Check if all items now have POs
    const { data: remainingItems } = await supabase
      .from('project_boq_items')
      .select('id')
      .eq('project_id', input.projectId)
      .eq('procurement_status', 'yet_to_place')
      .limit(1);

    const allOrdered = !remainingItems || remainingItems.length === 0;
    await supabase
      .from('projects')
      .update({
        procurement_status: allOrdered ? 'order_placed' : 'yet_to_place',
      } as any)
      .eq('id', input.projectId);
  }

  revalidatePath('/procurement');
  revalidatePath(`/procurement/project/${input.projectId}`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, poCount };
}

// ---------------------------------------------------------------------------
// Update Procurement Priority
// ---------------------------------------------------------------------------

export async function updateProcurementPriority(input: {
  projectId: string;
  priority: 'high' | 'medium';
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateProcurementPriority]';

  const supabase = await createClient();
  const { error } = await supabase
    .from('projects')
    .update({ procurement_priority: input.priority } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/procurement');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Mark Items as Received
// ---------------------------------------------------------------------------

export async function markItemsReceived(input: {
  boqItemIds: string[];
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[markItemsReceived]';
  console.log(`${op} Starting: ${input.boqItemIds.length} items`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: 'received' } as any)
    .in('id', input.boqItemIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Check if ALL ordered items for this project are received
  const { data: pendingItems } = await supabase
    .from('project_boq_items')
    .select('id')
    .eq('project_id', input.projectId)
    .in('procurement_status', ['yet_to_place', 'order_placed'])
    .limit(1);

  const allReceived = !pendingItems || pendingItems.length === 0;

  if (allReceived) {
    await supabase
      .from('projects')
      .update({
        procurement_status: 'received',
        procurement_received_date: new Date().toISOString().slice(0, 10),
      } as any)
      .eq('id', input.projectId);

    // ── Best-effort: notify the project's project_manager_id ─────────────
    // Spec §7 event 6 — "all materials received, ready to dispatch".
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, customer_name, project_manager_id')
        .eq('id', input.projectId)
        .single();

      if (project?.project_manager_id) {
        const notif = {
          recipient_employee_id: project.project_manager_id,
          notification_type: 'procurement',
          title: `${project.project_number} — all materials received`,
          body: `All BOQ items for ${project.customer_name ?? 'project'} have been received. Ready to dispatch.`,
          entity_type: 'project',
          entity_id: input.projectId,
        };
        await supabase.from('notifications').insert(notif);
      }
    } catch (notifErr) {
      console.error(`${op} notification failed (non-fatal)`, {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }
  } else {
    await supabase
      .from('projects')
      .update({ procurement_status: 'partially_received' } as any)
      .eq('id', input.projectId);
  }

  revalidatePath('/procurement');
  revalidatePath(`/procurement/project/${input.projectId}`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Mark Items Ready to Dispatch (after receipt verification)
// ---------------------------------------------------------------------------

export async function markItemsReadyToDispatch(input: {
  boqItemIds: string[];
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[markItemsReadyToDispatch]';
  console.log(`${op} Starting: ${input.boqItemIds.length} items`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: 'ready_to_dispatch' } as any)
    .in('id', input.boqItemIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/procurement/project/${input.projectId}`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Ad-hoc Vendor Creation
//
// Called from the RFQ "Add new vendor" inline dialog when the Purchase Engineer
// discovers a vendor mid-RFQ and doesn't want to context-switch to /vendors.
// Deliberately minimal — company_name + contact_person + phone + email — rest
// is filled in later from the vendors page when the vendor matures into a
// recurring supplier.
// ---------------------------------------------------------------------------

export async function createVendorAdHoc(input: {
  companyName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  projectId: string; // for revalidation only
}): Promise<{ success: boolean; error?: string; vendorId?: string }> {
  const op = '[createVendorAdHoc]';
  console.log(`${op} Starting: ${input.companyName}`);

  if (!input.companyName.trim()) {
    return { success: false, error: 'Company name is required' };
  }
  if (!input.phone?.trim() && !input.email?.trim()) {
    return { success: false, error: 'Provide at least a phone or email for the vendor' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Generate a short human-friendly vendor_code (DB has unique constraint).
  // SHIROI/VEN/{YEAR}/{6-rand-alphanum}. Uniqueness collision risk is negligible
  // but we tolerate the insert error and surface it cleanly.
  const randSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const vendorCode = `SHIROI/VEN/${new Date().getFullYear()}/${randSuffix}`;

  const insert: Database['public']['Tables']['vendors']['Insert'] = {
    company_name: input.companyName.trim(),
    vendor_code: vendorCode,
    contact_person: input.contactPerson?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    vendor_type: 'other',
    is_active: true,
    is_msme: false,
    is_blacklisted: false,
    is_preferred: false,
    payment_terms_days: 30,
  };

  const { data, error } = await supabase
    .from('vendors')
    .insert(insert)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/procurement/project/${input.projectId}`);
  revalidatePath('/vendors');
  return { success: true, vendorId: data.id };
}

// ---------------------------------------------------------------------------
// Update BOQ Item Qty + Rate (inline edit in Tab 1)
// ---------------------------------------------------------------------------

export async function updateBoqItemQtyRate(input: {
  boqItemId: string;
  quantity: number;
  unitPrice: number;
}): Promise<ActionResult<{ totalPrice: number }>> {
  const op = '[updateBoqItemQtyRate]';
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Role gate
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const role = profile?.role;
    if (!role || !['founder', 'project_manager', 'purchase_officer'].includes(role)) {
      return err('Not authorised to edit BOQ');
    }

    // Validate inputs
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) return err('Quantity must be > 0');
    if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) return err('Rate must be ≥ 0');

    // Read current for audit + state guard
    const { data: current, error: readErr } = await supabase
      .from('project_boq_items')
      .select('id, project_id, quantity, unit_price, total_price, procurement_status, gst_rate')
      .eq('id', input.boqItemId)
      .maybeSingle();
    if (readErr) return err(readErr.message, readErr.code);
    if (!current) return err('BOQ item not found');
    if (current.procurement_status !== 'yet_to_place') {
      return err(`Cannot edit — item is already ${String(current.procurement_status).replace(/_/g, ' ')}`);
    }

    // Compute new total (GST-inclusive: qty × rate × (1 + gst/100))
    const newSubtotal = input.quantity * input.unitPrice;
    const gstRate = Number(current.gst_rate ?? 0);
    const newTotal = newSubtotal * (1 + gstRate / 100);

    const { error: updErr } = await supabase
      .from('project_boq_items')
      .update({
        quantity: input.quantity,
        unit_price: input.unitPrice,
        total_price: newTotal,
      })
      .eq('id', input.boqItemId);
    if (updErr) return err(updErr.message, updErr.code);

    await logProcurementAudit(supabase, {
      entityType: 'boq_item',
      entityId: input.boqItemId,
      action: 'qty_rate_edited',
      actorId: user.id,
      oldValue: {
        quantity: current.quantity,
        unit_price: current.unit_price,
        total_price: current.total_price,
      },
      newValue: {
        quantity: input.quantity,
        unit_price: input.unitPrice,
        total_price: newTotal,
      },
    });

    revalidatePath(`/procurement/project/${current.project_id}`);
    return ok({ totalPrice: newTotal });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// Vendor typeahead search (Tab 2) — server action so client components can call it
// ---------------------------------------------------------------------------

export async function searchVendors(q: string, limit = 10): Promise<VendorSearchResult[]> {
  const op = '[searchVendors]';
  try {
    const supabase = await createClient();
    const query = q.trim().replace(/[%,()]/g, '');
    if (query.length < 2) return [];
    const { data, error } = await supabase
      .from('vendors')
      .select('id, company_name, contact_person, phone, email')
      .or(`company_name.ilike.%${query}%,contact_person.ilike.%${query}%`)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('company_name')
      .limit(limit);
    if (error) {
      console.error(`${op}`, { code: error.code, message: error.message });
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.error(`${op} threw`, e);
    return [];
  }
}
