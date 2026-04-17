/**
 * Vendor Portal — public read queries.
 *
 * This module is intentionally NOT a server action file — it has no 'use server'
 * directive. It is imported by server components and server actions alike.
 *
 * Security model:
 *   - Uses createAdminClient() because this is a public route (no auth cookies).
 *   - The access_token acts as a capability token. EVERY exported function
 *     re-validates the token from the DB before returning any data.
 *   - Callers must treat the token as the sole authorisation mechanism.
 */

import { createAdminClient } from '@repo/supabase/admin';
import type { Database } from '@repo/types/database';

type RfqInvitationRow = Database['public']['Tables']['rfq_invitations']['Row'];
type RfqRow = Database['public']['Tables']['rfqs']['Row'];
type RfqItemRow = Database['public']['Tables']['rfq_items']['Row'];
type RfqQuoteRow = Database['public']['Tables']['rfq_quotes']['Row'];

export type PublicRfqShape = {
  rfqId: string;
  rfqNumber: string;
  projectName: string;
  deadline: string;
  notes: string | null;
  vendorName: string;
  items: Array<
    Pick<RfqItemRow, 'id' | 'quantity' | 'item_description' | 'unit' | 'item_category'>
  >;
  submittedQuotes?: Array<
    Pick<
      RfqQuoteRow,
      | 'rfq_item_id'
      | 'unit_price'
      | 'gst_rate'
      | 'total_price'
      | 'payment_terms'
      | 'delivery_period_days'
      | 'notes'
    >
  >;
};

export type TokenValidationResult =
  | {
      ok: true;
      rfqId: string;
      vendorId: string;
      invitationId: string;
      expired: false;
      alreadySubmitted: boolean;
      rfq: PublicRfqShape;
    }
  | { ok: false; reason: 'invalid' | 'expired' };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate an RFQ invitation access token and return the RFQ data needed
 * to render the vendor portal page.
 *
 * Uses 3 sequential queries to avoid Supabase's nested-join type limitations:
 *   1. rfq_invitations — fetch invitation row by access_token
 *   2. rfqs + projects + vendors — fetch linked RFQ, project name, vendor name
 *   3. rfq_items — fetch line items
 *   4. rfq_quotes (conditional) — only if already submitted
 */
export async function validateToken(token: string): Promise<TokenValidationResult> {
  const op = '[validateToken]';

  // Fast reject: not a UUID → skip DB round-trip
  if (!UUID_RE.test(token)) return { ok: false, reason: 'invalid' };

  try {
    const supabase = createAdminClient();

    // ── 1. Invitation ──────────────────────────────────────────────────────
    const { data: invitation, error: invErr } = await supabase
      .from('rfq_invitations')
      .select(
        'id, rfq_id, vendor_id, status, expires_at, submitted_at, viewed_at',
      )
      .eq('access_token', token)
      .maybeSingle();

    if (invErr) {
      console.error(`${op} invitation query failed`, { token, error: invErr });
      return { ok: false, reason: 'invalid' };
    }
    if (!invitation) return { ok: false, reason: 'invalid' };

    // Explicit expiry check (DB index guarantees token uniqueness)
    if (new Date(invitation.expires_at) < new Date()) {
      return { ok: false, reason: 'expired' };
    }

    const alreadySubmitted = invitation.status === 'submitted';

    // ── 2. RFQ + Project name + Vendor name ────────────────────────────────
    const { data: rfqRow, error: rfqErr } = await supabase
      .from('rfqs')
      .select('id, rfq_number, deadline, notes, project_id, created_by')
      .eq('id', invitation.rfq_id)
      .single();

    if (rfqErr || !rfqRow) {
      console.error(`${op} rfq query failed`, { rfqId: invitation.rfq_id, error: rfqErr });
      return { ok: false, reason: 'invalid' };
    }

    // Project name (customer_name used as friendly label)
    const { data: projectRow, error: projErr } = await supabase
      .from('projects')
      .select('id, customer_name')
      .eq('id', rfqRow.project_id)
      .single();

    if (projErr || !projectRow) {
      console.error(`${op} project query failed`, { projectId: rfqRow.project_id, error: projErr });
      return { ok: false, reason: 'invalid' };
    }

    // Vendor name
    const { data: vendorRow, error: vendorErr } = await supabase
      .from('vendors')
      .select('id, company_name')
      .eq('id', invitation.vendor_id)
      .single();

    if (vendorErr || !vendorRow) {
      console.error(`${op} vendor query failed`, { vendorId: invitation.vendor_id, error: vendorErr });
      return { ok: false, reason: 'invalid' };
    }

    // ── 3. RFQ items ───────────────────────────────────────────────────────
    const { data: items, error: itemsErr } = await supabase
      .from('rfq_items')
      .select('id, quantity, item_description, unit, item_category')
      .eq('rfq_id', invitation.rfq_id);

    if (itemsErr) {
      console.error(`${op} items query failed`, { rfqId: invitation.rfq_id, error: itemsErr });
      return { ok: false, reason: 'invalid' };
    }

    // ── 4. Submitted quotes (only if already submitted) ────────────────────
    let submittedQuotes: PublicRfqShape['submittedQuotes'];
    if (alreadySubmitted) {
      const { data: quotes, error: quotesErr } = await supabase
        .from('rfq_quotes')
        .select(
          'rfq_item_id, unit_price, gst_rate, total_price, payment_terms, delivery_period_days, notes',
        )
        .eq('rfq_invitation_id', invitation.id);

      if (quotesErr) {
        console.error(`${op} quotes query failed`, { invitationId: invitation.id, error: quotesErr });
        // Non-fatal — show the already-submitted state without quote detail
      }
      submittedQuotes = quotes ?? [];
    }

    return {
      ok: true,
      rfqId: invitation.rfq_id,
      vendorId: invitation.vendor_id,
      invitationId: invitation.id,
      expired: false,
      alreadySubmitted,
      rfq: {
        rfqId: invitation.rfq_id,
        rfqNumber: rfqRow.rfq_number,
        projectName: projectRow.customer_name,
        deadline: rfqRow.deadline,
        notes: rfqRow.notes,
        vendorName: vendorRow.company_name,
        items: items ?? [],
        submittedQuotes,
      },
    };
  } catch (e) {
    console.error(`${op} threw`, {
      token,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: 'invalid' };
  }
}

// Re-export the RFQ row type so vendor-portal-actions.ts can reference it
// without touching the DB type directly
export type { RfqInvitationRow, RfqRow };
