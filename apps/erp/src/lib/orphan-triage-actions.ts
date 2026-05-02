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

// ── Exclude actions ──

export async function excludeInvoice(
  invoiceId: string,
  notes: string,
): Promise<ActionResult<{ cascadedPaymentCount: number }>> {
  const op = '[excludeInvoice]';
  if (!notes || notes.trim().length === 0) {
    return err('Notes required for exclude', 'notes_required');
  }
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('exclude_orphan_invoice', {
    p_invoice_id: invoiceId,
    p_made_by: auth.data.employeeId,
    p_notes: notes,
  });
  if (error) {
    console.error(`${op} RPC failed`, { invoiceId, error });
    return err(error.message, error.code);
  }
  const row = (data as any)?.[0];
  if (!row?.success) {
    return err(`Cannot exclude — ${row?.code ?? 'unknown'}`, row?.code);
  }
  postSuccess();
  return ok({ cascadedPaymentCount: Number(row.cascaded_payment_count ?? 0) });
}

export async function excludePayment(
  paymentId: string,
  notes: string,
): Promise<ActionResult<void>> {
  const op = '[excludePayment]';
  if (!notes || notes.trim().length === 0) {
    return err('Notes required for exclude', 'notes_required');
  }
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data: pay, error: fetchErr } = await supabase
    .from('customer_payments')
    .select('id, source, attribution_status')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !pay) return err('Payment not found', 'not_found');
  if (pay.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (pay.attribution_status === 'excluded') return err('Already excluded', 'already_excluded');

  const { error: upErr } = await supabase
    .from('customer_payments')
    .update({ excluded_from_cash: true, attribution_status: 'excluded' })
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
      decision: 'exclude',
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

// ── Defer actions ──

export async function deferInvoice(
  invoiceId: string,
  notes: string | null,
): Promise<ActionResult<void>> {
  const op = '[deferInvoice]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data: inv, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, source, attribution_status')
    .eq('id', invoiceId)
    .single();
  if (fetchErr || !inv) return err('Invoice not found', 'not_found');
  if (inv.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (inv.attribution_status !== 'pending') return err('Cannot defer non-pending row', 'wrong_state');

  const { error: upErr } = await supabase
    .from('invoices')
    .update({ attribution_status: 'deferred' })
    .eq('id', invoiceId);
  if (upErr) {
    console.error(`${op} update failed`, { invoiceId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: 'invoice',
      entity_id: invoiceId,
      decision: 'skip',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) {
    console.error(`${op} audit insert failed`, { invoiceId, error: auditErr });
    return err(auditErr.message, auditErr.code);
  }
  postSuccess();
  return ok(undefined);
}

export async function deferPayment(
  paymentId: string,
  notes: string | null,
): Promise<ActionResult<void>> {
  const op = '[deferPayment]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data: pay, error: fetchErr } = await supabase
    .from('customer_payments')
    .select('id, source, attribution_status')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !pay) return err('Payment not found', 'not_found');
  if (pay.source !== 'zoho_import') return err('Not a Zoho import row', 'not_zoho_import');
  if (pay.attribution_status !== 'pending') return err('Cannot defer non-pending row', 'wrong_state');

  const { error: upErr } = await supabase
    .from('customer_payments')
    .update({ attribution_status: 'deferred' })
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
      decision: 'skip',
      made_by: auth.data.employeeId,
      notes,
    });
  if (auditErr) return err(auditErr.message, auditErr.code);
  postSuccess();
  return ok(undefined);
}

// ── Reassign action ──

export async function reassignInvoice(
  invoiceId: string,
  newProjectId: string,
  notes: string | null,
): Promise<ActionResult<{ cascadedPaymentCount: number }>> {
  const op = '[reassignInvoice]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reassign_orphan_invoice', {
    p_invoice_id: invoiceId,
    p_new_project_id: newProjectId,
    p_made_by: auth.data.employeeId,
    p_notes: notes as string,
  });
  if (error) {
    console.error(`${op} RPC failed`, { invoiceId, newProjectId, error });
    return err(error.message, error.code);
  }
  const row = (data as any)?.[0];
  if (!row?.success) {
    return err(`Cannot reassign — ${row?.code ?? 'unknown'}`, row?.code);
  }
  postSuccess();
  return ok({ cascadedPaymentCount: Number(row.cascaded_payment_count ?? 0) });
}

// ── Undo actions ──

export async function undoExclude(
  entityType: 'invoice' | 'payment',
  entityId: string,
): Promise<ActionResult<void>> {
  const op = '[undoExclude]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const table = entityType === 'invoice' ? 'invoices' : 'customer_payments';

  const { error: upErr } = await supabase
    .from(table as any)
    .update({ excluded_from_cash: false, attribution_status: 'pending' })
    .eq('id', entityId);
  if (upErr) {
    console.error(`${op} update failed`, { entityType, entityId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      decision: 'undo_exclude',
      made_by: auth.data.employeeId,
      notes: null,
    });
  if (auditErr) return err(auditErr.message, auditErr.code);

  // For invoices, undo also cascades to linked payments.
  if (entityType === 'invoice') {
    const { error: cascadeErr } = await supabase
      .from('customer_payments')
      .update({ excluded_from_cash: false, attribution_status: 'pending' })
      .eq('invoice_id', entityId)
      .eq('excluded_from_cash', true);
    if (cascadeErr) {
      console.error(`${op} cascade undo failed`, { entityId, error: cascadeErr });
      // Non-fatal — primary update succeeded.
    }
  }

  postSuccess();
  return ok(undefined);
}

export async function undoDefer(
  entityType: 'invoice' | 'payment',
  entityId: string,
): Promise<ActionResult<void>> {
  const op = '[undoDefer]';
  const auth = await requireTriageRole();
  if (!auth.success) return auth;
  const supabase = await createClient();
  const table = entityType === 'invoice' ? 'invoices' : 'customer_payments';

  const { error: upErr } = await supabase
    .from(table as any)
    .update({ attribution_status: 'pending' })
    .eq('id', entityId);
  if (upErr) {
    console.error(`${op} update failed`, { entityType, entityId, error: upErr });
    return err(upErr.message, upErr.code);
  }
  const { error: auditErr } = await supabase
    .from('zoho_attribution_audit')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      decision: 'undo_skip',
      made_by: auth.data.employeeId,
      notes: null,
    });
  if (auditErr) return err(auditErr.message, auditErr.code);
  postSuccess();
  return ok(undefined);
}
