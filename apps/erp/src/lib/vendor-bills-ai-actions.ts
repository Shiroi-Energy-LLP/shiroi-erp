'use server';

/**
 * vendor-bills-ai-actions.ts — D3 / S17
 *
 * Server actions for the AI extraction review gate.
 * Roles: founder + finance only (maps to the 'finance' AppRole).
 *
 * NEVER-DO compliance:
 * - #19: never throw — return ActionResult<T>
 * - #15: no inline Supabase in pages/components
 * - #5: money never aggregated in JS; no arithmetic on amounts here
 * - #3: no `any` — types from @repo/types/database
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { emitErpEvent, type ErpEventName } from '@/lib/n8n/emit';

// ─── Role gate ────────────────────────────────────────────────────────────────

const REVIEWER_ROLES = new Set(['founder', 'finance']);

async function getCurrentUserAndRole(): Promise<{ userId: string; role: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  return { userId: user.id, role: profile.role as string };
}

// ─── Shared bill loader ────────────────────────────────────────────────────────

async function loadBill(billId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('vendor_bills')
    .select('id, ai_status, total_amount, bill_number, vendor_id')
    .eq('id', billId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * approveAiVendorBill
 *
 * Flips ai_status → 'approved' and status → 'pending_approval'.
 * Emits 'vendor.bill_ai_approved' event.
 * Roles: founder, finance.
 */
export async function approveAiVendorBill(billId: string): Promise<ActionResult<void>> {
  const op = '[approveAiVendorBill]';

  const actor = await getCurrentUserAndRole();
  if (!actor) return err('Not authenticated');
  if (!REVIEWER_ROLES.has(actor.role)) {
    return err('Insufficient permissions — founder or finance required');
  }

  try {
    const bill = await loadBill(billId);
    if (!bill) return err('Bill not found');

    if (bill.ai_status !== 'pending_review') {
      return err(`Bill is not pending review (current ai_status: ${bill.ai_status ?? 'null'})`);
    }

    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from('vendor_bills')
      .update({
        ai_status: 'approved',
        status: 'pending',
      })
      .eq('id', billId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        billId,
        error: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    // Fire-and-forget event (never blocks or throws)
    const APPROVED_EVENT: ErpEventName = 'vendor.bill_ai_approved';
    void emitErpEvent(APPROVED_EVENT, {
      bill_id: billId,
      bill_number: bill.bill_number,
      total_amount: bill.total_amount,
      vendor_id: bill.vendor_id,
      approved_by: actor.userId,
    });

    revalidatePath(`/vendor-bills/${billId}`, 'page');
    revalidatePath('/vendor-bills/review', 'page');

    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { billId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/**
 * rejectAiVendorBill
 *
 * Flips ai_status → 'rejected' and soft-deletes the bill (deleted_at = NOW()).
 * Emits 'vendor.bill_ai_rejected' event.
 * Roles: founder, finance.
 */
export async function rejectAiVendorBill(
  billId: string,
  reason: string,
): Promise<ActionResult<void>> {
  const op = '[rejectAiVendorBill]';

  const actor = await getCurrentUserAndRole();
  if (!actor) return err('Not authenticated');
  if (!REVIEWER_ROLES.has(actor.role)) {
    return err('Insufficient permissions — founder or finance required');
  }

  if (!reason.trim()) {
    return err('Rejection reason is required');
  }

  try {
    const bill = await loadBill(billId);
    if (!bill) return err('Bill not found');

    if (bill.ai_status !== 'pending_review') {
      return err(`Bill is not pending review (current ai_status: ${bill.ai_status ?? 'null'})`);
    }

    const now = new Date().toISOString();
    const admin = createAdminClient();
    // vendor_bills has no deleted_at column — set status='cancelled' for rejected AI drafts.
    // The notes field captures the reason for audit purposes.
    const { error: updateErr } = await admin
      .from('vendor_bills')
      .update({
        ai_status: 'rejected',
        status: 'cancelled',
        notes: `[AI Rejection — ${now}] ${reason}`,
      })
      .eq('id', billId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        billId,
        error: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    const REJECTED_EVENT: ErpEventName = 'vendor.bill_ai_rejected';
    void emitErpEvent(REJECTED_EVENT, {
      bill_id: billId,
      bill_number: bill.bill_number,
      total_amount: bill.total_amount,
      vendor_id: bill.vendor_id,
      rejected_by: actor.userId,
      reason,
    });

    revalidatePath(`/vendor-bills/${billId}`, 'page');
    revalidatePath('/vendor-bills/review', 'page');

    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { billId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/**
 * updateAiVendorBillFields
 *
 * Partially updates an AI-extracted bill's key fields.
 * Re-validates that total >= 0. Does NOT re-run AI extraction.
 * Roles: founder, finance.
 */
export interface AiVendorBillFieldPatch {
  vendor_id?: string;
  bill_number?: string;
  bill_date?: string;
  due_date?: string | null;
  subtotal?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  total_amount?: number;
  notes?: string | null;
}

export async function updateAiVendorBillFields(
  billId: string,
  fields: AiVendorBillFieldPatch,
): Promise<ActionResult<void>> {
  const op = '[updateAiVendorBillFields]';

  const actor = await getCurrentUserAndRole();
  if (!actor) return err('Not authenticated');
  if (!REVIEWER_ROLES.has(actor.role)) {
    return err('Insufficient permissions — founder or finance required');
  }

  // Validate total_amount if provided
  if (fields.total_amount !== undefined && fields.total_amount < 0) {
    return err('total_amount cannot be negative');
  }

  try {
    const bill = await loadBill(billId);
    if (!bill) return err('Bill not found');

    if (bill.ai_status === 'rejected') {
      return err('Cannot edit a rejected bill');
    }

    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from('vendor_bills')
      .update(fields)
      .eq('id', billId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        billId,
        fields: Object.keys(fields),
        error: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    revalidatePath(`/vendor-bills/${billId}`, 'page');

    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { billId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
