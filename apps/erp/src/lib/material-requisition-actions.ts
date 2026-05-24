'use server';

/**
 * Material Requisition server actions.
 *
 * Flow:
 *   site_supervisor / PM submit → PM/purchase_officer review → approve/reject
 *   → PM optionally converts an approved req to a quick PO
 *
 * All actions return ActionResult<T> per NEVER-DO rule #19.
 */

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type MatReqInsert = Database['public']['Tables']['material_requisitions']['Insert'];
type MatReqUpdate = Database['public']['Tables']['material_requisitions']['Update'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

export interface RequisitionLineItem {
  description: string;
  quantity: number;
  unit: string;
  notes?: string;
}

// ============================================================
// submitMaterialRequisition
// ============================================================

export async function submitMaterialRequisition(input: {
  projectId: string;
  items: RequisitionLineItem[];
  urgency: 'normal' | 'urgent' | 'critical';
  notes?: string;
}): Promise<ActionResult<{ id: string }>> {
  const op = '[submitMaterialRequisition]';
  console.log(`${op} Starting`, { projectId: input.projectId, items: input.items.length });

  try {
    if (!input.items.length) return err('At least one item is required');

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Resolve employee
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (empError) {
      console.error(`${op} employee lookup failed`, { code: empError.code, message: empError.message });
      return err('Employee profile not found');
    }
    if (!employee) return err('Employee profile not found — contact admin');

    // Role gate — site_supervisor and above can submit
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const role = profile?.role;
    if (!role || !['founder', 'project_manager', 'purchase_officer', 'site_supervisor'].includes(role)) {
      return err('Not authorised to submit material requisitions');
    }

    const insert: MatReqInsert = {
      project_id: input.projectId,
      requested_by: employee.id,
      urgency: input.urgency,
      items: input.items as unknown as MatReqInsert['items'],
      notes: input.notes?.trim() || null,
    };

    const { data: req, error: insertError } = await supabase
      .from('material_requisitions')
      .insert(insert)
      .select('id')
      .single();

    if (insertError || !req) {
      console.error(`${op} Insert failed`, { code: insertError?.code, message: insertError?.message });
      return err(insertError?.message ?? 'Insert failed');
    }

    // Notify PMs + purchase officers — fire and forget
    try {
      const { data: pmProfiles } = await supabase
        .from('profiles')
        .select('id')
        .in('role', ['project_manager', 'purchase_officer']);

      if (pmProfiles && pmProfiles.length > 0) {
        const pmIds = pmProfiles.map((p) => p.id);
        const { data: pmEmployees } = await supabase
          .from('employees')
          .select('id')
          .in('profile_id', pmIds)
          .eq('is_active', true);

        if (pmEmployees && pmEmployees.length > 0) {
          const urgencyLabel = input.urgency === 'critical' ? 'CRITICAL' : input.urgency === 'urgent' ? 'Urgent' : 'Normal';
          const notifs: NotificationInsert[] = pmEmployees.map((emp) => ({
            recipient_employee_id: emp.id,
            notification_type: 'approval_required',
            title: `[${urgencyLabel}] New material request — ${input.items.length} item(s)`,
            body: `A material request has been submitted for your review.`,
            // entity_type omitted: 'material_requisition' isn't in the CHECK constraint
            // (mig 014). The requisition id is preserved in entity_id for deep-linking.
            entity_id: req.id,
          }));
          const { error: notifErr } = await supabase.from('notifications').insert(notifs);
          if (notifErr) {
            console.error(`${op} notifications failed (non-fatal)`, { code: notifErr.code, message: notifErr.message });
          }
        }
      }
    } catch (notifErr) {
      console.error(`${op} notification block threw (non-fatal)`, {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }

    revalidatePath(`/procurement/project/${input.projectId}`);
    revalidatePath('/procurement');
    return ok({ id: req.id });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ============================================================
// reviewMaterialRequisition — approve or reject
// ============================================================

export async function reviewMaterialRequisition(input: {
  requisitionId: string;
  action: 'approve' | 'reject';
  reviewNotes?: string;
}): Promise<ActionResult<void>> {
  const op = '[reviewMaterialRequisition]';
  console.log(`${op} Starting`, { requisitionId: input.requisitionId, action: input.action });

  try {
    if (input.action === 'reject' && !input.reviewNotes?.trim()) {
      return err('Review notes required when rejecting');
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Role gate — PM, purchase_officer, founder only
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const role = profile?.role;
    if (!role || !['founder', 'project_manager', 'purchase_officer'].includes(role)) {
      return err('Not authorised to review material requisitions');
    }

    // Resolve reviewer employee
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    // Verify current status is pending
    const { data: req, error: fetchErr } = await supabase
      .from('material_requisitions')
      .select('id, status, project_id, requested_by')
      .eq('id', input.requisitionId)
      .maybeSingle();

    if (fetchErr) {
      console.error(`${op} fetch failed`, { code: fetchErr.code, message: fetchErr.message });
      return err(fetchErr.message, fetchErr.code);
    }
    if (!req) return err('Requisition not found');
    if (req.status !== 'pending') {
      return err(`Requisition is already ${req.status} — cannot re-review`);
    }

    // Block self-review: requester cannot approve/reject their own requisition.
    // Founder is exempt (founders can override and approve in a pinch).
    if (employee?.id && req.requested_by === employee.id && role !== 'founder') {
      return err('You cannot review your own material requisition');
    }

    const newStatus = input.action === 'approve' ? 'approved' : 'rejected';
    const update: MatReqUpdate = {
      status: newStatus,
      reviewer_id: employee?.id ?? null,
      reviewed_at: new Date().toISOString(),
      review_notes: input.reviewNotes?.trim() || null,
    };

    const { error: updateErr } = await supabase
      .from('material_requisitions')
      .update(update)
      .eq('id', input.requisitionId);

    if (updateErr) {
      console.error(`${op} update failed`, { code: updateErr.code, message: updateErr.message });
      return err(updateErr.message, updateErr.code);
    }

    // Notify the requester (best-effort)
    try {
      const notif: NotificationInsert = {
        recipient_employee_id: req.requested_by,
        notification_type: 'info',
        title: `Material request ${newStatus}`,
        // entity_type stripped: 'material_requisition' is not in the CHECK
        // constraint (mig 014). The requisition id is preserved as entity_id.
        body: input.reviewNotes?.trim()
          ? `Your material request has been ${newStatus}. Note: ${input.reviewNotes.trim()}`
          : `Your material request has been ${newStatus}.`,
        entity_id: input.requisitionId,
      };
      await supabase.from('notifications').insert(notif);
    } catch (notifErr) {
      console.error(`${op} notification failed (non-fatal)`, {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }

    revalidatePath(`/procurement/project/${req.project_id}`);
    revalidatePath('/procurement');
    revalidatePath('/procurement/requisitions');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ============================================================
// convertRequisitionToPO
//
// Creates a quick PO from an approved requisition. The PO is
// seeded with the requisition's items using the price book rate
// where available (falls back to 0 so the PM can fill in the rate).
// ============================================================

export async function convertRequisitionToPO(input: {
  requisitionId: string;
  vendorId: string;
  paymentTermsDays?: number;
  expectedDeliveryDate?: string;
  notes?: string;
}): Promise<ActionResult<{ poId: string }>> {
  const op = '[convertRequisitionToPO]';
  console.log(`${op} Starting`, { requisitionId: input.requisitionId, vendorId: input.vendorId });

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
      return err('Not authorised to convert requisitions to POs');
    }

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (empErr || !employee) {
      console.error(`${op} employee not found`, { userId: user.id, error: empErr?.message });
      return err('Employee record not found — cannot create PO');
    }

    // Load requisition
    const { data: req, error: reqErr } = await supabase
      .from('material_requisitions')
      .select('id, project_id, status, items')
      .eq('id', input.requisitionId)
      .maybeSingle();

    if (reqErr) {
      console.error(`${op} req fetch failed`, { code: reqErr.code, message: reqErr.message });
      return err(reqErr.message, reqErr.code);
    }
    if (!req) return err('Requisition not found');
    if (req.status !== 'approved') {
      return err(`Requisition must be approved before converting (current: ${req.status})`);
    }

    const items = (req.items as unknown) as RequisitionLineItem[];
    if (!Array.isArray(items) || !items.length) return err('Requisition has no items');

    const isFounder = role === 'founder';
    const approvalStatus = isFounder ? 'approved' : 'pending_approval';
    const requiresApproval = !isFounder;

    // Generate PO number
    const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'PO' });
    const poNumber = (docNum as string | null) ?? `SHIROI/PO/${new Date().getFullYear()}/TEMP`;

    // All rates start at 0 — PM fills them in on the PO detail page
    const totalAmount = 0;

    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        project_id: req.project_id,
        vendor_id: input.vendorId,
        prepared_by: employee.id,
        po_number: poNumber,
        status: 'draft',
        approval_status: approvalStatus,
        requires_approval: requiresApproval,
        po_date: new Date().toISOString().slice(0, 10),
        expected_delivery_date: input.expectedDeliveryDate || null,
        payment_terms_days: input.paymentTermsDays ?? 30,
        subtotal: totalAmount,
        gst_amount: totalAmount,
        total_amount: totalAmount,
        amount_paid: 0,
        amount_outstanding: totalAmount,
        notes: input.notes?.trim() || `Converted from material requisition`,
      })
      .select('id')
      .single();

    if (poErr || !po) {
      console.error(`${op} PO insert failed`, { code: poErr?.code, message: poErr?.message });
      return err(poErr?.message ?? 'PO creation failed');
    }

    // Insert line items with zero rates (PM edits inline)
    const lineRows = items.map((item, idx) => ({
      purchase_order_id: po.id,
      line_number: idx + 1,
      item_description: item.description,
      item_category: 'other',
      unit: item.unit || 'nos',
      quantity_ordered: item.quantity,
      quantity_pending: item.quantity,
      unit_price: 0,
      gst_rate: 18,
      gst_amount: 0,
      total_price: 0,
    }));

    await supabase.from('purchase_order_items').insert(lineRows);

    // Mark requisition as converted
    await supabase
      .from('material_requisitions')
      .update({ status: 'converted', converted_po_id: po.id } satisfies MatReqUpdate)
      .eq('id', input.requisitionId);

    // Notify founders for approval (if non-founder created it)
    if (requiresApproval) {
      try {
        const { data: founderProfiles } = await supabase
          .from('profiles')
          .select('id')
          .eq('role', 'founder');

        if (founderProfiles && founderProfiles.length > 0) {
          const { data: founderEmps } = await supabase
            .from('employees')
            .select('id')
            .in('profile_id', founderProfiles.map((p) => p.id));

          if (founderEmps && founderEmps.length > 0) {
            const notifs: NotificationInsert[] = founderEmps.map((emp) => ({
              recipient_employee_id: emp.id,
              notification_type: 'approval_required',
              title: `PO ${poNumber} requires approval`,
              body: `A PO created from a site material request requires your approval.`,
              entity_type: 'purchase_order',
              entity_id: po.id,
            }));
            await supabase.from('notifications').insert(notifs);
          }
        }
      } catch (notifErr) {
        console.error(`${op} notification failed (non-fatal)`, {
          error: notifErr instanceof Error ? notifErr.message : String(notifErr),
        });
      }
    }

    revalidatePath(`/procurement/project/${req.project_id}`);
    revalidatePath(`/procurement/${po.id}`);
    revalidatePath('/procurement');
    revalidatePath('/procurement/requisitions');
    return ok({ poId: po.id });
  } catch (e) {
    console.error(`${op} threw`, e);
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
