// scripts/zoho-import/phase-11-vendor-payments.ts
// Vendor_Payment.xls → vendor_payments table (ONE DB ROW PER XLS ROW).
//
// Vendor_Payment.xls is ALREADY per-allocation: one row per bill the parent
// VendorPayment was split across. Prior versions of this phase deduped by
// `VendorPayment ID` (parent payment) and then used a fragile "exact balance
// match" heuristic to guess which bill the payment belonged to — dropping
// ~2700 of 3397 rows and mis-linking the ones that did match (see migration
// 079 for the clean-up).
//
// Re-architecture (Apr 19 2026):
//   Dedupe key = `PIPayment ID` (each allocation is unique)
//   Stored in  = `vendor_payments.zoho_vendor_payment_id` (UNIQUE)
//   Amount     = `Bill Amount` (the per-bill allocated amount, not the parent total)
//   Link bill  = `Bill ID` → `vendor_bills.zoho_bill_id` (direct ID match)
//   Project    = inherited from linked bill; skip if bill has no project
//                (vendor_payments.project_id is NOT NULL)
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { mapPaymentMode, normalizeName, tokens, jaccard } from './normalize';

interface ZohoVendorPayRow {
  'VendorPayment ID': string | null;
  'PIPayment ID': string | null;
  'Payment Number': string | null;
  'Date': unknown;
  'Vendor Name': string | null;
  'Amount': string | number | null;
  'Bill Amount': string | number | null;
  'Bill ID': string | null;
  'Bill Number': string | null;
  'Mode': string | null;
  'Reference Number': string | null;
  'Description': string | null;
}

export async function runPhase11(): Promise<PhaseResult> {
  const result = emptyResult('11-vendor-payments');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoVendorPayRow>('Vendor_Payment.xls');
  console.log(`  ${rows.length} rows in Vendor_Payment.xls (one DB row per XLS row)`);

  // Vendor lookup: exact name, then fuzzy Jaccard fallback (>=0.50).
  const { data: erpVendors } = await admin.from('vendors').select('id, company_name');
  const vendorByName = new Map<string, string>();
  for (const v of erpVendors ?? []) {
    vendorByName.set(v.company_name.toLowerCase().trim(), v.id);
  }
  const findVendorPay = (rawName: string): string | undefined => {
    const exact = vendorByName.get(rawName.toLowerCase().trim());
    if (exact) return exact;
    const zTok = tokens(normalizeName(rawName));
    let bestScore = 0, bestId: string | undefined;
    for (const [name, id] of vendorByName) {
      const score = jaccard(zTok, tokens(normalizeName(name)));
      if (score > bestScore) { bestScore = score; bestId = id; }
    }
    return bestScore >= 0.50 ? bestId : undefined;
  };

  // Bill lookup by Zoho Bill ID → ERP bill id + project_id.
  const { data: bills } = await admin
    .from('vendor_bills')
    .select('id, project_id, zoho_bill_id, vendor_id')
    .not('zoho_bill_id', 'is', null);
  const billByZohoId = new Map<string, { id: string; project_id: string | null; vendor_id: string }>();
  for (const b of bills ?? []) {
    if (b.zoho_bill_id) billByZohoId.set(b.zoho_bill_id, { id: b.id, project_id: b.project_id, vendor_id: b.vendor_id });
  }

  // Idempotency: skip PIPayment IDs already imported.
  const { data: existing } = await admin
    .from('vendor_payments')
    .select('zoho_vendor_payment_id')
    .not('zoho_vendor_payment_id', 'is', null);
  const existingIds = new Set(
    (existing ?? []).map(r => r.zoho_vendor_payment_id as string | null).filter((x): x is string => x != null)
  );

  let linkedToBill = 0;
  let skippedNoVendor = 0;
  let skippedNoBill = 0;
  let skippedNoProject = 0;
  let skippedBlankId = 0;

  for (const r of rows) {
    const piPayId = toStr(r['PIPayment ID']);
    if (!piPayId) { skippedBlankId++; result.skipped++; continue; }
    if (existingIds.has(piPayId)) { result.skipped++; continue; }

    const zohoBillId = toStr(r['Bill ID']);
    const bill = zohoBillId ? billByZohoId.get(zohoBillId) : undefined;

    // Primary vendor from bill (authoritative); fall back to name lookup.
    let vendorId: string | undefined = bill?.vendor_id;
    if (!vendorId) {
      vendorId = findVendorPay(toStr(r['Vendor Name']) ?? '');
      if (!vendorId) { skippedNoVendor++; result.skipped++; continue; }
    }

    if (!bill) { skippedNoBill++; result.skipped++; continue; }
    if (!bill.project_id) skippedNoProject++;
    linkedToBill++;

    const amount = toNumber(r['Bill Amount']);
    if (amount <= 0) { result.skipped++; continue; }

    const paymentDate = toDateISO(r['Date']) ?? '2023-01-01';

    const row = {
      vendor_id: vendorId,
      project_id: bill.project_id,
      recorded_by: systemId,
      amount,
      payment_date: paymentDate,
      payment_method: mapPaymentMode(toStr(r['Mode'])),
      payment_reference: toStr(r['Reference Number']),
      msme_compliant: true,
      vendor_bill_id: bill.id,
      purchase_order_id: null,
      notes: toStr(r['Description']),
      source: 'zoho_import',
      zoho_vendor_payment_id: piPayId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('vendor_payments').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; }
      result.errors.push({ row: 0, reason: `${piPayId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
    }
  }

  console.log(`  Linked to bill: ${linkedToBill}, skipped no-vendor: ${skippedNoVendor}, no-bill: ${skippedNoBill}, NULL project (kept): ${skippedNoProject}, blank-id: ${skippedBlankId}`);
  if (dryRun) console.log(`  DRY RUN: would process ${rows.length} vendor payments`);
  return result;
}
