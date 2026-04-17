'use server';

/**
 * Purchase Order server actions.
 *
 * Legacy helpers (line-rate edit, soft-delete) plus the PO lifecycle actions
 * added in Phase 5/6 of purchase module v2:
 *
 *   draft ─▶ pending_approval ─▶ approved ─▶ dispatched ─▶ vendor shipped ─▶ acknowledged
 *            (sendPOForApproval) (approvePO) (markPODispatched) (recordVendorDispatch) (markPOAcknowledged)
 *
 * Reject path: pending_approval ─▶ rejected (rejectPO).
 *
 * The founder is the sole approver. Anyone else creating a PO implicitly lands
 * in `pending_approval`. All lifecycle actions return `ActionResult<T>` per
 * NEVER-DO rule #19 — they never throw.
 */

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { logProcurementAudit } from '@/lib/procurement-audit';
import type { Database } from '@repo/types/database';

type PurchaseOrderUpdate = Database['public']['Tables']['purchase_orders']['Update'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

export async function updatePoLineItemRate(input: {
  poId: string;
  itemId: string;
  newRate: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updatePoLineItemRate]';
  console.log(`${op} Updating rate for PO item ${input.itemId} to ${input.newRate}`);

  const supabase = await createClient();

  // Fetch current item to get quantity_ordered and gst_rate
  const { data: item, error: fetchErr } = await supabase
    .from('purchase_order_items')
    .select('quantity_ordered, gst_rate')
    .eq('id', input.itemId)
    .single();

  if (fetchErr || !item) {
    console.error(`${op} Item fetch failed:`, fetchErr);
    return { success: false, error: 'Item not found' };
  }

  const qty = Number(item.quantity_ordered);
  const totalPrice = input.newRate * qty;
  const gstRate = Number(item.gst_rate ?? 18);
  const gstAmount = totalPrice * (gstRate / 100);

  // Update item
  const { error: updateErr } = await supabase
    .from('purchase_order_items')
    .update({
      unit_price: input.newRate,
      total_price: totalPrice,
      gst_amount: gstAmount,
    })
    .eq('id', input.itemId);

  if (updateErr) {
    console.error(`${op} Update failed:`, { code: updateErr.code, message: updateErr.message });
    return { success: false, error: updateErr.message };
  }

  // Recalculate PO totals from all items
  const { data: allItems } = await supabase
    .from('purchase_order_items')
    .select('total_price, gst_amount')
    .eq('purchase_order_id', input.poId);

  const subtotal = (allItems ?? []).reduce((sum, i) => sum + Number(i.total_price ?? 0), 0);
  const totalGst = (allItems ?? []).reduce((sum, i) => sum + Number(i.gst_amount ?? 0), 0);
  const totalAmount = subtotal + totalGst;

  const { error: poUpdateErr } = await supabase
    .from('purchase_orders')
    .update({
      subtotal,
      gst_amount: totalGst,
      total_amount: totalAmount,
    })
    .eq('id', input.poId);

  if (poUpdateErr) {
    console.error(`${op} PO total recalculation failed:`, { code: poUpdateErr.code, message: poUpdateErr.message });
    // Non-fatal — item was already updated; return success with a note
  }

  revalidatePath(`/procurement/${input.poId}`);
  return { success: true };
}

// Note: purchase_orders has no deleted_at column.
// Soft delete is implemented by setting status to 'cancelled'.
export async function deletePoSoft(poId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deletePoSoft]';
  console.log(`${op} Soft-deleting PO ${poId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled' })
    .eq('id', poId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/procurement');
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════════
// Internal helpers for the lifecycle actions below
// ═══════════════════════════════════════════════════════════════════════

/** Return all active founder employee ids (used for approval notifications). */
async function getFounderEmployeeIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  type ProfileRow = { id: string };
  const { data: profs } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'founder')
    .returns<ProfileRow[]>();
  if (!profs || profs.length === 0) return [];

  type EmpRow = { id: string };
  const { data: emps } = await supabase
    .from('employees')
    .select('id')
    .in('profile_id', profs.map((p) => p.id))
    .returns<EmpRow[]>();
  return (emps ?? []).map((e) => e.id);
}

/** Caller must be founder — returns error if not. */
async function requireFounder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (!profile || profile.role !== 'founder') {
    return { ok: false, error: 'Only the founder can approve or reject POs' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════
// sendPOForApproval — Purchase Engineer pushes a draft PO to the founder
// ═══════════════════════════════════════════════════════════════════════

export async function sendPOForApproval(poId: string): Promise<ActionResult<void>> {
  const op = '[sendPOForApproval]';
  console.log(`${op} Starting`, { poId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, approval_status, po_number, total_amount, project_id')
      .eq('id', poId)
      .maybeSingle();

    if (poError) {
      console.error(`${op} PO fetch failed`, { poId, code: poError.code, message: poError.message });
      return err(poError.message, poError.code);
    }
    if (!po) return err('PO not found');
    if (po.approval_status !== 'draft' && po.approval_status !== 'rejected') {
      return err(`PO is already ${po.approval_status.replace('_', ' ')} — cannot re-send for approval`);
    }

    const update: PurchaseOrderUpdate = {
      approval_status: 'pending_approval',
      requires_approval: true,
    };

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', poId);

    if (updateError) {
      console.error(`${op} update failed`, { poId, code: updateError.code, message: updateError.message });
      return err(updateError.message, updateError.code);
    }

    // Notify founders.
    const founderEmployees = await getFounderEmployeeIds(supabase);
    if (founderEmployees.length > 0) {
      const notifs: NotificationInsert[] = founderEmployees.map((empId) => ({
        recipient_employee_id: empId,
        notification_type: 'po_pending_approval',
        title: `PO ${po.po_number} requires approval`,
        body: `A purchase order for ₹${Number(po.total_amount).toLocaleString('en-IN')} has been sent for your approval.`,
        entity_type: 'purchase_order',
        entity_id: poId,
      }));
      const { error: notifError } = await supabase.from('notifications').insert(notifs);
      if (notifError) {
        console.error(`${op} notifications insert failed`, { poId, code: notifError.code, message: notifError.message });
      }
    }

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: poId,
      action: 'sent_for_approval',
      actorId: user.id,
      oldValue: { approval_status: po.approval_status },
      newValue: { approval_status: 'pending_approval' },
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${poId}`);
    revalidatePath('/procurement');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { poId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// approvePO — founder greenlights a pending_approval PO
// ═══════════════════════════════════════════════════════════════════════

export async function approvePO(poId: string): Promise<ActionResult<void>> {
  const op = '[approvePO]';
  console.log(`${op} Starting`, { poId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const guard = await requireFounder(supabase, user.id);
    if (!guard.ok) return err(guard.error);

    // Resolve approver employee_id (founder may not have an employees row,
    // but the approved_by FK accepts null if missing).
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, approval_status, status, po_number, project_id, prepared_by')
      .eq('id', poId)
      .maybeSingle();

    if (poError) {
      console.error(`${op} PO fetch failed`, { poId, code: poError.code, message: poError.message });
      return err(poError.message, poError.code);
    }
    if (!po) return err('PO not found');
    if (po.approval_status !== 'pending_approval') {
      return err(`PO is ${po.approval_status.replace('_', ' ')} — cannot approve`);
    }

    const update: PurchaseOrderUpdate = {
      approval_status: 'approved',
      approved_by: employee?.id ?? null,
    };

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', poId);

    if (updateError) {
      console.error(`${op} update failed`, { poId, code: updateError.code, message: updateError.message });
      return err(updateError.message, updateError.code);
    }

    if (po.prepared_by) {
      const notif: NotificationInsert = {
        recipient_employee_id: po.prepared_by,
        notification_type: 'po_approved',
        title: `PO ${po.po_number} approved`,
        body: 'The founder approved your PO — you can now send it to the vendor.',
        entity_type: 'purchase_order',
        entity_id: poId,
      };
      const { error: notifError } = await supabase.from('notifications').insert(notif);
      if (notifError) {
        console.error(`${op} notification insert failed`, { poId, code: notifError.code, message: notifError.message });
      }
    }

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: poId,
      action: 'approved',
      actorId: user.id,
      oldValue: { approval_status: 'pending_approval' },
      newValue: { approval_status: 'approved' },
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${poId}`);
    revalidatePath('/procurement');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { poId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// rejectPO — founder sends a pending_approval PO back with a reason
// ═══════════════════════════════════════════════════════════════════════

export async function rejectPO(poId: string, reason: string): Promise<ActionResult<void>> {
  const op = '[rejectPO]';
  console.log(`${op} Starting`, { poId });

  try {
    if (!reason?.trim()) return err('Rejection reason is required');

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const guard = await requireFounder(supabase, user.id);
    if (!guard.ok) return err(guard.error);

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, approval_status, po_number, project_id, prepared_by')
      .eq('id', poId)
      .maybeSingle();

    if (poError) {
      console.error(`${op} PO fetch failed`, { poId, code: poError.code, message: poError.message });
      return err(poError.message, poError.code);
    }
    if (!po) return err('PO not found');
    if (po.approval_status !== 'pending_approval') {
      return err(`PO is ${po.approval_status.replace('_', ' ')} — cannot reject`);
    }

    const update: PurchaseOrderUpdate = {
      approval_status: 'rejected',
      approval_rejection_reason: reason.trim(),
    };

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', poId);

    if (updateError) {
      console.error(`${op} update failed`, { poId, code: updateError.code, message: updateError.message });
      return err(updateError.message, updateError.code);
    }

    if (po.prepared_by) {
      const notif: NotificationInsert = {
        recipient_employee_id: po.prepared_by,
        notification_type: 'po_rejected',
        title: `PO ${po.po_number} rejected`,
        body: `Reason: ${reason.trim()}`,
        entity_type: 'purchase_order',
        entity_id: poId,
      };
      const { error: notifError } = await supabase.from('notifications').insert(notif);
      if (notifError) {
        console.error(`${op} notification insert failed`, { poId, code: notifError.code, message: notifError.message });
      }
    }

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: poId,
      action: 'rejected',
      actorId: user.id,
      oldValue: { approval_status: 'pending_approval' },
      newValue: { approval_status: 'rejected' },
      reason: reason.trim(),
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${poId}`);
    revalidatePath('/procurement');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { poId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// markPODispatched — Purchase Engineer sent the PO to the vendor
//
// Phase 6 entry point. Flips PO status to 'dispatched' and stamps
// `dispatched_at`. This is the "PO is now in vendor's court" event — distinct
// from recordVendorDispatch which is "vendor has shipped goods to us".
// ═══════════════════════════════════════════════════════════════════════

export async function markPODispatched(poId: string): Promise<ActionResult<void>> {
  const op = '[markPODispatched]';
  console.log(`${op} Starting`, { poId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, approval_status, status, project_id')
      .eq('id', poId)
      .maybeSingle();

    if (poError) {
      console.error(`${op} PO fetch failed`, { poId, code: poError.code, message: poError.message });
      return err(poError.message, poError.code);
    }
    if (!po) return err('PO not found');
    if (po.approval_status !== 'approved') {
      return err('PO must be approved before it can be dispatched');
    }
    if (po.status !== 'draft') {
      return err(`PO is already ${po.status} — cannot re-dispatch`);
    }

    const update: PurchaseOrderUpdate = {
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', poId);

    if (updateError) {
      console.error(`${op} update failed`, { poId, code: updateError.code, message: updateError.message });
      return err(updateError.message, updateError.code);
    }

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: poId,
      action: 'dispatched_to_vendor',
      actorId: user.id,
      newValue: { status: 'dispatched', dispatched_at: update.dispatched_at },
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${poId}`);
    revalidatePath('/procurement');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { poId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// recordVendorDispatch — vendor shipped goods to Shiroi
// ═══════════════════════════════════════════════════════════════════════

export async function recordVendorDispatch(input: {
  poId: string;
  vendorDispatchDate: string;     // 'YYYY-MM-DD'
  vendorTrackingNumber?: string;
  expectedDeliveryDate?: string;  // 'YYYY-MM-DD' — optional ETA refresh
}): Promise<ActionResult<void>> {
  const op = '[recordVendorDispatch]';
  console.log(`${op} Starting`, { poId: input.poId });

  try {
    if (!input.vendorDispatchDate) return err('Vendor dispatch date is required');

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, status, project_id')
      .eq('id', input.poId)
      .maybeSingle();

    if (poError) {
      console.error(`${op} PO fetch failed`, { poId: input.poId, code: poError.code, message: poError.message });
      return err(poError.message, poError.code);
    }
    if (!po) return err('PO not found');
    if (po.status !== 'dispatched') {
      return err(`PO must be dispatched to vendor first (current: ${po.status})`);
    }

    const update: PurchaseOrderUpdate = {
      vendor_dispatch_date: input.vendorDispatchDate,
      vendor_tracking_number: input.vendorTrackingNumber?.trim() || null,
    };
    if (input.expectedDeliveryDate) {
      update.expected_delivery_date = input.expectedDeliveryDate;
    }

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', input.poId);

    if (updateError) {
      console.error(`${op} update failed`, { poId: input.poId, code: updateError.code, message: updateError.message });
      return err(updateError.message, updateError.code);
    }

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: input.poId,
      action: 'vendor_dispatched',
      actorId: user.id,
      newValue: {
        vendor_dispatch_date: input.vendorDispatchDate,
        vendor_tracking_number: input.vendorTrackingNumber ?? null,
        expected_delivery_date: input.expectedDeliveryDate ?? null,
      },
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${input.poId}`);
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { poId: input.poId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// markPOAcknowledged — Shiroi received the goods (closes the loop)
// ═══════════════════════════════════════════════════════════════════════

export async function markPOAcknowledged(input: {
  poId: string;
  actualDeliveryDate?: string; // 'YYYY-MM-DD' — defaults to today
}): Promise<ActionResult<void>> {
  const op = '[markPOAcknowledged]';
  console.log(`${op} Starting`, { poId: input.poId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, status, project_id')
      .eq('id', input.poId)
      .maybeSingle();

    if (poError) {
      console.error(`${op} PO fetch failed`, { poId: input.poId, code: poError.code, message: poError.message });
      return err(poError.message, poError.code);
    }
    if (!po) return err('PO not found');
    if (po.status === 'acknowledged') {
      return err('PO is already acknowledged');
    }
    if (po.status !== 'dispatched') {
      return err(`PO must be dispatched before it can be acknowledged (current: ${po.status})`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const update: PurchaseOrderUpdate = {
      status: 'acknowledged',
      acknowledged_at: new Date().toISOString(),
      actual_delivery_date: input.actualDeliveryDate ?? today,
    };

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', input.poId);

    if (updateError) {
      console.error(`${op} update failed`, { poId: input.poId, code: updateError.code, message: updateError.message });
      return err(updateError.message, updateError.code);
    }

    await logProcurementAudit(supabase, {
      entityType: 'purchase_order',
      entityId: input.poId,
      action: 'acknowledged',
      actorId: user.id,
      newValue: {
        status: 'acknowledged',
        actual_delivery_date: update.actual_delivery_date,
      },
    });

    revalidatePath(`/procurement/project/${po.project_id}`);
    revalidatePath(`/procurement/${input.poId}`);
    revalidatePath('/procurement');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { poId: input.poId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
