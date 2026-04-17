'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { logProcurementAudit } from '@/lib/procurement-audit';
import type { Database } from '@repo/types/database';
import type { ParsedQuoteRow } from '@/lib/excel-quote-parser';

// ═══════════════════════════════════════════════════════════════════════
// Row type aliases — CLAUDE.md NEVER-DO rule #11: no `as any` on Supabase
// ═══════════════════════════════════════════════════════════════════════

type RfqInsert = Database['public']['Tables']['rfqs']['Insert'];
type RfqItemInsert = Database['public']['Tables']['rfq_items']['Insert'];
type RfqInvitation = Database['public']['Tables']['rfq_invitations']['Row'];
type RfqInvitationInsert = Database['public']['Tables']['rfq_invitations']['Insert'];
type RfqInvitationUpdate = Database['public']['Tables']['rfq_invitations']['Update'];
type RfqQuoteInsert = Database['public']['Tables']['rfq_quotes']['Insert'];
type RfqAwardInsert = Database['public']['Tables']['rfq_awards']['Insert'];
type RfqAwardUpdate = Database['public']['Tables']['rfq_awards']['Update'];
type PurchaseOrderInsert = Database['public']['Tables']['purchase_orders']['Insert'];
type PurchaseOrderItemInsert = Database['public']['Tables']['purchase_order_items']['Insert'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

// ═══════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════

/** Normalise a description for fuzzy matching: lowercase, collapse whitespace, strip punctuation */
function normaliseDesc(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════
// createRfqWithInvitations
// ═══════════════════════════════════════════════════════════════════════

export async function createRfqWithInvitations(input: {
  projectId: string;
  boqItemIds: string[];
  vendorIds: string[];
  deadline: string;
  notes?: string;
}): Promise<ActionResult<{ rfqId: string; invitations: RfqInvitation[] }>> {
  const op = '[createRfqWithInvitations]';
  console.log(`${op} Starting`, { projectId: input.projectId, boqItemIds: input.boqItemIds.length, vendors: input.vendorIds.length });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    if (input.boqItemIds.length === 0) return err('Select at least one BOQ item');
    if (input.vendorIds.length === 0) return err('Select at least one vendor');

    // Fetch BOQ items for snapshot
    type BoqRow = {
      id: string;
      quantity: number;
      item_description: string;
      unit: string;
      item_category: string;
      unit_price: number | null;
    };
    const { data: boqItems, error: boqError } = await supabase
      .from('project_boq_items')
      .select('id, quantity, item_description, unit, item_category, unit_price')
      .in('id', input.boqItemIds)
      .returns<BoqRow[]>();

    if (boqError || !boqItems || boqItems.length === 0) {
      console.error(`${op} BOQ fetch failed`, { code: boqError?.code, message: boqError?.message });
      return err(boqError?.message ?? 'Failed to fetch BOQ items');
    }

    // Insert RFQ header
    const rfqInsert: RfqInsert = {
      project_id: input.projectId,
      deadline: input.deadline,
      notes: input.notes ?? null,
      created_by: user.id,
      status: 'draft',
    };

    const { data: rfq, error: rfqError } = await supabase
      .from('rfqs')
      .insert(rfqInsert)
      .select('id, rfq_number')
      .single();

    if (rfqError || !rfq) {
      console.error(`${op} RFQ insert failed`, { code: rfqError?.code, message: rfqError?.message });
      return err(rfqError?.message ?? 'Failed to create RFQ');
    }

    // Insert rfq_items (one per BOQ item — snapshot)
    const rfqItems: RfqItemInsert[] = boqItems.map((item) => ({
      rfq_id: rfq.id,
      boq_item_id: item.id,
      quantity: item.quantity,
      item_description: item.item_description,
      unit: item.unit,
      item_category: item.item_category,
      price_book_rate: item.unit_price ?? null,
    }));

    const { error: itemsError } = await supabase
      .from('rfq_items')
      .insert(rfqItems);

    if (itemsError) {
      console.error(`${op} RFQ items insert failed`, { code: itemsError.code, message: itemsError.message });
      return err(itemsError.message);
    }

    // Insert rfq_invitations (one per vendor)
    const invitationInserts: RfqInvitationInsert[] = input.vendorIds.map((vendorId) => ({
      rfq_id: rfq.id,
      vendor_id: vendorId,
      expires_at: input.deadline,
      status: 'pending',
    }));

    const { error: invError } = await supabase
      .from('rfq_invitations')
      .insert(invitationInserts);

    if (invError) {
      console.error(`${op} Invitations insert failed`, { code: invError.code, message: invError.message });
      return err(invError.message);
    }

    // Flip RFQ status to 'sent' (invitations now exist)
    await supabase
      .from('rfqs')
      .update({ status: 'sent' })
      .eq('id', rfq.id);

    // Re-fetch invitations to return them
    const { data: invitations, error: refetchError } = await supabase
      .from('rfq_invitations')
      .select('id, rfq_id, vendor_id, access_token, status, sent_at, viewed_at, submitted_at, expires_at, submission_mode, submitted_by_user_id, excel_file_path, sent_via_channels, created_at, updated_at')
      .eq('rfq_id', rfq.id)
      .returns<RfqInvitation[]>();

    if (refetchError) {
      console.error(`${op} Invitations refetch failed`, { code: refetchError.code, message: refetchError.message });
      return err(refetchError.message);
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq',
      entityId: rfq.id,
      action: 'created',
      actorId: user.id,
      newValue: { rfqNumber: rfq.rfq_number, projectId: input.projectId, vendorCount: input.vendorIds.length, itemCount: input.boqItemIds.length, deadline: input.deadline },
    });

    revalidatePath(`/procurement/project/${input.projectId}`);
    return ok({ rfqId: rfq.id, invitations: invitations ?? [] });
  } catch (e) {
    console.error(`${op} threw`, { e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// markInvitationSent
// ═══════════════════════════════════════════════════════════════════════

export async function markInvitationSent(
  invitationId: string,
  channel: 'email' | 'whatsapp' | 'copy_link',
): Promise<ActionResult<void>> {
  const op = '[markInvitationSent]';
  console.log(`${op} Starting`, { invitationId, channel });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Fetch old value for audit
    const { data: oldInv } = await supabase
      .from('rfq_invitations')
      .select('id, status, sent_via_channels, sent_at')
      .eq('id', invitationId)
      .maybeSingle();

    // Dedupe channels in JS then update
    const existingChannels: string[] = oldInv?.sent_via_channels ?? [];
    const updatedChannels = existingChannels.includes(channel)
      ? existingChannels
      : [...existingChannels, channel];

    const update: RfqInvitationUpdate = {
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_via_channels: updatedChannels,
    };

    const { error } = await supabase
      .from('rfq_invitations')
      .update(update)
      .eq('id', invitationId);

    if (error) {
      console.error(`${op} failed`, { invitationId, code: error.code, message: error.message });
      return err(error.message, error.code);
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq_invitation',
      entityId: invitationId,
      action: 'sent',
      actorId: user.id,
      oldValue: { status: oldInv?.status, channels: oldInv?.sent_via_channels },
      newValue: { status: 'sent', channel, channels: updatedChannels },
    });

    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { invitationId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// submitQuoteManually
// ═══════════════════════════════════════════════════════════════════════

export async function submitQuoteManually(input: {
  invitationId: string;
  lineItems: Array<{
    rfqItemId: string;
    unitPrice: number;
    gstRate: number;
    paymentTerms: string;
    deliveryPeriodDays: number;
    notes?: string;
  }>;
  paymentTerms: string;
  deliveryPeriodDays: number;
  notes?: string;
}): Promise<ActionResult<void>> {
  const op = '[submitQuoteManually]';
  console.log(`${op} Starting`, { invitationId: input.invitationId, items: input.lineItems.length });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Verify invitation isn't already submitted
    const { data: invitation } = await supabase
      .from('rfq_invitations')
      .select('id, status, rfq_id')
      .eq('id', input.invitationId)
      .maybeSingle();

    if (!invitation) return err('Invitation not found');
    if (invitation.status === 'submitted') return err('Quote already submitted for this invitation');

    // Fetch rfq_items to get quantity for total_price calculation
    const rfqItemIds = input.lineItems.map((l) => l.rfqItemId);
    type RfqItemQty = { id: string; quantity: number };
    const { data: rfqItems, error: itemsError } = await supabase
      .from('rfq_items')
      .select('id, quantity')
      .in('id', rfqItemIds)
      .returns<RfqItemQty[]>();

    if (itemsError) {
      console.error(`${op} rfq_items fetch failed`, { code: itemsError.code, message: itemsError.message });
      return err(itemsError.message);
    }

    const qtyMap = new Map<string, number>();
    for (const item of rfqItems ?? []) {
      qtyMap.set(item.id, item.quantity);
    }

    // Build quote rows
    const quoteInserts: RfqQuoteInsert[] = input.lineItems.map((line) => {
      const qty = qtyMap.get(line.rfqItemId) ?? 1;
      const totalPrice = line.unitPrice * qty;
      return {
        rfq_invitation_id: input.invitationId,
        rfq_item_id: line.rfqItemId,
        unit_price: line.unitPrice,
        gst_rate: line.gstRate,
        total_price: totalPrice,
        payment_terms: line.paymentTerms ?? input.paymentTerms,
        delivery_period_days: line.deliveryPeriodDays ?? input.deliveryPeriodDays,
        notes: line.notes ?? input.notes ?? null,
      };
    });

    const { error: quotesError } = await supabase
      .from('rfq_quotes')
      .insert(quoteInserts);

    if (quotesError) {
      console.error(`${op} quotes insert failed`, { code: quotesError.code, message: quotesError.message });
      return err(quotesError.message);
    }

    // Update invitation to submitted
    const invUpdate: RfqInvitationUpdate = {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      submission_mode: 'manual_entry',
      submitted_by_user_id: user.id,
    };

    const { error: updateError } = await supabase
      .from('rfq_invitations')
      .update(invUpdate)
      .eq('id', input.invitationId);

    if (updateError) {
      console.error(`${op} invitation update failed`, { code: updateError.code, message: updateError.message });
      return err(updateError.message);
    }

    // Notify RFQ creator (best-effort)
    try {
      const { data: rfq } = await supabase
        .from('rfqs')
        .select('id, rfq_number, created_by, project_id')
        .eq('id', invitation.rfq_id)
        .maybeSingle();

      if (rfq?.created_by) {
        const { data: creatorEmployee } = await supabase
          .from('employees')
          .select('id')
          .eq('profile_id', rfq.created_by)
          .maybeSingle();

        if (creatorEmployee) {
          const notif: NotificationInsert = {
            recipient_employee_id: creatorEmployee.id,
            notification_type: 'rfq_quote_submitted',
            title: `Quote submitted for ${rfq.rfq_number}`,
            body: `A vendor has submitted a quote manually. Review in the comparison tab.`,
            entity_type: 'rfq',
            entity_id: rfq.id,
          };
          await supabase.from('notifications').insert(notif);
        }
      }
    } catch (notifErr) {
      console.error(`${op} notification failed (non-fatal)`, { error: notifErr instanceof Error ? notifErr.message : String(notifErr) });
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq_invitation',
      entityId: input.invitationId,
      action: 'submitted_manually',
      actorId: user.id,
      newValue: { lineItems: input.lineItems.length, paymentTerms: input.paymentTerms, deliveryPeriodDays: input.deliveryPeriodDays },
    });

    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { invitationId: input.invitationId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// submitQuoteFromExcel
// ═══════════════════════════════════════════════════════════════════════

export async function submitQuoteFromExcel(input: {
  invitationId: string;
  filePath: string;
  parsedRows: ParsedQuoteRow[];
  paymentTerms: string;
  deliveryPeriodDays: number;
}): Promise<ActionResult<void>> {
  const op = '[submitQuoteFromExcel]';
  console.log(`${op} Starting`, { invitationId: input.invitationId, rows: input.parsedRows.length });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Verify invitation
    const { data: invitation } = await supabase
      .from('rfq_invitations')
      .select('id, status, rfq_id')
      .eq('id', input.invitationId)
      .maybeSingle();

    if (!invitation) return err('Invitation not found');
    if (invitation.status === 'submitted') return err('Quote already submitted for this invitation');

    // Fetch rfq_items for this RFQ to match against parsed rows
    type RfqItemRow = { id: string; item_description: string; quantity: number };
    const { data: rfqItems, error: itemsError } = await supabase
      .from('rfq_items')
      .select('id, item_description, quantity')
      .eq('rfq_id', invitation.rfq_id)
      .returns<RfqItemRow[]>();

    if (itemsError) {
      console.error(`${op} rfq_items fetch failed`, { code: itemsError.code, message: itemsError.message });
      return err(itemsError.message);
    }

    const allItems = rfqItems ?? [];
    const warnings: string[] = [];
    const quoteInserts: RfqQuoteInsert[] = [];

    // Match each parsed row to an rfq_item by normalised description
    for (const row of input.parsedRows) {
      const normRow = normaliseDesc(row.itemDescription);
      let bestMatch: RfqItemRow | null = null;

      for (const item of allItems) {
        const normItem = normaliseDesc(item.item_description);
        if (normRow === normItem) {
          bestMatch = item;
          break;
        }
      }

      // Substring fallback
      if (!bestMatch) {
        for (const item of allItems) {
          const normItem = normaliseDesc(item.item_description);
          if (normItem.includes(normRow) || normRow.includes(normItem)) {
            bestMatch = item;
            break;
          }
        }
      }

      if (!bestMatch) {
        warnings.push(`Row "${row.itemDescription}": no matching RFQ item found, skipped`);
        continue;
      }

      const totalPrice = row.unitPrice * Number(bestMatch.quantity);
      quoteInserts.push({
        rfq_invitation_id: input.invitationId,
        rfq_item_id: bestMatch.id,
        unit_price: row.unitPrice,
        gst_rate: row.gstRate ?? 18,
        total_price: totalPrice,
        payment_terms: input.paymentTerms,
        delivery_period_days: input.deliveryPeriodDays,
        notes: null,
      });
    }

    if (quoteInserts.length === 0) {
      return err(`No rows could be matched to RFQ items. Warnings: ${warnings.join('; ')}`);
    }

    const { error: quotesError } = await supabase
      .from('rfq_quotes')
      .insert(quoteInserts);

    if (quotesError) {
      console.error(`${op} quotes insert failed`, { code: quotesError.code, message: quotesError.message });
      return err(quotesError.message);
    }

    // Update invitation
    const invUpdate: RfqInvitationUpdate = {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      submission_mode: 'excel_upload',
      submitted_by_user_id: user.id,
      excel_file_path: input.filePath,
    };

    const { error: updateError } = await supabase
      .from('rfq_invitations')
      .update(invUpdate)
      .eq('id', input.invitationId);

    if (updateError) {
      console.error(`${op} invitation update failed`, { code: updateError.code, message: updateError.message });
      return err(updateError.message);
    }

    // Notify RFQ creator (best-effort)
    try {
      const { data: rfq } = await supabase
        .from('rfqs')
        .select('id, rfq_number, created_by')
        .eq('id', invitation.rfq_id)
        .maybeSingle();

      if (rfq?.created_by) {
        const { data: creatorEmployee } = await supabase
          .from('employees')
          .select('id')
          .eq('profile_id', rfq.created_by)
          .maybeSingle();

        if (creatorEmployee) {
          const notif: NotificationInsert = {
            recipient_employee_id: creatorEmployee.id,
            notification_type: 'rfq_quote_submitted',
            title: `Excel quote submitted for ${rfq.rfq_number}`,
            body: `${quoteInserts.length} items matched via Excel upload. ${warnings.length > 0 ? `${warnings.length} rows skipped.` : ''}`,
            entity_type: 'rfq',
            entity_id: rfq.id,
          };
          await supabase.from('notifications').insert(notif);
        }
      }
    } catch (notifErr) {
      console.error(`${op} notification failed (non-fatal)`, { error: notifErr instanceof Error ? notifErr.message : String(notifErr) });
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq_invitation',
      entityId: input.invitationId,
      action: 'submitted_excel',
      actorId: user.id,
      newValue: { filePath: input.filePath, matchedRows: quoteInserts.length, warnings },
    });

    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { invitationId: input.invitationId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// awardRfqItem
// ═══════════════════════════════════════════════════════════════════════

export async function awardRfqItem(input: {
  rfqItemId: string;
  winningInvitationId: string;
  overrideReason?: string;
}): Promise<ActionResult<void>> {
  const op = '[awardRfqItem]';
  console.log(`${op} Starting`, { rfqItemId: input.rfqItemId, winningInvitationId: input.winningInvitationId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Fetch rfq_item to get rfq_id
    const { data: rfqItem } = await supabase
      .from('rfq_items')
      .select('id, rfq_id')
      .eq('id', input.rfqItemId)
      .maybeSingle();

    if (!rfqItem) return err('RFQ item not found');

    // Fetch all quotes for this item to determine L1
    type QuoteSummary = { rfq_invitation_id: string; total_price: number };
    const { data: quotes, error: quotesError } = await supabase
      .from('rfq_quotes')
      .select('rfq_invitation_id, total_price')
      .eq('rfq_item_id', input.rfqItemId)
      .returns<QuoteSummary[]>();

    if (quotesError) {
      console.error(`${op} quotes fetch failed`, { code: quotesError.code, message: quotesError.message });
      return err(quotesError.message);
    }

    // Find lowest total_price
    let lowestInvitationId: string | null = null;
    let lowestPrice = Infinity;
    for (const q of quotes ?? []) {
      if (Number(q.total_price) < lowestPrice) {
        lowestPrice = Number(q.total_price);
        lowestInvitationId = q.rfq_invitation_id;
      }
    }

    const wasAutoSelected = lowestInvitationId === input.winningInvitationId;

    if (!wasAutoSelected && !input.overrideReason?.trim()) {
      return err('Override reason is required when not selecting the lowest-price vendor');
    }

    // UPSERT into rfq_awards (unique on rfq_item_id)
    const awardInsert: RfqAwardInsert = {
      rfq_id: rfqItem.rfq_id,
      rfq_item_id: input.rfqItemId,
      winning_invitation_id: input.winningInvitationId,
      was_auto_selected: wasAutoSelected,
      override_reason: wasAutoSelected ? null : (input.overrideReason ?? null),
      awarded_by: user.id,
    };

    const { error: awardError } = await supabase
      .from('rfq_awards')
      .upsert(awardInsert, { onConflict: 'rfq_item_id' });

    if (awardError) {
      console.error(`${op} award upsert failed`, { code: awardError.code, message: awardError.message });
      return err(awardError.message, awardError.code);
    }

    // Flip RFQ status to 'comparing' if still on 'sent'
    await supabase
      .from('rfqs')
      .update({ status: 'comparing' })
      .eq('id', rfqItem.rfq_id)
      .eq('status', 'sent');

    await logProcurementAudit(supabase, {
      entityType: 'rfq_award',
      entityId: input.rfqItemId,
      action: wasAutoSelected ? 'awarded_auto' : 'awarded_override',
      actorId: user.id,
      newValue: { winningInvitationId: input.winningInvitationId, wasAutoSelected },
      reason: input.overrideReason,
    });

    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { rfqItemId: input.rfqItemId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// autoAwardL1
// ═══════════════════════════════════════════════════════════════════════

export async function autoAwardL1(rfqId: string): Promise<ActionResult<{ awarded: number }>> {
  const op = '[autoAwardL1]';
  console.log(`${op} Starting`, { rfqId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Fetch all rfq_items for this RFQ
    type ItemRow = { id: string; rfq_id: string };
    const { data: items, error: itemsError } = await supabase
      .from('rfq_items')
      .select('id, rfq_id')
      .eq('rfq_id', rfqId)
      .returns<ItemRow[]>();

    if (itemsError) {
      console.error(`${op} items fetch failed`, { rfqId, code: itemsError.code, message: itemsError.message });
      return err(itemsError.message);
    }

    // Fetch existing awards to skip already-awarded items
    const { data: existingAwards } = await supabase
      .from('rfq_awards')
      .select('rfq_item_id')
      .eq('rfq_id', rfqId);

    const awardedItemIds = new Set((existingAwards ?? []).map((a) => a.rfq_item_id));

    let awardedCount = 0;

    for (const item of items ?? []) {
      if (awardedItemIds.has(item.id)) continue;

      // Find all quotes for this item from submitted invitations
      type QuoteRow = { id: string; rfq_invitation_id: string; total_price: number };
      const { data: quotes } = await supabase
        .from('rfq_quotes')
        .select('id, rfq_invitation_id, total_price')
        .eq('rfq_item_id', item.id)
        .returns<QuoteRow[]>();

      if (!quotes || quotes.length === 0) continue;

      // Find lowest total_price
      let best: QuoteRow | null = null;
      for (const q of quotes) {
        if (!best || Number(q.total_price) < Number(best.total_price)) {
          best = q;
        }
      }
      if (!best) continue;

      const awardInsert: RfqAwardInsert = {
        rfq_id: rfqId,
        rfq_item_id: item.id,
        winning_invitation_id: best.rfq_invitation_id,
        was_auto_selected: true,
        awarded_by: user.id,
      };

      const { error: insertErr } = await supabase
        .from('rfq_awards')
        .insert(awardInsert);

      if (insertErr) {
        console.error(`${op} award insert failed for item ${item.id}`, { code: insertErr.code, message: insertErr.message });
      } else {
        awardedCount++;
      }
    }

    // Flip RFQ status to 'comparing' if any awards exist
    if (awardedCount > 0) {
      await supabase
        .from('rfqs')
        .update({ status: 'comparing' })
        .eq('id', rfqId)
        .eq('status', 'sent');
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq',
      entityId: rfqId,
      action: 'auto_awarded_all',
      actorId: user.id,
      newValue: { awarded: awardedCount },
    });

    return ok({ awarded: awardedCount });
  } catch (e) {
    console.error(`${op} threw`, { rfqId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// generatePOsFromAwards
// ═══════════════════════════════════════════════════════════════════════

export async function generatePOsFromAwards(rfqId: string): Promise<ActionResult<{ poIds: string[] }>> {
  const op = '[generatePOsFromAwards]';
  console.log(`${op} Starting`, { rfqId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Resolve employee (may be null for founder)
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    // Fetch the RFQ for project_id
    const { data: rfq } = await supabase
      .from('rfqs')
      .select('id, project_id, rfq_number')
      .eq('id', rfqId)
      .maybeSingle();

    if (!rfq) return err('RFQ not found');

    // Fetch all rfq_items for this RFQ
    type RfqItemFull = {
      id: string;
      boq_item_id: string;
      quantity: number;
      item_description: string;
      unit: string;
      item_category: string;
      price_book_rate: number | null;
    };
    const { data: rfqItems, error: itemsError } = await supabase
      .from('rfq_items')
      .select('id, boq_item_id, quantity, item_description, unit, item_category, price_book_rate')
      .eq('rfq_id', rfqId)
      .returns<RfqItemFull[]>();

    if (itemsError) {
      console.error(`${op} rfq_items fetch failed`, { rfqId, code: itemsError.code, message: itemsError.message });
      return err(itemsError.message);
    }

    // Fetch all awards for this RFQ
    type AwardFull = {
      id: string;
      rfq_item_id: string;
      winning_invitation_id: string;
      rfq_invitations: { vendor_id: string } | null;
    };
    const { data: awards, error: awardsError } = await supabase
      .from('rfq_awards')
      .select('id, rfq_item_id, winning_invitation_id, rfq_invitations!rfq_awards_winning_invitation_id_fkey(vendor_id)')
      .eq('rfq_id', rfqId)
      .returns<AwardFull[]>();

    if (awardsError) {
      console.error(`${op} awards fetch failed`, { rfqId, code: awardsError.code, message: awardsError.message });
      return err(awardsError.message);
    }

    // Verify all items are awarded
    const awardedItemIds = new Set((awards ?? []).map((a) => a.rfq_item_id));
    const unawardedItems = (rfqItems ?? []).filter((i) => !awardedItemIds.has(i.id));
    if (unawardedItems.length > 0) {
      return err(`Award all items before generating POs. ${unawardedItems.length} item(s) still unawarded.`);
    }

    // Determine if current user is founder → no approval required
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const isFounder = profile?.role === 'founder';

    // Fetch winning quotes for each award (for rate/gst/payment_terms)
    type WinningQuote = {
      rfq_invitation_id: string;
      rfq_item_id: string;
      unit_price: number;
      gst_rate: number;
      total_price: number;
      payment_terms: string;
      delivery_period_days: number;
    };

    // Fetch hsn_code from project_boq_items for traceability
    const boqItemIds = (rfqItems ?? []).map((i) => i.boq_item_id);
    type BoqHsn = { id: string; hsn_code: string | null };
    const { data: boqHsns } = await supabase
      .from('project_boq_items')
      .select('id, hsn_code')
      .in('id', boqItemIds)
      .returns<BoqHsn[]>();

    const hsnMap = new Map<string, string | null>();
    for (const b of boqHsns ?? []) {
      hsnMap.set(b.id, b.hsn_code);
    }

    // Build rfqItem lookup
    const rfqItemMap = new Map<string, RfqItemFull>();
    for (const item of rfqItems ?? []) {
      rfqItemMap.set(item.id, item);
    }

    // Group awards by vendor_id
    type AwardGroup = {
      awardId: string;
      rfqItemId: string;
      winningInvitationId: string;
    };
    const vendorGroups = new Map<string, AwardGroup[]>();
    for (const award of awards ?? []) {
      const vendorId = award.rfq_invitations?.vendor_id;
      if (!vendorId) continue;
      if (!vendorGroups.has(vendorId)) vendorGroups.set(vendorId, []);
      vendorGroups.get(vendorId)!.push({
        awardId: award.id,
        rfqItemId: award.rfq_item_id,
        winningInvitationId: award.winning_invitation_id,
      });
    }

    const poIds: string[] = [];
    const founderEmployees: string[] = [];

    // Pre-fetch founder employees once for notifications
    if (!isFounder) {
      const { data: founders } = await supabase
        .from('employees')
        .select('id, profiles!employees_profile_id_fkey(role)')
        .eq('is_active', true)
        .returns<Array<{ id: string; profiles: { role: string } | null }>>();

      for (const f of founders ?? []) {
        if (f.profiles?.role === 'founder') {
          founderEmployees.push(f.id);
        }
      }
    }

    for (const [vendorId, awardGroup] of vendorGroups.entries()) {
      // Fetch winning quotes for this vendor's awarded items
      const winInvIds = [...new Set(awardGroup.map((a) => a.winningInvitationId))];
      const winItemIds = awardGroup.map((a) => a.rfqItemId);

      const { data: winQuotes, error: wqError } = await supabase
        .from('rfq_quotes')
        .select('rfq_invitation_id, rfq_item_id, unit_price, gst_rate, total_price, payment_terms, delivery_period_days')
        .in('rfq_invitation_id', winInvIds)
        .in('rfq_item_id', winItemIds)
        .returns<WinningQuote[]>();

      if (wqError) {
        console.error(`${op} winning quotes fetch failed for vendor ${vendorId}`, { code: wqError.code, message: wqError.message });
        continue;
      }

      // Build a quote lookup: invitationId|itemId → quote
      const quoteKey = (invId: string, itemId: string) => `${invId}|${itemId}`;
      const quoteMap = new Map<string, WinningQuote>();
      for (const q of winQuotes ?? []) {
        quoteMap.set(quoteKey(q.rfq_invitation_id, q.rfq_item_id), q);
      }

      // Compute totals
      let subtotal = 0;
      let gstTotal = 0;

      type LineItem = {
        rfqItemId: string;
        winningInvitationId: string;
        boqItemId: string;
        itemDescription: string;
        itemCategory: string;
        unit: string;
        quantity: number;
        unitPrice: number;
        gstRate: number;
        lineTotal: number;
        lineGst: number;
        hsnCode: string | null;
        quoteId: string | null;
      };

      const lineItems: LineItem[] = [];
      for (const ag of awardGroup) {
        const rfqItem = rfqItemMap.get(ag.rfqItemId);
        if (!rfqItem) continue;
        const quote = quoteMap.get(quoteKey(ag.winningInvitationId, ag.rfqItemId));
        const unitPrice = quote ? Number(quote.unit_price) : 0;
        const gstRate = quote ? Number(quote.gst_rate) : 18;
        const qty = Number(rfqItem.quantity);
        const lineTotal = unitPrice * qty;
        const lineGst = lineTotal * (gstRate / 100);
        subtotal += lineTotal;
        gstTotal += lineGst;
        lineItems.push({
          rfqItemId: rfqItem.id,
          winningInvitationId: ag.winningInvitationId,
          boqItemId: rfqItem.boq_item_id,
          itemDescription: rfqItem.item_description,
          itemCategory: rfqItem.item_category,
          unit: rfqItem.unit,
          quantity: qty,
          unitPrice,
          gstRate,
          lineTotal,
          lineGst,
          hsnCode: hsnMap.get(rfqItem.boq_item_id) ?? null,
          quoteId: (winQuotes ?? []).find((q) => q.rfq_invitation_id === ag.winningInvitationId && q.rfq_item_id === ag.rfqItemId)?.rfq_invitation_id ?? null,
        });
      }

      const totalAmount = subtotal + gstTotal;
      const requiresApproval = !isFounder;
      const approvalStatus = requiresApproval ? 'pending_approval' : 'approved';

      // Generate PO number
      const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'PO' });
      const poNumber = (docNum as string | null) ?? `SHIROI/PO/${new Date().getFullYear()}/TEMP`;

      const poInsert: PurchaseOrderInsert = {
        project_id: rfq.project_id,
        vendor_id: vendorId,
        prepared_by: employee?.id ?? user.id,
        po_number: poNumber,
        status: 'draft',
        rfq_id: rfqId,
        requires_approval: requiresApproval,
        approval_status: approvalStatus,
        po_date: new Date().toISOString().slice(0, 10),
        subtotal,
        gst_amount: gstTotal,
        total_amount: totalAmount,
        amount_paid: 0,
        amount_outstanding: totalAmount,
      };

      const { data: po, error: poError } = await supabase
        .from('purchase_orders')
        .insert(poInsert)
        .select('id')
        .single();

      if (poError || !po) {
        console.error(`${op} PO insert failed for vendor ${vendorId}`, { code: poError?.code, message: poError?.message });
        continue;
      }

      // Insert PO line items
      const poLineItems: PurchaseOrderItemInsert[] = lineItems.map((line, idx) => ({
        purchase_order_id: po.id,
        line_number: idx + 1,
        item_category: line.itemCategory,
        item_description: line.itemDescription,
        unit: line.unit,
        quantity_ordered: line.quantity,
        quantity_pending: line.quantity,
        quantity_delivered: 0,
        unit_price: line.unitPrice,
        gst_rate: line.gstRate,
        gst_amount: line.lineGst,
        total_price: line.lineTotal + line.lineGst,
        hsn_code: line.hsnCode,
        boq_item_id: line.boqItemId,
        rfq_quote_id: null,
      }));

      const { error: lineItemsError } = await supabase
        .from('purchase_order_items')
        .insert(poLineItems);

      if (lineItemsError) {
        console.error(`${op} PO line items insert failed`, { poId: po.id, code: lineItemsError.code, message: lineItemsError.message });
      }

      // Update rfq_awards with purchase_order_id
      const awardIds = awardGroup.map((a) => a.awardId);
      const awardUpdate: RfqAwardUpdate = { purchase_order_id: po.id };
      await supabase
        .from('rfq_awards')
        .update(awardUpdate)
        .in('id', awardIds);

      poIds.push(po.id);

      // Notify founders if approval required
      if (requiresApproval && founderEmployees.length > 0) {
        const notifs: NotificationInsert[] = founderEmployees.map((empId) => ({
          recipient_employee_id: empId,
          notification_type: 'po_pending_approval',
          title: `PO ${poNumber} requires approval`,
          body: `A purchase order for ₹${totalAmount.toLocaleString('en-IN')} has been created and requires your approval.`,
          entity_type: 'purchase_order',
          entity_id: po.id,
        }));
        try {
          await supabase.from('notifications').insert(notifs);
        } catch (notifErr) {
          console.error(`${op} notifications failed (non-fatal)`, { error: notifErr instanceof Error ? notifErr.message : String(notifErr) });
        }
      }

      await logProcurementAudit(supabase, {
        entityType: 'purchase_order',
        entityId: po.id,
        action: 'created',
        actorId: user.id,
        newValue: { rfqId, vendorId, poNumber, totalAmount, requiresApproval },
      });
    }

    // Flip RFQ status to 'awarded'
    await supabase
      .from('rfqs')
      .update({ status: 'awarded' })
      .eq('id', rfqId);

    await logProcurementAudit(supabase, {
      entityType: 'rfq',
      entityId: rfqId,
      action: 'pos_generated',
      actorId: user.id,
      newValue: { poIds },
    });

    revalidatePath(`/procurement/project/${rfq.project_id}`);
    revalidatePath('/procurement/orders');
    return ok({ poIds });
  } catch (e) {
    console.error(`${op} threw`, { rfqId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// cancelRfq
// ═══════════════════════════════════════════════════════════════════════

export async function cancelRfq(rfqId: string, reason: string): Promise<ActionResult<void>> {
  const op = '[cancelRfq]';
  console.log(`${op} Starting`, { rfqId });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    if (!reason?.trim()) return err('Cancellation reason is required');

    // Cancel the RFQ
    const { error: rfqError } = await supabase
      .from('rfqs')
      .update({ status: 'cancelled' })
      .eq('id', rfqId);

    if (rfqError) {
      console.error(`${op} rfqs update failed`, { rfqId, code: rfqError.code, message: rfqError.message });
      return err(rfqError.message, rfqError.code);
    }

    // Expire all pending/sent/viewed invitations
    const { error: invError } = await supabase
      .from('rfq_invitations')
      .update({ status: 'expired' } satisfies RfqInvitationUpdate)
      .eq('rfq_id', rfqId)
      .in('status', ['pending', 'sent', 'viewed']);

    if (invError) {
      console.error(`${op} invitations expire failed`, { rfqId, code: invError.code, message: invError.message });
      // Non-fatal — RFQ is already cancelled
    }

    await logProcurementAudit(supabase, {
      entityType: 'rfq',
      entityId: rfqId,
      action: 'cancelled',
      actorId: user.id,
      reason,
    });

    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { rfqId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Upload RFQ Quote File (server-side Storage write)
//
// Called by the Excel Quote Upload Dialog before it invokes submitQuoteFromExcel.
// The client sends the raw file via FormData; we write it to the
// `rfq-excel-uploads` bucket from the server so components don't need an inline
// Supabase client import (NEVER-DO rule #15).
// ═══════════════════════════════════════════════════════════════════════

export async function uploadRfqQuoteFile(input: {
  rfqId: string;
  invitationId: string;
  fileName: string;
  file: File;
}): Promise<ActionResult<{ filePath: string }>> {
  const op = '[uploadRfqQuoteFile]';
  console.log(`${op} Starting`, { invitationId: input.invitationId, fileName: input.fileName });

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Safe filename — alphanumerics + dot/underscore/dash only.
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `rfq/${input.rfqId}/${input.invitationId}/${Date.now()}_${safeName}`;

    const { error: uploadErr } = await supabase
      .storage
      .from('rfq-excel-uploads')
      .upload(path, input.file, {
        contentType: input.file.type || 'application/octet-stream',
      });

    if (uploadErr) {
      console.error(`${op} upload failed`, { path, message: uploadErr.message });
      return err(uploadErr.message);
    }

    return ok({ filePath: path });
  } catch (e) {
    console.error(`${op} threw`, { invitationId: input.invitationId, e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
