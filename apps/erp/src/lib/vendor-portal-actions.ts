'use server';

/**
 * Vendor Portal — public server actions.
 *
 * Security model:
 *   - Uses createAdminClient() because vendors are unauthenticated.
 *   - Every action re-validates the token from the DB as its FIRST step.
 *   - Never trusts any input that isn't re-checked against DB state
 *     (quote items, invitation status, etc.).
 */

import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { logProcurementAudit } from '@/lib/procurement-audit';
import { validateToken } from '@/lib/vendor-portal-queries';
import type { Database } from '@repo/types/database';

type RfqQuoteInsert = Database['public']['Tables']['rfq_quotes']['Insert'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

const VALID_PAYMENT_TERMS = [
  'advance',
  '30_days',
  '60_days',
  'against_delivery',
] as const;
type PaymentTerms = (typeof VALID_PAYMENT_TERMS)[number];

/**
 * Mark an invitation as viewed. No-op if the invitation has already been
 * submitted or isn't in a pending/sent state.
 */
export async function markInvitationViewed(
  token: string,
): Promise<ActionResult<void>> {
  const op = '[markInvitationViewed]';
  try {
    const v = await validateToken(token);
    if (!v.ok) {
      return err(
        v.reason === 'expired'
          ? 'This RFQ link has expired'
          : 'Invalid link',
      );
    }
    if (v.alreadySubmitted) {
      return ok(undefined as void);
    }

    const supabase = createAdminClient();

    // Only transition if status is in pending/sent — don't regress submitted
    const { error: updErr } = await supabase
      .from('rfq_invitations')
      .update({ status: 'viewed', viewed_at: new Date().toISOString() })
      .eq('id', v.invitationId)
      .in('status', ['pending', 'sent']);

    if (updErr) {
      console.error(`${op} update failed`, {
        invitationId: v.invitationId,
        error: updErr,
      });
      // Non-fatal — we don't want to block the vendor from viewing the page
      return ok(undefined as void);
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq_invitation',
      entityId: v.invitationId,
      action: 'viewed',
      actorId: null,
    });

    return ok(undefined as void);
  } catch (e) {
    console.error(`${op} threw`, {
      token,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Submit a vendor quote via the public portal.
 *
 * Validates token, checks payload invariants, then inserts rfq_quotes rows
 * and flips the invitation to 'submitted'. Fires a best-effort notification
 * to the RFQ creator.
 */
export async function submitQuoteFromVendor(input: {
  token: string;
  lineItems: Array<{ rfqItemId: string; unitPrice: number; gstRate: number }>;
  paymentTerms: string;
  deliveryPeriodDays: number;
  notes?: string;
}): Promise<ActionResult<void>> {
  const op = '[submitQuoteFromVendor]';
  try {
    const v = await validateToken(input.token);
    if (!v.ok) {
      return err(
        v.reason === 'expired'
          ? 'This RFQ link has expired'
          : 'Invalid link',
      );
    }
    if (v.alreadySubmitted) {
      return err('Quote already submitted for this invitation');
    }

    // ── Payload validation ──────────────────────────────────────────────
    if (!input.lineItems || input.lineItems.length === 0) {
      return err('At least one line item is required');
    }
    for (const li of input.lineItems) {
      if (
        !Number.isFinite(li.unitPrice) ||
        li.unitPrice <= 0
      ) {
        return err('All unit prices must be greater than 0');
      }
      if (
        !Number.isFinite(li.gstRate) ||
        li.gstRate < 0 ||
        li.gstRate > 28
      ) {
        return err('GST rate must be between 0 and 28');
      }
    }
    if (
      !Number.isFinite(input.deliveryPeriodDays) ||
      input.deliveryPeriodDays < 0
    ) {
      return err('Delivery period must be 0 or more days');
    }
    if (!VALID_PAYMENT_TERMS.includes(input.paymentTerms as PaymentTerms)) {
      return err('Invalid payment terms');
    }

    const supabase = createAdminClient();

    // ── Cross-check items belong to this RFQ ────────────────────────────
    const itemIds = input.lineItems.map((l) => l.rfqItemId);
    const { data: items, error: itemsErr } = await supabase
      .from('rfq_items')
      .select('id, quantity, rfq_id')
      .in('id', itemIds);

    if (itemsErr) {
      console.error(`${op} items query failed`, { itemIds, error: itemsErr });
      return err('Could not load RFQ items');
    }
    if (!items || items.length !== input.lineItems.length) {
      return err('Item mismatch');
    }
    // All items must belong to v.rfqId
    if (items.some((it) => it.rfq_id !== v.rfqId)) {
      return err('Item mismatch');
    }

    const qtyById = new Map(items.map((it) => [it.id, Number(it.quantity)]));

    // ── Build quote rows ────────────────────────────────────────────────
    const quoteRows: RfqQuoteInsert[] = input.lineItems.map((li) => {
      const qty = qtyById.get(li.rfqItemId) ?? 0;
      const totalPrice = Number((li.unitPrice * qty).toFixed(2));
      return {
        rfq_invitation_id: v.invitationId,
        rfq_item_id: li.rfqItemId,
        unit_price: li.unitPrice,
        gst_rate: li.gstRate,
        total_price: totalPrice,
        payment_terms: input.paymentTerms,
        delivery_period_days: input.deliveryPeriodDays,
        notes: input.notes ?? null,
      };
    });

    const { error: insErr } = await supabase
      .from('rfq_quotes')
      .insert(quoteRows);

    if (insErr) {
      console.error(`${op} insert failed`, {
        invitationId: v.invitationId,
        error: insErr,
      });
      return err(insErr.message, insErr.code);
    }

    // ── Flip invitation to submitted ────────────────────────────────────
    const { error: updErr } = await supabase
      .from('rfq_invitations')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submission_mode: 'vendor_portal',
      })
      .eq('id', v.invitationId);

    if (updErr) {
      console.error(`${op} status update failed`, {
        invitationId: v.invitationId,
        error: updErr,
      });
      // Quotes are in but status didn't flip — log and continue, audit will capture
    }

    // ── Best-effort notification to RFQ creator ─────────────────────────
    try {
      const { data: rfq } = await supabase
        .from('rfqs')
        .select('rfq_number, created_by')
        .eq('id', v.rfqId)
        .single();

      if (rfq?.created_by) {
        const { data: employee } = await supabase
          .from('employees')
          .select('id')
          .eq('profile_id', rfq.created_by)
          .maybeSingle();

        if (employee?.id) {
          const notif: NotificationInsert = {
            recipient_employee_id: employee.id,
            title: 'Quote submitted',
            body: `${v.rfq.vendorName} submitted a quote for ${rfq.rfq_number}`,
            notification_type: 'procurement',
            entity_type: 'rfq',
            entity_id: v.rfqId,
          };
          await supabase.from('notifications').insert(notif);
        }
      }
    } catch (e) {
      console.error(`${op} notification failed (non-fatal)`, {
        rfqId: v.rfqId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq_invitation',
      entityId: v.invitationId,
      action: 'submitted_from_portal',
      actorId: null,
      newValue: {
        lineItemCount: input.lineItems.length,
        paymentTerms: input.paymentTerms,
        deliveryPeriodDays: input.deliveryPeriodDays,
      },
    });

    return ok(undefined as void);
  } catch (e) {
    console.error(`${op} threw`, {
      token: input.token,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
