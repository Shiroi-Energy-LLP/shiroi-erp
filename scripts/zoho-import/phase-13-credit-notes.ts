// scripts/zoho-import/phase-13-credit-notes.ts
// Credit_Note.xls → invoice_credit_notes (read-only backfill)
// 15 rows expected. invoice_credit_notes NOT NULL:
//   invoice_id (FK to invoices), project_id, raised_by,
//   credit_note_number, reason, credit_amount, gst_amount, total_credit, credit_note_date
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoCNRow {
  'CreditNotes ID': string | null;
  'Credit Note Number': string | null;
  'Credit Note Date': unknown;
  'Customer Name': string | null;
  'SubTotal': string | number | null;
  'Total': string | number | null;
  'Status': string | null;
  'Reference Invoice Number': string | null;
}

export async function runPhase13(): Promise<PhaseResult> {
  const result = emptyResult('13-credit-notes');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoCNRow>('Credit_Note.xls');

  // De-duplicate by CreditNotes ID
  const seen = new Map<string, ZohoCNRow>();
  for (const r of rows) {
    const id = toStr(r['CreditNotes ID']);
    if (id && !seen.has(id)) seen.set(id, r);
  }
  console.log(`  ${rows.length} rows → ${seen.size} unique credit notes`);

  // Idempotency
  const { data: existing } = await admin
    .from('invoice_credit_notes')
    .select('zoho_credit_note_id')
    .not('zoho_credit_note_id', 'is', null);
  const existingIds = new Set((existing ?? []).map(r => r.zoho_credit_note_id as string | null).filter((x): x is string => x != null));

  // Load projects by customer name
  const { data: erpProjects } = await admin.from('projects').select('id, customer_name');
  const projByCust = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    projByCust.set(p.customer_name.toLowerCase().trim(), p.id);
  }

  // Load invoices by ZHI/ prefix number
  const { data: erpInvoices } = await admin
    .from('invoices')
    .select('id, project_id, invoice_number')
    .like('invoice_number', 'ZHI/%');
  const invoiceByNum = new Map<string, { id: string; project_id: string }>();
  for (const inv of erpInvoices ?? []) {
    // strip ZHI/ prefix for matching
    const raw = inv.invoice_number.replace(/^ZHI\//, '');
    invoiceByNum.set(raw.toLowerCase().trim(), { id: inv.id, project_id: inv.project_id });
  }

  for (const [zohoCnId, r] of seen.entries()) {
    if (existingIds.has(zohoCnId)) { result.skipped++; continue; }

    const custName = (toStr(r['Customer Name']) ?? '').toLowerCase().trim();
    const refInvNum = (toStr(r['Reference Invoice Number']) ?? '').toLowerCase().trim();

    // Find related invoice
    const invMatch = refInvNum ? invoiceByNum.get(refInvNum) : null;
    const projectId = invMatch?.project_id ?? projByCust.get(custName);

    if (!projectId) { result.skipped++; continue; }

    const invoiceId = invMatch?.id;
    if (!invoiceId) { result.skipped++; continue; } // credit notes without invoice link skipped

    const subtotal = toNumber(r['SubTotal']);
    const total = toNumber(r['Total']);

    const row = {
      invoice_id: invoiceId,
      project_id: projectId,
      raised_by: systemId,
      credit_note_number: `ZHI/${toStr(r['Credit Note Number']) ?? zohoCnId}`,
      reason: 'Zoho import — historical credit note',
      credit_amount: subtotal,
      gst_amount: total - subtotal,
      total_credit: total,
      credit_note_date: toDateISO(r['Credit Note Date']) ?? '2023-01-01',
      source: 'zoho_import',
      zoho_credit_note_id: zohoCnId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('invoice_credit_notes').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; }
      result.errors.push({ row: 0, reason: `${zohoCnId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
    }
  }

  if (dryRun) console.log(`  DRY RUN: would process ${seen.size} credit notes`);
  return result;
}
