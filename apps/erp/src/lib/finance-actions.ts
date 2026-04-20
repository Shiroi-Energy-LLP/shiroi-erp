'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { emitErpEvent } from '@/lib/n8n/emit';

// ── Create Invoice ──

export async function createInvoice(input: {
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
}): Promise<{ success: boolean; error?: string; invoiceId?: string }> {
  const op = '[createInvoice]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID for raised_by
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Generate invoice number using DB function
  const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'INV' });
  const invoiceNumber = docNum || `SHIROI/INV/${new Date().getFullYear()}/TEMP`;

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
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/invoices');
  revalidatePath('/cash');
  return { success: true, invoiceId: data?.id };
}

// ── Record Customer Payment ──

export async function recordPayment(input: {
  projectId: string;
  invoiceId?: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd';
  paymentReference?: string;
  bankName?: string;
  isAdvance?: boolean;
  notes?: string;
}): Promise<{ success: boolean; error?: string; paymentId?: string }> {
  const op = '[recordPayment]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Generate receipt number
  const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'REC' });
  const receiptNumber = docNum || `SHIROI/REC/${new Date().getFullYear()}/TEMP`;

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
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
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

  if (data?.id) void emitCustomerPaymentReceived(data.id);

  return { success: true, paymentId: data?.id };
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
}): Promise<{ success: boolean; error?: string }> {
  const op = '[recordVendorPayment]';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Get PO date for MSME compliance calculation
  const { data: poData } = await supabase
    .from('purchase_orders')
    .select('po_date, project_id')
    .eq('id', input.purchaseOrderId)
    .single();

  const poDate = poData?.po_date ?? input.paymentDate;
  const daysFromPo = Math.floor((new Date(input.paymentDate).getTime() - new Date(poDate).getTime()) / (1000 * 60 * 60 * 24));

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
    return { success: false, error: error.message };
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
  return { success: true };
}
