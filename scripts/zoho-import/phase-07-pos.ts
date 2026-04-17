// scripts/zoho-import/phase-07-pos.ts
// Purchase_Order.xls → purchase_orders (header only)
// PO row is de-duplicated by Purchase Order ID (one PO spans multiple line-item rows).
// Numbers prefixed with ZHI/ to avoid collision with ERP-issued PO numbers.
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { normalizeName, tokens, jaccard } from './normalize';

interface ZohoPORow {
  'Purchase Order ID': string | null;
  'Purchase Order Date': unknown;
  'Delivery Date': unknown;
  'Purchase Order Number': string | null;
  'Purchase Order Status': string | null;
  'Vendor Name': string | null;
  'SubTotal': string | number | null;
  'Total': string | number | null;
  'Balance': string | number | null;
  'Project Name': string | null;
  'Terms & Conditions': string | null;
}

function mapPOStatus(s: string | null): string {
  const v = (s ?? '').toLowerCase().trim();
  if (v === 'billed' || v === 'received') return 'fully_delivered';
  if (v === 'cancelled') return 'cancelled';
  if (v === 'draft') return 'draft';
  if (v === 'issued' || v === 'sent') return 'sent';
  return 'approved';
}

export async function runPhase07(): Promise<PhaseResult> {
  const result = emptyResult('07-pos');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoPORow>('Purchase_Order.xls');

  // De-duplicate: first occurrence wins per PO ID
  const seen = new Map<string, ZohoPORow>();
  for (const r of rows) {
    const id = toStr(r['Purchase Order ID']);
    if (id && !seen.has(id)) seen.set(id, r);
  }
  console.log(`  ${rows.length} rows → ${seen.size} unique POs`);

  // Load vendor lookup by name (exact + fuzzy fallback)
  const { data: erpVendors } = await admin.from('vendors').select('id, company_name');
  const vendorByName = new Map<string, string>();
  for (const v of erpVendors ?? []) {
    vendorByName.set(v.company_name.toLowerCase().trim(), v.id);
  }
  // Fuzzy vendor lookup for cases like "FESTA SOLAR PRIVATE LIMITED" → "Festa Solar"
  const findVendor = (rawName: string): string | undefined => {
    const exact = vendorByName.get(rawName.toLowerCase().trim());
    if (exact) return exact;
    const zTok = tokens(normalizeName(rawName));
    let bestScore = 0;
    let bestId: string | undefined;
    for (const [name, id] of vendorByName) {
      const score = jaccard(zTok, tokens(normalizeName(name)));
      if (score > bestScore) { bestScore = score; bestId = id; }
    }
    return bestScore >= 0.50 ? bestId : undefined;
  };

  // Load project mapping name → ERP id
  const { data: projMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');
  const projByName = new Map<string, string>();
  for (const m of projMappings ?? []) {
    projByName.set(m.zoho_project_name.toLowerCase().trim(), m.erp_project_id);
  }

  // Load existing imported PO IDs (idempotency)
  const { data: existingPOs } = await admin
    .from('purchase_orders')
    .select('zoho_po_id')
    .not('zoho_po_id', 'is', null);
  const existingPoIds = new Set((existingPOs ?? []).map(p => p.zoho_po_id as string | null).filter((x): x is string => x != null));

  type POInsert = {
    project_id: string | null;
    vendor_id: string;
    prepared_by: string;
    po_number: string;
    status: string;
    po_date: string;
    expected_delivery_date: string | null;
    payment_terms_days: number;
    subtotal: number;
    gst_amount: number;
    total_amount: number;
    amount_paid: number;
    amount_outstanding: number;
    loi_issued: boolean;
    advance_block_overridden: boolean;
    requires_approval: boolean;
    approval_status: string;
    notes: string | null;
    sent_via_channels: string[];
    source: string;
    zoho_po_id: string;
  };

  const batch: POInsert[] = [];

  for (const [zohoPoId, r] of seen.entries()) {
    if (existingPoIds.has(zohoPoId)) { result.skipped++; continue; }

    const poDate = toDateISO(r['Purchase Order Date']) ?? '2023-01-01';
    const vendorName = (toStr(r['Vendor Name']) ?? '').toLowerCase().trim();
    const projectName = (toStr(r['Project Name']) ?? '').toLowerCase().trim();

    const vendorId = findVendor(toStr(r['Vendor Name']) ?? '');
    if (!vendorId) {
      result.errors.push({ row: 0, reason: `vendor not found: "${toStr(r['Vendor Name'])}" (PO ${toStr(r['Purchase Order Number'])})` });
      result.skipped++;
      continue;
    }

    const projectId = projectName ? (projByName.get(projectName) ?? null) : null;
    // purchase_orders.project_id is NOT NULL — skip POs with no matched project
    if (!projectId) { result.skipped++; continue; }

    const subtotal = toNumber(r['SubTotal']);
    const total = toNumber(r['Total']);
    const balance = toNumber(r['Balance']);

    batch.push({
      project_id: projectId,
      vendor_id: vendorId,
      prepared_by: systemId,
      po_number: `ZHI/${toStr(r['Purchase Order Number']) ?? zohoPoId}`,
      status: mapPOStatus(toStr(r['Purchase Order Status'])),
      po_date: poDate,
      expected_delivery_date: toDateISO(r['Delivery Date']),
      payment_terms_days: 0,
      subtotal,
      gst_amount: Math.max(0, total - subtotal),
      total_amount: total,
      amount_paid: Math.max(0, total - balance),
      amount_outstanding: balance,
      loi_issued: false,
      advance_block_overridden: false,
      requires_approval: false,
      approval_status: 'approved',
      notes: toStr(r['Terms & Conditions']),
      sent_via_channels: [],
      source: 'zoho_import',
      zoho_po_id: zohoPoId,
    });
  }

  if (dryRun) {
    console.log(`  DRY RUN: would insert ${batch.length} POs (${result.errors.length} vendor-not-found skips)`);
    result.skipped += batch.length;
    return result;
  }

  const CHUNK = 100;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('purchase_orders').insert(chunk as any);
    if (error) {
      console.error(`  PO chunk ${i} error:`, error.message);
      result.failed += chunk.length;
      result.errors.push({ row: i, reason: error.message });
    } else {
      result.inserted += chunk.length;
    }
  }
  return result;
}
