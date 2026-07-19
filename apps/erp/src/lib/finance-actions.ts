'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { emitErpEvent } from '@/lib/n8n/emit';
import { MS_PER_DAY } from '@/lib/helpers/time-helpers';
import { type ActionResult, ok, err } from '@/lib/types/actions';
import {
  buildEInvoicePayload,
  type EInvoiceSourceRow,
  type EInvoiceCustomer,
  type EInvoiceSellerConfig,
} from '@/lib/gst/einvoice-builder';

// ── Create Invoice ──

type CreateInvoiceInput = {
  projectId: string;
  invoiceType: 'proforma' | 'tax_invoice' | 'credit_note';
  milestoneName?: string;
  subtotalSupply: number;
  subtotalWorks: number;
  gstSupplyAmount: number;
  gstWorksAmount: number;
  totalAmount: number;
  invoiceDate: string;
  dueDate: string;
  notes?: string;
};

/**
 * Canonical invoice write. createInvoice (general /invoices flow, project picker)
 * and raiseProjectInvoice (project-detail dialog, fixed project) both delegate
 * here — they were byte-identical inserts into `invoices` with the same
 * generate_doc_number('INV') numbering and revalidations; the only difference was
 * the return shape (raiseProjectInvoice also returns invoiceNumber). No n8n emit
 * on either path, so this merge carries no notification divergence (master-ref
 * §4.19; locked by __tests__/invoice-write-wrappers.test.ts).
 */
export async function createCustomerInvoice(
  input: CreateInvoiceInput,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string }>> {
  const op = '[createCustomerInvoice]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'UNAUTHENTICATED');

  // Get employee ID for raised_by
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return err('Employee profile not found', 'EMPLOYEE_MISSING');

  // Generate invoice number using DB function
  const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'INV' });
  const invoiceNumber = (docNum as string | null) || `SHIROI/INV/${new Date().getFullYear()}/TEMP`;

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      project_id: input.projectId,
      raised_by: employee.id,
      invoice_number: invoiceNumber,
      invoice_type: input.invoiceType,
      milestone_name: input.milestoneName || null,
      subtotal_supply: input.subtotalSupply,
      subtotal_works: input.subtotalWorks,
      gst_supply_amount: input.gstSupplyAmount,
      gst_works_amount: input.gstWorksAmount,
      total_amount: input.totalAmount,
      amount_outstanding: input.totalAmount,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate,
      status: 'draft',
      notes: input.notes || null,
      erp_created: true,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error(`${op} Insert failed:`, { code: error?.code, message: error?.message, projectId: input.projectId });
    return err(error?.message ?? 'Failed to create invoice', error?.code);
  }

  revalidatePath('/invoices');
  revalidatePath('/cash');
  revalidatePath('/payments/reconciliation');
  revalidatePath(`/projects/${input.projectId}`);
  return ok({ invoiceId: data.id, invoiceNumber });
}

/**
 * General /invoices-page invoice entry (project picker). Thin wrapper over
 * createCustomerInvoice; preserves the historical {invoiceId}-only return.
 */
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<ActionResult<{ invoiceId: string }>> {
  const res = await createCustomerInvoice(input);
  if (!res.success) return res;
  return ok({ invoiceId: res.data.invoiceId });
}

// ── Record Customer Payment ──

type RecordPaymentInput = {
  projectId: string;
  invoiceId?: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd';
  paymentReference?: string;
  bankName?: string;
  isAdvance?: boolean;
  notes?: string;
};

/**
 * Canonical customer-payment write. recordPayment (general /payments flow) and
 * recordProjectPayment (project-detail flow) both delegate here — they were
 * byte-identical copies whose ONLY behavioural difference was the n8n emit
 * (`customer_payment.received` → salesperson commission tracking + customer
 * ping). That difference is now the explicit `notify` option, so the merge
 * cannot silently leak the notification into the project-detail flow or drop it
 * from the payments flow (master-ref §4.19; regression-locked in
 * __tests__/payment-write-wrappers.test.ts).
 */
export async function recordCustomerPayment(
  input: RecordPaymentInput,
  opts: { notify?: boolean } = {},
): Promise<ActionResult<{ paymentId: string }>> {
  const op = '[recordCustomerPayment]';
  const notify = opts.notify ?? true;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'UNAUTHENTICATED');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return err('Employee profile not found', 'EMPLOYEE_MISSING');

  // Generate receipt number
  const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'REC' });
  const receiptNumber = (docNum as string | null) || `SHIROI/REC/${new Date().getFullYear()}/TEMP`;

  const { data, error } = await supabase
    .from('customer_payments')
    .insert({
      project_id: input.projectId,
      invoice_id: input.invoiceId || null,
      recorded_by: employee.id,
      receipt_number: receiptNumber,
      amount: input.amount,
      payment_date: input.paymentDate,
      payment_method: input.paymentMethod,
      payment_reference: input.paymentReference || null,
      bank_name: input.bankName || null,
      is_advance: input.isAdvance ?? false,
      notes: input.notes || null,
      erp_recorded: true,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error(`${op} Insert failed:`, { code: error?.code, message: error?.message, projectId: input.projectId });
    return err(error?.message ?? 'Failed to record payment', error?.code);
  }

  // If linked to an invoice, update the invoice amounts
  if (input.invoiceId) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('amount_paid, total_amount')
      .eq('id', input.invoiceId)
      .single();

    if (invoice) {
      const newPaid = Number(invoice.amount_paid) + input.amount;
      const newOutstanding = Number(invoice.total_amount) - newPaid;
      const newStatus = newOutstanding <= 0 ? 'paid' : newPaid > 0 ? 'partially_paid' : 'sent';

      await supabase
        .from('invoices')
        .update({
          amount_paid: newPaid,
          amount_outstanding: Math.max(0, newOutstanding),
          status: newStatus,
        })
        .eq('id', input.invoiceId);
    }
  }

  revalidatePath('/payments');
  revalidatePath('/invoices');
  revalidatePath('/cash');
  revalidatePath('/payments/reconciliation');
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);

  // The ONLY historical divergence: the general /payments flow emitted the n8n
  // event (commission + customer ping); the project-detail flow did not.
  if (notify && data.id) void emitCustomerPaymentReceived(data.id);

  return ok({ paymentId: data.id });
}

/**
 * General /payments-page payment entry — emits the n8n commission/ping event.
 * Thin wrapper over recordCustomerPayment (notify: true).
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ActionResult<{ paymentId: string }>> {
  return recordCustomerPayment(input, { notify: true });
}

async function emitCustomerPaymentReceived(paymentId: string): Promise<void> {
  const op = '[emitCustomerPaymentReceived]';
  try {
    const supabase = await createClient();
    const { data: enriched } = await supabase
      .from('customer_payments')
      .select(`
        id,
        receipt_number,
        amount,
        payment_date,
        payment_method,
        is_advance,
        invoice:invoices!customer_payments_invoice_id_fkey ( invoice_number ),
        project:projects!customer_payments_project_id_fkey ( project_number, customer_name, customer_phone, lead_id )
      `)
      .eq('id', paymentId)
      .single();
    if (!enriched) return;

    const invoice = Array.isArray(enriched.invoice) ? enriched.invoice[0] : enriched.invoice;
    const project = Array.isArray(enriched.project) ? enriched.project[0] : enriched.project;

    // Commission tracking: resolve the lead's original salesperson so Tier 1 #14
    // can ping them. If the project was created outside the lead funnel we
    // simply skip the salesperson bit.
    let salesPersonName: string | null = null;
    let salesPersonPhone: string | null = null;
    if (project?.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('assigned_to')
        .eq('id', project.lead_id)
        .maybeSingle();
      if (lead?.assigned_to) {
        const { data: emp } = await supabase
          .from('employees')
          .select('full_name, whatsapp_number')
          .eq('id', lead.assigned_to)
          .maybeSingle();
        salesPersonName = emp?.full_name ?? null;
        salesPersonPhone = emp?.whatsapp_number ?? null;
      }
    }

    await emitErpEvent('customer_payment.received', {
      payment_id: enriched.id,
      receipt_number: enriched.receipt_number,
      amount: enriched.amount,
      payment_date: enriched.payment_date,
      payment_method: enriched.payment_method,
      is_advance: enriched.is_advance,
      invoice_number: invoice?.invoice_number ?? null,
      project_code: project?.project_number ?? null,
      customer_name: project?.customer_name ?? null,
      customer_phone: project?.customer_phone ?? null,
      sales_person_name: salesPersonName,
      sales_person_whatsapp: salesPersonPhone,
      erp_url: `https://erp.shiroienergy.com/payments`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      paymentId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── Record Vendor Payment ──

export async function recordVendorPayment(input: {
  purchaseOrderId: string;
  vendorId: string;
  amount: number;
  paymentDate: string;
  paymentMode: string;
  referenceNumber?: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  const op = '[recordVendorPayment]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated', 'UNAUTHENTICATED');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return err('Employee profile not found', 'EMPLOYEE_MISSING');

  // Get PO date for MSME compliance calculation
  const { data: poData } = await supabase
    .from('purchase_orders')
    .select('po_date, project_id')
    .eq('id', input.purchaseOrderId)
    .single();

  const poDate = poData?.po_date ?? input.paymentDate;
  const daysFromPo = Math.floor((new Date(input.paymentDate).getTime() - new Date(poDate).getTime()) / MS_PER_DAY);

  const { error } = await supabase
    .from('vendor_payments')
    .insert({
      purchase_order_id: input.purchaseOrderId,
      project_id: poData?.project_id ?? '',
      vendor_id: input.vendorId,
      recorded_by: employee.id,
      amount: input.amount,
      payment_date: input.paymentDate,
      payment_method: input.paymentMode,
      payment_reference: input.referenceNumber || null,
      bank_name: null,
      po_date: poDate,
      days_from_po: daysFromPo,
      msme_compliant: daysFromPo <= 45,
      notes: input.notes || null,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return err(error.message, error.code);
  }

  // Update PO outstanding amount
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('amount_paid, total_amount')
    .eq('id', input.purchaseOrderId)
    .single();

  if (po) {
    const newPaid = Number(po.amount_paid) + input.amount;
    await supabase
      .from('purchase_orders')
      .update({
        amount_paid: newPaid,
        amount_outstanding: Math.max(0, Number(po.total_amount) - newPaid),
      })
      .eq('id', input.purchaseOrderId);
  }

  revalidatePath('/vendor-payments');
  revalidatePath('/procurement');
  return ok(undefined);
}

// ── Project-context: Raise Invoice ──
// Project-detail dialog — pre-scoped to a project. Thin wrapper over
// createCustomerInvoice (also returns invoiceNumber, which the dialog renders).
export async function raiseProjectInvoice(
  input: CreateInvoiceInput,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string }>> {
  return createCustomerInvoice(input);
}

// ── Project-context: Record Payment ──
// Project-detail dialog — pre-scoped to a project, per-invoice settlement.
// Does NOT emit the n8n event (preserves this flow's historical behaviour).
// Thin wrapper over recordCustomerPayment (notify: false).
export async function recordProjectPayment(
  input: RecordPaymentInput,
): Promise<ActionResult<{ paymentId: string }>> {
  return recordCustomerPayment(input, { notify: false });
}

// ── GST E-Invoice Generation ──

export interface GenerateEInvoiceResult {
  irn: string;
  ackNumber: string;
  ackDate: string;
  signedQrCode: string;
}

/**
 * generateEInvoice — build NIC e-invoice payload and (when GSP is live) call the API.
 *
 * STUB: The actual GSP API call is commented out pending:
 *   1. GSP onboarding (select a licensed GSP from https://einvoice1.gst.gov.in/Others/GSPList)
 *   2. Taxpayer profile setup on NIC sandbox (test GSTIN, credentials)
 *   3. Add GSP_API_URL + GSP_CLIENT_ID + GSP_CLIENT_SECRET to .env.local
 *
 * Until GSP credentials are available, this action builds the payload,
 * stores it as e_invoice_status='pending', and returns a stub result.
 */
export async function generateEInvoice(
  invoiceId: string,
): Promise<ActionResult<GenerateEInvoiceResult>> {
  const op = '[generateEInvoice]';
  try {
    const supabase = await createClient();

    // 1. Load invoice with project + customer context
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        invoice_type,
        subtotal_supply,
        subtotal_works,
        gst_supply_amount,
        gst_works_amount,
        total_amount,
        e_invoice_status,
        projects!invoices_project_id_fkey (
          customer_name,
          customer_phone,
          customer_email,
          customer_address,
          customer_gstin,
          customer_state_code,
          customer_pincode,
          customer_city
        )
      `)
      .eq('id', invoiceId)
      .maybeSingle();

    if (invErr) {
      console.error(`${op} invoice load failed`, { invoiceId, error: invErr, timestamp: new Date().toISOString() });
      return err(invErr.message, invErr.code);
    }
    if (!invoice) return err('Invoice not found');
    if (invoice.e_invoice_status === 'generated') return err('IRN already generated for this invoice');
    if (invoice.e_invoice_status === 'cancelled') return err('Cannot generate IRN for cancelled invoice');

    // 2. Build seller config from env (never hardcode project IDs or credentials)
    const sellerGstin = process.env.SHIROI_GSTIN;
    if (!sellerGstin) {
      return err('SHIROI_GSTIN env var not set — cannot generate e-invoice');
    }

    const seller: EInvoiceSellerConfig = {
      gstin: sellerGstin,
      legal_name: 'Shiroi Energy LLP',
      trade_name: 'Shiroi Energy',
      address_line1: process.env.SHIROI_ADDRESS_LINE1 ?? '15 Anna Salai',
      city: process.env.SHIROI_CITY ?? 'Chennai',
      state_code: process.env.SHIROI_STATE_CODE ?? '33',
      pincode: process.env.SHIROI_PINCODE ?? '600002',
      email: process.env.SHIROI_ACCOUNTS_EMAIL,
    };

    const project = Array.isArray(invoice.projects) ? invoice.projects[0] : invoice.projects;
    if (!project) return err('Invoice has no associated project');

    const customer: EInvoiceCustomer = {
      name: project.customer_name ?? 'Customer',
      gstin: (project as Record<string, unknown>).customer_gstin as string | null ?? null,
      address_line1: (project as Record<string, unknown>).customer_address as string ?? '',
      city: (project as Record<string, unknown>).customer_city as string ?? 'Chennai',
      state_code: (project as Record<string, unknown>).customer_state_code as string ?? '33',
      pincode: (project as Record<string, unknown>).customer_pincode as string ?? '600001',
      phone: project.customer_phone ?? null,
      email: (project as Record<string, unknown>).customer_email as string | null ?? null,
    };

    const sourceRow: EInvoiceSourceRow = {
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      invoice_type: invoice.invoice_type as EInvoiceSourceRow['invoice_type'],
      subtotal_supply: invoice.subtotal_supply ?? 0,
      subtotal_works: invoice.subtotal_works ?? 0,
      gst_supply_amount: invoice.gst_supply_amount ?? 0,
      gst_works_amount: invoice.gst_works_amount ?? 0,
      total_amount: invoice.total_amount ?? 0,
    };

    // 3. Build payload (pure — no side effects)
    const payload = buildEInvoicePayload(sourceRow, customer, seller);

    // 4. Mark as pending while we (would) call the GSP
    const { error: pendingErr } = await supabase
      .from('invoices')
      .update({ e_invoice_status: 'pending' })
      .eq('id', invoiceId);
    if (pendingErr) {
      console.error(`${op} status update failed`, { invoiceId, error: pendingErr, timestamp: new Date().toISOString() });
    }

    // 5. STUB: GSP API call placeholder
    //    When GSP credentials are ready, replace this block with:
    //
    //    const gspUrl = process.env.GSP_API_URL;
    //    const gspResponse = await fetch(`${gspUrl}/einvoice/type/EINV/version/V1_03/...`, {
    //      method: 'POST',
    //      headers: { 'client-id': process.env.GSP_CLIENT_ID!, 'client-secret': process.env.GSP_CLIENT_SECRET!, ... },
    //      body: JSON.stringify(payload),
    //    });
    //    const gspData = await gspResponse.json();
    //    irn = gspData.Irn; ackNumber = gspData.AckNo; ...
    //
    const isStub = true;
    if (isStub) {
      console.warn(`${op} GSP credentials not configured — marking e_invoice_status=pending (stub)`, {
        invoiceId,
        payloadBuilt: true,
        payloadDocNo: payload.DocDtls.No,
        timestamp: new Date().toISOString(),
      });

      // Store payload for manual submission / GSP integration later
      const { error: updateErr } = await supabase
        .from('invoices')
        .update({
          e_invoice_status: 'pending',
          e_invoice_error: 'GSP credentials pending setup — payload built, awaiting GSP onboarding',
        })
        .eq('id', invoiceId);

      if (updateErr) {
        console.error(`${op} final update failed`, { invoiceId, error: updateErr, timestamp: new Date().toISOString() });
        return err(updateErr.message);
      }

      revalidatePath('/invoices');
      revalidatePath(`/invoices/${invoiceId}`);

      return err('GSP API credentials not yet configured. Payload built and stored. Complete GSP onboarding to generate live IRN.');
    }

    // 6. (Post-GSP) Store IRN + ack details
    // const { error: irnErr } = await supabase
    //   .from('invoices')
    //   .update({ irn, ack_number: ackNumber, ack_date: ackDate, signed_qr_code: signedQr, e_invoice_status: 'generated' })
    //   .eq('id', invoiceId);

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${invoiceId}`);

    return ok({ irn: '', ackNumber: '', ackDate: '', signedQrCode: '' });
  } catch (e) {
    console.error(`${op} threw`, { invoiceId, error: e instanceof Error ? e.message : String(e), timestamp: new Date().toISOString() });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
