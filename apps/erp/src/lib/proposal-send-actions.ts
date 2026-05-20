'use server';

/**
 * Server actions for emailing a proposal to a customer.
 *
 * Flow (the simple path):
 *   1. Auth-check (founder + marketing_manager + sales_engineer).
 *   2. Generate / refresh the PDF in proposal-files Storage.
 *   3. Sign a 30-day URL for the PDF.
 *   4. Look up the customer email + segment + amounts from the proposal+lead.
 *   5. Update proposals.sent_to_customer_at + (if draft) status='sent'.
 *   6. Fire `proposal.sent_to_customer` to the n8n event bus — an n8n
 *      workflow (`29-proposal-sent-to-customer.json`) picks it up and
 *      composes/sends Gmail from prem@shiroienergy.com to the customer
 *      with svivek.88@gmail.com CC'd.
 *
 * If N8N_EVENT_BUS_URL is unset, the event call is a silent no-op (see
 * `emitErpEvent`); the action still returns ok and the proposal is marked
 * as sent. Vivek can re-send manually until n8n is wired up.
 */

import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { emitErpEvent } from '@/lib/n8n/emit';

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ALLOWED_ROLES = new Set(['founder', 'marketing_manager', 'sales_engineer']);
const CC_EMAIL = 'svivek.88@gmail.com';
const FROM_EMAIL = 'prem@shiroienergy.com';

export interface SendProposalResult {
  queued: boolean;
  customerEmail: string;
  ccEmail: string;
  pdfSignedUrl: string;
  proposalNumber: string;
}

export async function sendProposalToCustomer(
  proposalId: string,
): Promise<ActionResult<SendProposalResult>> {
  const op = '[sendProposalToCustomer]';
  console.log(`${op} Starting`, { proposalId });

  try {
    if (!proposalId) return err('Missing proposalId');

    const supabase = await createClient();

    // Auth + role check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) return err('Profile not found');
    if (!ALLOWED_ROLES.has(profile.role)) {
      return err('Only founder, marketing_manager, and sales_engineer can send proposals');
    }

    // Load proposal + joined lead.
    // NB: keep the select string as a single literal — string-concat confuses
    // the supabase-js TypeScript inference and makes the row type collapse to
    // GenericStringError.
    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .select(`id, proposal_number, status, current_pdf_storage_path, system_size_kwp, total_after_discount, lead_id, leads!proposals_lead_id_fkey(customer_name, email, phone, segment)`)
      .eq('id', proposalId)
      .maybeSingle();
    if (propErr) return err(propErr.message, propErr.code);
    if (!proposal) return err('Proposal not found');

    const leadRaw = proposal.leads as
      | { customer_name?: string | null; email?: string | null; phone?: string | null; segment?: string | null }
      | { customer_name?: string | null; email?: string | null; phone?: string | null; segment?: string | null }[]
      | null;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] ?? null : leadRaw;
    const customerEmail = lead?.email ?? null;
    const customerName = lead?.customer_name ?? 'Customer';

    if (!customerEmail) {
      return err(`No email on file for ${customerName}. Add an email to the lead before sending.`);
    }

    // Generate / refresh PDF — calls the existing internal route.
    // This is the same route the "Generate PDF" button hits, so we get the
    // SAME exception surface (currently being debugged via instrumented logs).
    let pdfStoragePath = proposal.current_pdf_storage_path as string | null;
    if (!pdfStoragePath) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const genRes = await fetch(`${baseUrl}/api/proposals/${proposalId}/generate-pdf`, {
        method: 'POST',
        headers: { cookie: '' }, // internal call; auth re-checked downstream if needed
      });
      if (!genRes.ok) {
        const body = (await genRes.json().catch(() => ({}))) as { error?: string };
        return err(`PDF generation failed: ${body.error ?? genRes.statusText}`);
      }
      const body = await genRes.json();
      pdfStoragePath = body.storagePath as string;
    }

    if (!pdfStoragePath) {
      return err('PDF storage path is missing after generation');
    }

    // Sign a download URL for the PDF
    const admin = createAdminClient();
    const { data: signed, error: signErr } = await admin.storage
      .from('proposal-files')
      .createSignedUrl(pdfStoragePath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) {
      console.error(`${op} createSignedUrl failed`, { proposalId, pdfStoragePath, signErr });
      return err(`Could not sign PDF URL: ${signErr?.message ?? 'unknown'}`);
    }
    const pdfSignedUrl = signed.signedUrl;

    // Mark proposal as sent (status='sent' if currently 'draft', and set
    // sent_to_customer_at). The column was added in this same commit (see
    // migration); if it doesn't exist on prod yet, the update will fail and
    // we surface the error.
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = { sent_to_customer_at: nowIso };
    if (proposal.status === 'draft') updates.status = 'sent';

    const { error: updErr } = await admin
      .from('proposals')
      .update(updates)
      .eq('id', proposalId);
    if (updErr) {
      console.error(`${op} status update failed`, { proposalId, updErr });
      // Non-fatal; we still want to emit the event and let user know.
    }

    // Fire the event to n8n. Silent no-op if N8N_EVENT_BUS_URL is unset.
    await emitErpEvent('proposal.sent_to_customer', {
      proposal_id:           proposal.id,
      proposal_number:       proposal.proposal_number,
      customer_name:         customerName,
      customer_email:        customerEmail,
      customer_phone:        lead?.phone ?? null,
      segment:               lead?.segment ?? null,
      system_size_kwp:       proposal.system_size_kwp,
      total_after_discount:  proposal.total_after_discount,
      pdf_signed_url:        pdfSignedUrl,
      from_email:            FROM_EMAIL,
      cc_email:              CC_EMAIL,
      sent_by_name:          profile.full_name ?? null,
      sent_by_role:          profile.role,
      sent_at:               nowIso,
    });

    revalidatePath(`/proposals/${proposalId}`);
    if (proposal.lead_id) {
      revalidatePath(`/sales/${proposal.lead_id}`);
      revalidatePath(`/leads/${proposal.lead_id}`);
    }

    console.log(`${op} OK`, {
      proposalId,
      proposalNumber: proposal.proposal_number,
      customerEmail,
    });

    return ok({
      queued: true,
      customerEmail,
      ccEmail: CC_EMAIL,
      pdfSignedUrl,
      proposalNumber: proposal.proposal_number,
    });
  } catch (e) {
    console.error(`${op} unexpected failure`, {
      proposalId,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Unknown failure');
  }
}
