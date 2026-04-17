// scripts/zoho-import/phase-09-customer-payments.ts
// Customer_Payment.xls → customer_payments table
// Headers: CustomerPayment ID | Payment Number | Date | Customer Name | Amount | Mode | Reference Number
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { mapPaymentMode } from './normalize';

interface ZohoCustPayRow {
  'CustomerPayment ID': string | null;
  'Payment Number': string | null;
  'Date': unknown;
  'Customer Name': string | null;
  'CustomerID': string | null;
  'Amount': string | number | null;
  'Mode': string | null;
  'Reference Number': string | null;
  'Description': string | null;
}

export async function runPhase09(): Promise<PhaseResult> {
  const result = emptyResult('09-customer-payments');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoCustPayRow>('Customer_Payment.xls');

  // De-duplicate by CustomerPayment ID
  const seen = new Map<string, ZohoCustPayRow>();
  for (const r of rows) {
    const id = toStr(r['CustomerPayment ID']);
    if (id && !seen.has(id)) seen.set(id, r);
  }
  console.log(`  ${rows.length} rows → ${seen.size} unique customer payments`);

  // Load contacts by zoho_contact_id for project lookup fallback
  const { data: erpContacts } = await admin
    .from('contacts')
    .select('id, display_name, zoho_contact_id');
  const contactByZohoId = new Map<string, string>();
  const contactByName = new Map<string, string>();
  for (const c of erpContacts ?? []) {
    if (c.zoho_contact_id) contactByZohoId.set(c.zoho_contact_id, c.id);
    contactByName.set((c.display_name ?? '').toLowerCase().trim(), c.id);
  }

  // Load projects by customer_name for project attribution
  const { data: erpProjects } = await admin
    .from('projects')
    .select('id, customer_name');
  const projByCust = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    projByCust.set(p.customer_name.toLowerCase().trim(), p.id);
  }

  // Idempotency
  const { data: existing } = await admin
    .from('customer_payments')
    .select('zoho_customer_payment_id')
    .not('zoho_customer_payment_id', 'is', null);
  const existingIds = new Set((existing ?? []).map(r => r.zoho_customer_payment_id as string | null).filter((x): x is string => x != null));

  // Get existing receipt numbers to avoid collision
  const { data: existingReceipts } = await admin
    .from('customer_payments')
    .select('receipt_number')
    .like('receipt_number', 'ZHI/%');
  const usedReceipts = new Set((existingReceipts ?? []).map(r => r.receipt_number));

  for (const [zohoId, r] of seen.entries()) {
    if (existingIds.has(zohoId)) { result.skipped++; continue; }

    const custName = (toStr(r['Customer Name']) ?? '').toLowerCase().trim();
    const projectId = projByCust.get(custName);

    if (!projectId) { result.skipped++; continue; }

    const receiptNum = `ZHI/${toStr(r['Payment Number']) ?? zohoId}`;
    if (usedReceipts.has(receiptNum)) { result.skipped++; continue; }

    const row = {
      project_id: projectId,
      recorded_by: systemId,
      receipt_number: receiptNum,
      amount: toNumber(r['Amount']),
      payment_date: toDateISO(r['Date']) ?? '2023-01-01',
      payment_method: mapPaymentMode(toStr(r['Mode'])),
      payment_reference: toStr(r['Reference Number']),
      is_advance: false,
      notes: toStr(r['Description']),
      source: 'zoho_import',
      zoho_customer_payment_id: zohoId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('customer_payments').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; }
      result.errors.push({ row: 0, reason: `${zohoId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
      usedReceipts.add(receiptNum);
    }
  }

  if (dryRun) {
    console.log(`  DRY RUN: would process ${seen.size} customer payments`);
  }
  return result;
}
