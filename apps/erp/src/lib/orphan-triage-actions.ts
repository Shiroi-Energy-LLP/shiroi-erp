// apps/erp/src/lib/orphan-triage-actions.ts
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

const ALLOWED_ROLES = new Set(['founder', 'finance', 'marketing_manager']);

interface CallerContext {
  employeeId: string;
}

async function requireTriageRole(): Promise<ActionResult<CallerContext>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'unauthenticated');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return err('Forbidden — triage requires founder, finance, or marketing_manager', 'forbidden');
  }
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return err('Employee record not found for current user', 'no_employee');
  return ok({ employeeId: employee.id });
}

function postSuccess() {
  revalidatePath('/cash/orphan-invoices');
  revalidatePath('/cash');
  revalidateTag('orphan-counts');
}

// ── Assign actions ──

export async function assignOrphanInvoice(
  invoiceId: string,
  projectId: string,
  notes: string | null,
): Promise<ActionResult<{ cascadedPaymentCount: number }>> {
  const op = '[assignOrphanInvoice]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('assign_orphan_invoice', {
    p_invoice_id: invoiceId,
    p_project_id: projectId,
    p_made_by: auth.data.employeeId,
    p_notes: notes as string,
  });
  if (error) {
    console.error(`${op} RPC failed`, { invoiceId, projectId, error });
    return err(error.message, error.code);
  }
  const row = (data as any)?.[0];
  if (!row?.success) {
    console.warn(`${op} precondition`, { invoiceId, code: row?.code });
    return err(`Cannot assign — ${row?.code ?? 'unknown'}`, row?.code);
  }
  postSuccess();
  return ok({ cascadedPaymentCount: Number(row.cascaded_payment_count ?? 0) });
}

export async function assignOrphanPayment(
  paymentId: string,
  projectId: string,
  notes: string | null,
): Promise<ActionResult<void>> {
  const op = '[assignOrphanPayment]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();

  // Precondition: payment exists, is zoho_import, attribution_status = pending
  const { data: pay, error: fetchErr } = await supabase
    .from('customer_payments')
    .select('id, source, attribution_status')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !pay) {
    console.error(`${op} not found`, { paymentId, error: fetchErr });
    return err('Payment not found', 'not_found');
  }
  if (pay.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (pay.attribution_status !== 'pending') return err('Already triaged', 'already_triaged');

  const { error: upErr } = await supabase
    .from('customer_payments')
    .update({ project_id: projectId, attribution_status: 'assigned' })
    .eq('id', paymentId);
  if (upErr) {
    console.error(`${op} update failed`, { paymentId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: 'payment',
      entity_id: paymentId,
      to_project_id: projectId,
      decision: 'assign',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) {
    console.error(`${op} audit insert failed`, { paymentId, error: auditErr });
    return err(auditErr.message, auditErr.code);
  }
  postSuccess();
  return ok(undefined);
}
