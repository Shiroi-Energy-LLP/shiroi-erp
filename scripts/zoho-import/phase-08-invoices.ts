// scripts/zoho-import/phase-08-invoices.ts
// Invoice.xls → invoices table
// Invoice.xls has one row per line item; we aggregate to invoice header.
// ERP invoices: project_id (NOT NULL), raised_by (NOT NULL), invoice_number (NOT NULL),
//   invoice_type (NOT NULL), subtotal_supply, subtotal_works, gst_supply_amount,
//   gst_works_amount, total_amount, amount_paid, amount_outstanding, invoice_date,
//   due_date, status
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoInvoiceRow {
  'Invoice ID': string | null;
  'Invoice Number': string | null;
  'Invoice Date': unknown;
  'Due Date': unknown;
  'Invoice Status': string | null;
  'Customer Name': string | null;
  'Customer ID': string | null;
  'Project Name': string | null;
  'SubTotal': string | number | null;
  'Total': string | number | null;
  'Balance': string | number | null;
  'CGST': string | number | null;
  'SGST': string | number | null;
  'IGST': string | number | null;
  'Tax Name': string | null;
  'Tax ID': string | null;
}

function mapInvoiceStatus(s: string | null): string {
  const v = (s ?? '').toLowerCase().trim();
  if (v === 'paid') return 'paid';
  if (v === 'partially paid') return 'partially_paid';
  if (v === 'overdue') return 'overdue';
  if (v === 'draft') return 'draft';
  if (v === 'sent') return 'sent';
  if (v === 'void') return 'cancelled';
  return 'sent';
}

export async function runPhase08(): Promise<PhaseResult> {
  const result = emptyResult('08-invoices');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoInvoiceRow>('Invoice.xls');

  // De-duplicate by Invoice ID
  const seen = new Map<string, ZohoInvoiceRow>();
  for (const r of rows) {
    const id = toStr(r['Invoice ID']);
    if (id && !seen.has(id)) seen.set(id, r);
  }
  console.log(`  ${rows.length} rows → ${seen.size} unique invoices`);

  // Load project mapping
  const { data: projMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');
  const projByName = new Map<string, string>();
  for (const m of projMappings ?? []) {
    projByName.set(m.zoho_project_name.toLowerCase().trim(), m.erp_project_id);
  }

  // Also load projects by customer name for fallback
  const { data: erpProjects } = await admin
    .from('projects')
    .select('id, customer_name');
  const projByCust = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    // last one wins — fine for fallback
    projByCust.set(p.customer_name.toLowerCase().trim(), p.id);
  }

  // Idempotency
  const { data: existing } = await admin
    .from('invoices')
    .select('zoho_invoice_id')
    .not('zoho_invoice_id', 'is', null);
  const existingIds = new Set((existing ?? []).map(r => r.zoho_invoice_id as string | null).filter((x): x is string => x != null));

  let skippedNoProject = 0;

  for (const [zohoInvId, r] of seen.entries()) {
    if (existingIds.has(zohoInvId)) { result.skipped++; continue; }

    const projectName = (toStr(r['Project Name']) ?? '').toLowerCase().trim();
    const customerName = (toStr(r['Customer Name']) ?? '').toLowerCase().trim();

    const projectId = (projectName ? projByName.get(projectName) : null)
      ?? (customerName ? projByCust.get(customerName) : null);

    if (!projectId) {
      skippedNoProject++;
      result.skipped++;
      continue;
    }

    const subtotal = toNumber(r['SubTotal']);
    const total = toNumber(r['Total']);
    const balance = toNumber(r['Balance']);
    const amountPaid = Math.max(0, total - balance);
    const cgst = toNumber(r['CGST']);
    const sgst = toNumber(r['SGST']);
    const igst = toNumber(r['IGST']);
    const gstTotal = cgst + sgst + igst;

    const row = {
      project_id: projectId,
      raised_by: systemId,
      invoice_number: `ZHI/${toStr(r['Invoice Number']) ?? zohoInvId}`,
      invoice_type: 'tax_invoice',
      subtotal_supply: subtotal,
      subtotal_works: 0,
      gst_supply_amount: gstTotal,
      gst_works_amount: 0,
      total_amount: total,
      amount_paid: amountPaid,
      amount_outstanding: balance,
      invoice_date: toDateISO(r['Invoice Date']) ?? '2023-01-01',
      due_date: toDateISO(r['Due Date']) ?? '2023-01-01',
      status: mapInvoiceStatus(toStr(r['Invoice Status'])),
      escalation_level: 0,
      legal_flagged: false,
      source: 'zoho_import',
      zoho_invoice_id: zohoInvId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('invoices').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; } // duplicate
      result.errors.push({ row: 0, reason: `${zohoInvId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
    }
  }

  if (skippedNoProject > 0) {
    console.log(`  Skipped ${skippedNoProject} invoices with no matching ERP project`);
  }
  if (dryRun) {
    console.log(`  DRY RUN: would insert ${seen.size - existingIds.size - skippedNoProject} invoices`);
  }
  return result;
}
