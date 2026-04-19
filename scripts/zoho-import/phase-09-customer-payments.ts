// scripts/zoho-import/phase-09-customer-payments.ts
// Customer_Payment.xls → customer_payments table (ONE DB ROW PER XLS ROW).
//
// Customer_Payment.xls is ALREADY per-allocation: one row per invoice the parent
// CustomerPayment was split across. Prior versions of this phase deduped by
// `CustomerPayment ID` (the parent) and dropped 99% of the allocation detail
// (1197 rows → 7 imports). Re-architecture (Apr 19 2026):
//
//   Dedupe key = `InvoicePayment ID` (each allocation is unique)
//   Stored in  = `customer_payments.zoho_customer_payment_id` (UNIQUE)
//   Amount     = `Amount Applied to Invoice` (per-allocation amount)
//   Link       = `Invoice Number` → `invoices.invoice_number` = 'ZHI/' + number
//   Project    = inherited from linked invoice; fallback to customer name
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { mapPaymentMode } from './normalize';

interface ZohoCustPayRow {
  'CustomerPayment ID': string | null;
  'InvoicePayment ID': string | null;
  'Payment Number': string | null;
  'Date': unknown;
  'Customer Name': string | null;
  'CustomerID': string | null;
  'Amount': string | number | null;
  'Amount Applied to Invoice': string | number | null;
  'Mode': string | null;
  'Reference Number': string | null;
  'Description': string | null;
  'Invoice Number': string | null;
  'Payment Type': string | null;
}

export async function runPhase09(): Promise<PhaseResult> {
  const result = emptyResult('09-customer-payments');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoCustPayRow>('Customer_Payment.xls');
  console.log(`  ${rows.length} rows in Customer_Payment.xls (one DB row per XLS row)`);

  // Invoice lookup by prefixed invoice number → ERP id + project_id.
  const { data: invoices } = await admin
    .from('invoices')
    .select('id, project_id, invoice_number')
    .like('invoice_number', 'ZHI/%');
  const invoiceByNumber = new Map<string, { id: string; project_id: string | null }>();
  for (const inv of invoices ?? []) {
    invoiceByNumber.set(inv.invoice_number, { id: inv.id, project_id: inv.project_id });
  }

  // Project fallback: customer name → project.
  const { data: erpProjects } = await admin
    .from('projects')
    .select('id, customer_name');
  const projByCust = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    projByCust.set(p.customer_name.toLowerCase().trim(), p.id);
  }

  // Idempotency: skip InvoicePayment IDs already imported.
  const { data: existing } = await admin
    .from('customer_payments')
    .select('zoho_customer_payment_id')
    .not('zoho_customer_payment_id', 'is', null);
  const existingIds = new Set(
    (existing ?? []).map(r => r.zoho_customer_payment_id as string | null).filter((x): x is string => x != null)
  );

  let linkedToInvoice = 0;
  let linkedByCustomer = 0;
  let skippedNoProject = 0;
  let skippedBlankId = 0;

  for (const r of rows) {
    const invPayId = toStr(r['InvoicePayment ID']);
    if (!invPayId) { skippedBlankId++; result.skipped++; continue; }
    if (existingIds.has(invPayId)) { result.skipped++; continue; }

    const rawInvNum = toStr(r['Invoice Number']);
    const lookupKey = rawInvNum ? `ZHI/${rawInvNum}` : null;
    const invoice = lookupKey ? invoiceByNumber.get(lookupKey) : undefined;

    let projectId: string | null = null;
    let invoiceId: string | null = null;

    if (invoice) {
      invoiceId = invoice.id;
      projectId = invoice.project_id;
      linkedToInvoice++;
    }

    if (!projectId) {
      const custName = (toStr(r['Customer Name']) ?? '').toLowerCase().trim();
      if (custName && projByCust.has(custName)) {
        projectId = projByCust.get(custName)!;
        linkedByCustomer++;
      }
    }

    if (!projectId) skippedNoProject++;

    const amount = toNumber(r['Amount Applied to Invoice']);
    if (amount <= 0) { result.skipped++; continue; }

    // receipt_number is UNIQUE; use the InvoicePayment ID as the suffix so each
    // allocation gets a distinct identifier even when they share a parent Payment Number.
    const receiptNum = `ZHI/${toStr(r['Payment Number']) ?? 'P'}/${invPayId}`;

    const isAdvance = !invoiceId; // no linked invoice → treat as advance
    const paymentDate = toDateISO(r['Date']) ?? '2023-01-01';

    const row = {
      project_id: projectId,
      invoice_id: invoiceId,
      recorded_by: systemId,
      receipt_number: receiptNum,
      amount,
      payment_date: paymentDate,
      payment_method: mapPaymentMode(toStr(r['Mode'])),
      payment_reference: toStr(r['Reference Number']),
      is_advance: isAdvance,
      notes: toStr(r['Description']),
      source: 'zoho_import',
      zoho_customer_payment_id: invPayId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('customer_payments').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; }
      result.errors.push({ row: 0, reason: `${invPayId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
    }
  }

  console.log(`  Linked via invoice: ${linkedToInvoice}, via customer name: ${linkedByCustomer}, NULL project (kept): ${skippedNoProject}, skipped blank-id: ${skippedBlankId}`);
  if (dryRun) console.log(`  DRY RUN: would process ${rows.length} customer payments`);
  return result;
}
