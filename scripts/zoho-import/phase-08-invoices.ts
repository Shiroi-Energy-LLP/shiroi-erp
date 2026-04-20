// scripts/zoho-import/phase-08-invoices.ts
// Invoice.xls → invoices table.
// Grain: one XLS row per line item; dedupe by Invoice ID (first row wins — header
//   fields including Total/SubTotal/Balance/Project ID/Customer Name repeat on every line).
//
// Tax aggregation: CGST/SGST/IGST are per-line, so we SUM across the group rather than
// taking the first line's value.
//
// Project attribution priority (Apr 19 2026 — data accuracy pass):
//   1. Zoho Project ID column → lookup in projects.zoho_project_id (set by Phase 06)
//   2. Zoho Project Name → lookup in zoho_project_mapping
//   3. Customer Name → projects.customer_name (fuzzy last resort)
//   4. NULL (allowed after migration 084; ERP-source invoices still require project_id)
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
  'Project ID': string | null;
  'Project Name': string | null;
  'SubTotal': string | number | null;
  'Total': string | number | null;
  'Balance': string | number | null;
  'CGST': string | number | null;
  'SGST': string | number | null;
  'IGST': string | number | null;
  'Tax Name': string | null;
  'Tax ID': string | null;
  'Notes': string | null;
  'GST Treatment': string | null;
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

  // Group by Invoice ID: keep first row for header fields, sum tax across all rows.
  const groups = new Map<string, ZohoInvoiceRow[]>();
  for (const r of rows) {
    const id = toStr(r['Invoice ID']);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
  }
  console.log(`  ${rows.length} rows → ${groups.size} unique invoices`);

  // Project lookup 1: Zoho Project ID → ERP project id (set by Phase 06).
  const { data: projById } = await admin
    .from('projects')
    .select('id, customer_name, zoho_project_id')
    .not('zoho_project_id', 'is', null);
  const projByZohoId = new Map<string, string>();
  for (const p of projById ?? []) {
    if (p.zoho_project_id) projByZohoId.set(p.zoho_project_id, p.id);
  }

  // Project lookup 2: zoho_project_mapping by name.
  const { data: projMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');
  const projByName = new Map<string, string>();
  for (const m of projMappings ?? []) {
    projByName.set(m.zoho_project_name.toLowerCase().trim(), m.erp_project_id);
  }

  // Project lookup 3: fallback by customer_name.
  const { data: erpProjects } = await admin.from('projects').select('id, customer_name');
  const projByCust = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    projByCust.set(p.customer_name.toLowerCase().trim(), p.id);
  }

  // Idempotency
  const { data: existing } = await admin
    .from('invoices')
    .select('zoho_invoice_id')
    .not('zoho_invoice_id', 'is', null);
  const existingIds = new Set((existing ?? []).map(r => r.zoho_invoice_id as string | null).filter((x): x is string => x != null));

  let resolvedByZohoId = 0;
  let resolvedByName = 0;
  let resolvedByCust = 0;
  let unresolvedProject = 0;

  for (const [zohoInvId, lineItems] of groups.entries()) {
    if (existingIds.has(zohoInvId)) { result.skipped++; continue; }

    const first = lineItems[0];
    const zohoProjectId = toStr(first['Project ID']);
    const zohoProjectName = (toStr(first['Project Name']) ?? '').toLowerCase().trim();
    const customerName = (toStr(first['Customer Name']) ?? '').toLowerCase().trim();

    let projectId: string | null = null;
    if (zohoProjectId && projByZohoId.has(zohoProjectId)) {
      projectId = projByZohoId.get(zohoProjectId)!;
      resolvedByZohoId++;
    } else if (zohoProjectName && projByName.has(zohoProjectName)) {
      projectId = projByName.get(zohoProjectName)!;
      resolvedByName++;
    } else if (customerName && projByCust.has(customerName)) {
      projectId = projByCust.get(customerName)!;
      resolvedByCust++;
    } else {
      unresolvedProject++;
    }

    // Header totals: take from first row (repeated across line items).
    const subtotal = toNumber(first['SubTotal']);
    const total = toNumber(first['Total']);
    const balance = toNumber(first['Balance']);
    const amountPaid = Math.max(0, total - balance);

    // Tax: sum per-line values across the group.
    let cgst = 0, sgst = 0, igst = 0;
    for (const li of lineItems) {
      cgst += toNumber(li['CGST']);
      sgst += toNumber(li['SGST']);
      igst += toNumber(li['IGST']);
    }
    const gstTotal = cgst + sgst + igst;

    const invoiceDate = toDateISO(first['Invoice Date']) ?? '2023-01-01';
    const row = {
      project_id: projectId,
      raised_by: systemId,
      invoice_number: `ZHI/${toStr(first['Invoice Number']) ?? zohoInvId}`,
      invoice_type: 'tax_invoice',
      subtotal_supply: subtotal,
      subtotal_works: 0,
      gst_supply_amount: gstTotal,
      gst_works_amount: 0,
      total_amount: total,
      amount_paid: amountPaid,
      amount_outstanding: balance,
      invoice_date: invoiceDate,
      due_date: toDateISO(first['Due Date']) ?? '2023-01-01',
      status: mapInvoiceStatus(toStr(first['Invoice Status'])),
      escalation_level: 0,
      legal_flagged: false,
      notes: toStr(first['Notes']),
      source: 'zoho_import',
      zoho_invoice_id: zohoInvId,
      zoho_customer_gst_treatment: toStr(first['GST Treatment']),
      // Anchor created_at to the invoice date (12:00 IST) — see mig 086.
      created_at: `${invoiceDate}T12:00:00+05:30`,
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

  console.log(`  Project resolution: ${resolvedByZohoId} by Zoho ID, ${resolvedByName} by name, ${resolvedByCust} by customer, ${unresolvedProject} NULL`);

  if (dryRun) {
    console.log(`  DRY RUN: would insert ${groups.size - existingIds.size} invoices`);
  }
  return result;
}
