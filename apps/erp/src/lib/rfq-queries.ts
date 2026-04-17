import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

// ═══════════════════════════════════════════════════════════════════════
// Row type aliases — CLAUDE.md NEVER-DO rule #11: no `as any` on Supabase
// ═══════════════════════════════════════════════════════════════════════

type Rfq = Database['public']['Tables']['rfqs']['Row'];
type RfqItem = Database['public']['Tables']['rfq_items']['Row'];
type RfqInvitation = Database['public']['Tables']['rfq_invitations']['Row'];
type RfqQuote = Database['public']['Tables']['rfq_quotes']['Row'];
type RfqAward = Database['public']['Tables']['rfq_awards']['Row'];
type PurchaseOrder = Database['public']['Tables']['purchase_orders']['Row'];
type ProcurementAuditLog = Database['public']['Tables']['procurement_audit_log']['Row'];
type Vendor = Database['public']['Tables']['vendors']['Row'];

// ═══════════════════════════════════════════════════════════════════════
// Exported shape types
// ═══════════════════════════════════════════════════════════════════════

export type RfqDetail = Rfq & {
  items: RfqItem[];
  invitations: Array<
    RfqInvitation & {
      vendor: Pick<Vendor, 'id' | 'company_name' | 'phone' | 'email'> | null;
    }
  >;
};

export type RfqInvitationSummary = {
  id: string;
  status: string;
  vendor: { id: string; company_name: string; contact_person: string | null } | null;
  categories: string[];
  itemCount: number;
  sent_via_channels: string[];
  access_token: string;
  created_at: string;
  expires_at: string | null;
};

export type RfqSummary = Rfq & {
  invitationCount: number;
  submittedCount: number;
  invitations: RfqInvitationSummary[];
};

export type ComparisonMatrix = {
  rfqId: string;
  rfqNumber: string;
  items: Array<{
    rfqItemId: string;
    boqItemId: string;
    description: string;
    quantity: number;
    unit: string;
    itemCategory: string;
    priceBookRate: number | null;
    quotes: Array<{
      invitationId: string;
      vendorId: string;
      vendorName: string;
      quoteId: string;
      unitPrice: number;
      gstRate: number;
      totalPrice: number;
      paymentTerms: string | null;
      deliveryDays: number | null;
      notes: string | null;
    }>;
  }>;
  /**
   * Per-vendor commercial summary used by the 3 "extra" rows at the bottom
   * of the comparison matrix (Payment Terms / Delivery / Notes). Shaped from
   * the majority-mode across each vendor's quotes so the UI doesn't need to
   * decide how to collapse per-line values.
   */
  vendorTerms: Array<{
    invitationId: string;
    paymentTerms: string | null;
    deliveryDays: number | null;
    notes: string | null;
  }>;
  awards: RfqAward[];
};

export type AuditLogEntry = ProcurementAuditLog;

// ═══════════════════════════════════════════════════════════════════════
// Internal row shapes for typed Supabase returns
// ═══════════════════════════════════════════════════════════════════════

type RfqWithCountsRow = Rfq & {
  rfq_invitations: Array<{
    id: string;
    status: string;
    access_token: string;
    sent_via_channels: string[];
    created_at: string;
    expires_at: string | null;
    vendors: { id: string; company_name: string; contact_person: string | null } | null;
  }>;
  rfq_items: Array<{ item_category: string }>;
};

type RfqDetailRow = Rfq & {
  rfq_items: RfqItem[];
  rfq_invitations: Array<
    RfqInvitation & {
      vendors: Pick<Vendor, 'id' | 'company_name' | 'phone' | 'email'> | null;
    }
  >;
};

type ComparisonRfqRow = Rfq;
type ComparisonItemRow = RfqItem;
type ComparisonInvitationRow = RfqInvitation & {
  vendors: Pick<Vendor, 'id' | 'company_name'> | null;
};
type ComparisonQuoteRow = RfqQuote;

// ═══════════════════════════════════════════════════════════════════════
// listRfqsForProject
// ═══════════════════════════════════════════════════════════════════════

export async function listRfqsForProject(projectId: string): Promise<RfqSummary[]> {
  const op = '[listRfqsForProject]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rfqs')
    .select(
      `id, rfq_number, project_id, status, deadline, notes, created_by, created_at, updated_at,
       rfq_invitations(id, status, access_token, sent_via_channels, created_at, expires_at,
         vendors(id, company_name, contact_person)),
       rfq_items(item_category)`,
      { count: 'estimated' },
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .returns<RfqWithCountsRow[]>();

  if (error) {
    console.error(`${op} failed`, { projectId, code: error.code, message: error.message });
    return [];
  }

  return (data ?? []).map((row) => {
    const invs = row.rfq_invitations ?? [];
    const allCategories = (row.rfq_items ?? []).map((i) => i.item_category).filter(Boolean);
    const distinctCategories = [...new Set(allCategories)];

    return {
      id: row.id,
      rfq_number: row.rfq_number,
      project_id: row.project_id,
      status: row.status,
      deadline: row.deadline,
      notes: row.notes,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      invitationCount: invs.length,
      submittedCount: invs.filter((i) => i.status === 'submitted').length,
      invitations: invs.map((inv) => ({
        id: inv.id,
        status: inv.status,
        vendor: inv.vendors ?? null,
        categories: distinctCategories,
        itemCount: allCategories.length,
        sent_via_channels: inv.sent_via_channels ?? [],
        access_token: inv.access_token,
        created_at: inv.created_at,
        expires_at: inv.expires_at,
      })),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// getRfqWithInvitations
// ═══════════════════════════════════════════════════════════════════════

export async function getRfqWithInvitations(rfqId: string): Promise<RfqDetail | null> {
  const op = '[getRfqWithInvitations]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rfqs')
    .select(
      `id, rfq_number, project_id, status, deadline, notes, created_by, created_at, updated_at,
       rfq_items(id, rfq_id, boq_item_id, quantity, item_description, unit, item_category, price_book_rate, created_at),
       rfq_invitations(
         id, rfq_id, vendor_id, access_token, status, sent_at, viewed_at, submitted_at,
         expires_at, submission_mode, submitted_by_user_id, excel_file_path,
         sent_via_channels, created_at, updated_at,
         vendors(id, company_name, phone, email)
       )`,
    )
    .eq('id', rfqId)
    .maybeSingle()
    .returns<RfqDetailRow>();

  if (error) {
    console.error(`${op} failed`, { rfqId, code: error.code, message: error.message });
    return null;
  }

  if (!data) {
    console.warn(`${op} not found`, { rfqId });
    return null;
  }

  return {
    id: data.id,
    rfq_number: data.rfq_number,
    project_id: data.project_id,
    status: data.status,
    deadline: data.deadline,
    notes: data.notes,
    created_by: data.created_by,
    created_at: data.created_at,
    updated_at: data.updated_at,
    items: data.rfq_items ?? [],
    invitations: (data.rfq_invitations ?? []).map((inv: RfqInvitation & { vendors: Pick<Vendor, 'id' | 'company_name' | 'phone' | 'email'> | null }) => ({
      id: inv.id,
      rfq_id: inv.rfq_id,
      vendor_id: inv.vendor_id,
      access_token: inv.access_token,
      status: inv.status,
      sent_at: inv.sent_at,
      viewed_at: inv.viewed_at,
      submitted_at: inv.submitted_at,
      expires_at: inv.expires_at,
      submission_mode: inv.submission_mode,
      submitted_by_user_id: inv.submitted_by_user_id,
      excel_file_path: inv.excel_file_path,
      sent_via_channels: inv.sent_via_channels,
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      vendor: inv.vendors ?? null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// getRfqComparisonData
// ═══════════════════════════════════════════════════════════════════════

export async function getRfqComparisonData(projectId: string): Promise<ComparisonMatrix | null> {
  const op = '[getRfqComparisonData]';
  const supabase = await createClient();

  // Find the most recent RFQ with at least one submitted quote
  const { data: rfqRows, error: rfqError } = await supabase
    .from('rfqs')
    .select('id, rfq_number, project_id, status, deadline, notes, created_by, created_at, updated_at')
    .eq('project_id', projectId)
    .in('status', ['sent', 'comparing', 'awarded'])
    .order('created_at', { ascending: false })
    .limit(10)
    .returns<ComparisonRfqRow[]>();

  if (rfqError) {
    console.error(`${op} rfqs fetch failed`, { projectId, code: rfqError.code, message: rfqError.message });
    return null;
  }

  if (!rfqRows || rfqRows.length === 0) return null;

  // Find the first RFQ that has at least one submitted invitation
  let targetRfq: ComparisonRfqRow | null = null;
  for (const rfq of rfqRows) {
    const { data: submittedCheck } = await supabase
      .from('rfq_invitations')
      .select('id')
      .eq('rfq_id', rfq.id)
      .eq('status', 'submitted')
      .limit(1);
    if (submittedCheck && submittedCheck.length > 0) {
      targetRfq = rfq;
      break;
    }
  }

  if (!targetRfq) return null;

  // Fetch all rfq_items for this RFQ
  const { data: items, error: itemsError } = await supabase
    .from('rfq_items')
    .select('id, rfq_id, boq_item_id, quantity, item_description, unit, item_category, price_book_rate, created_at')
    .eq('rfq_id', targetRfq.id)
    .returns<ComparisonItemRow[]>();

  if (itemsError) {
    console.error(`${op} items fetch failed`, { rfqId: targetRfq.id, code: itemsError.code, message: itemsError.message });
    return null;
  }

  // Fetch all submitted invitations with vendor names
  const { data: invitations, error: invError } = await supabase
    .from('rfq_invitations')
    .select('id, rfq_id, vendor_id, access_token, status, sent_at, viewed_at, submitted_at, expires_at, submission_mode, submitted_by_user_id, excel_file_path, sent_via_channels, created_at, updated_at, vendors(id, company_name)')
    .eq('rfq_id', targetRfq.id)
    .eq('status', 'submitted')
    .returns<ComparisonInvitationRow[]>();

  if (invError) {
    console.error(`${op} invitations fetch failed`, { rfqId: targetRfq.id, code: invError.code, message: invError.message });
    return null;
  }

  // Fetch all quotes for this RFQ's invitations
  const invitationIds = (invitations ?? []).map((inv) => inv.id);
  let quotes: ComparisonQuoteRow[] = [];
  if (invitationIds.length > 0) {
    const { data: quoteRows, error: quotesError } = await supabase
      .from('rfq_quotes')
      .select('id, rfq_invitation_id, rfq_item_id, unit_price, gst_rate, total_price, payment_terms, delivery_period_days, notes, created_at')
      .in('rfq_invitation_id', invitationIds)
      .returns<ComparisonQuoteRow[]>();

    if (quotesError) {
      console.error(`${op} quotes fetch failed`, { rfqId: targetRfq.id, code: quotesError.code, message: quotesError.message });
    } else {
      quotes = quoteRows ?? [];
    }
  }

  // Fetch existing awards for this RFQ
  const { data: awards, error: awardsError } = await supabase
    .from('rfq_awards')
    .select('id, rfq_id, rfq_item_id, winning_invitation_id, was_auto_selected, override_reason, awarded_by, awarded_at, purchase_order_id')
    .eq('rfq_id', targetRfq.id)
    .returns<RfqAward[]>();

  if (awardsError) {
    console.error(`${op} awards fetch failed`, { rfqId: targetRfq.id, code: awardsError.code, message: awardsError.message });
  }

  // Build a lookup: invitationId → vendor info
  const invMap = new Map<string, ComparisonInvitationRow>();
  for (const inv of invitations ?? []) {
    invMap.set(inv.id, inv);
  }

  // Shape into ComparisonMatrix (per-row shaping, not aggregation)
  const matrixItems = (items ?? []).map((item) => {
    const itemQuotes = quotes
      .filter((q) => q.rfq_item_id === item.id)
      .map((q) => {
        const inv = invMap.get(q.rfq_invitation_id);
        return {
          invitationId: q.rfq_invitation_id,
          vendorId: inv?.vendor_id ?? '',
          vendorName: inv?.vendors?.company_name ?? 'Unknown Vendor',
          quoteId: q.id,
          unitPrice: Number(q.unit_price),
          gstRate: Number(q.gst_rate),
          totalPrice: Number(q.total_price),
          paymentTerms: q.payment_terms ?? null,
          deliveryDays: q.delivery_period_days !== null && q.delivery_period_days !== undefined
            ? Number(q.delivery_period_days)
            : null,
          notes: q.notes ?? null,
        };
      });

    return {
      rfqItemId: item.id,
      boqItemId: item.boq_item_id,
      description: item.item_description,
      quantity: Number(item.quantity),
      unit: item.unit,
      itemCategory: item.item_category,
      priceBookRate: item.price_book_rate !== null ? Number(item.price_book_rate) : null,
      quotes: itemQuotes,
    };
  });

  // Per-vendor commercial summary — we collapse each vendor's quotes to a
  // single representative set of terms. Strategy: first non-null value wins.
  // Vendors typically quote one set of terms for the whole RFQ on the portal,
  // so this is almost always a no-op aggregation.
  const vendorTerms = (invitations ?? []).map((inv) => {
    const vendorQuotes = quotes.filter((q) => q.rfq_invitation_id === inv.id);
    const paymentTerms =
      vendorQuotes.find((q) => q.payment_terms && q.payment_terms.trim())?.payment_terms ?? null;
    const deliveryRaw = vendorQuotes.find(
      (q) => q.delivery_period_days !== null && q.delivery_period_days !== undefined,
    )?.delivery_period_days;
    const deliveryDays =
      deliveryRaw !== null && deliveryRaw !== undefined ? Number(deliveryRaw) : null;
    const notes = vendorQuotes.find((q) => q.notes && q.notes.trim())?.notes ?? null;
    return {
      invitationId: inv.id,
      paymentTerms,
      deliveryDays,
      notes,
    };
  });

  return {
    rfqId: targetRfq.id,
    rfqNumber: targetRfq.rfq_number,
    items: matrixItems,
    vendorTerms,
    awards: awards ?? [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// getPendingApprovalPOs
// ═══════════════════════════════════════════════════════════════════════

export async function getPendingApprovalPOs(): Promise<PurchaseOrder[]> {
  const op = '[getPendingApprovalPOs]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(
      'id, po_number, project_id, vendor_id, prepared_by, status, approval_status, approval_rejection_reason, approved_by, rfq_id, requires_approval, subtotal, gst_amount, total_amount, amount_paid, amount_outstanding, po_date, expected_delivery_date, actual_delivery_date, dispatched_at, acknowledged_at, vendor_tracking_number, vendor_dispatch_date, payment_terms_days, payment_due_date, pdf_storage_path, notes, loi_issued, loi_issued_at, loi_storage_path, advance_block_overridden, advance_block_override_by, advance_block_override_note, created_at, updated_at',
    )
    .eq('approval_status', 'pending_approval')
    .order('created_at', { ascending: false })
    .returns<PurchaseOrder[]>();

  if (error) {
    console.error(`${op} failed`, { code: error.code, message: error.message });
    return [];
  }

  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
// getProcurementAuditLog
// ═══════════════════════════════════════════════════════════════════════

export async function getProcurementAuditLog(
  entityType: string,
  entityId: string,
): Promise<AuditLogEntry[]> {
  const op = '[getProcurementAuditLog]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('procurement_audit_log')
    .select('id, entity_type, entity_id, action, actor_id, old_value, new_value, reason, created_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .returns<AuditLogEntry[]>();

  if (error) {
    console.error(`${op} failed`, { entityType, entityId, code: error.code, message: error.message });
    return [];
  }

  return data ?? [];
}
