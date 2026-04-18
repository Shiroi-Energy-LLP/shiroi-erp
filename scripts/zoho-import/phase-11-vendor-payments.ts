// scripts/zoho-import/phase-11-vendor-payments.ts
// Vendor_Payment.xls → vendor_payments table
// Headers: VendorPayment ID | Payment Number | Date | Vendor Name | Amount | Mode | Reference Number
// vendor_payments NOT NULL: vendor_id, recorded_by, amount, payment_date, payment_method, msme_compliant
// Now nullable: purchase_order_id, po_date, days_from_po (after migration 067)
// CHECK: purchase_order_id IS NOT NULL OR vendor_bill_id IS NOT NULL
// Strategy: only link a Zoho payment to a bill when `balance_due ≈ payment_amount` (exact match).
// DO NOT fall back to "first open bill for vendor" or "latest PO for vendor" — Apr 18 2026 migration 079
// cleaned up 669 mis-linked payments from a prior run that used those heuristics. Unlinked payments
// are counted and reported but NOT inserted: the schema requires bill_id OR po_id plus a non-null
// project_id, and we don't have that info in Zoho's Vendor_Payment.xls (only the vendor-level total).
// To insert unlinked payments in the future we need either (a) Zoho's per-bill allocation export, or
// (b) a schema change to allow vendor-level payments without a bill/PO/project link.
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { mapPaymentMode, normalizeName, tokens, jaccard } from './normalize';

interface ZohoVendorPayRow {
  'VendorPayment ID': string | null;
  'Payment Number': string | null;
  'Date': unknown;
  'Vendor Name': string | null;
  'Amount': string | number | null;
  'Mode': string | null;
  'Reference Number': string | null;
  'Description': string | null;
  'Unused Amount': string | number | null;
}

export async function runPhase11(): Promise<PhaseResult> {
  const result = emptyResult('11-vendor-payments');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoVendorPayRow>('Vendor_Payment.xls');

  // De-duplicate by VendorPayment ID
  const seen = new Map<string, ZohoVendorPayRow>();
  for (const r of rows) {
    const id = toStr(r['VendorPayment ID']);
    if (id && !seen.has(id)) seen.set(id, r);
  }
  console.log(`  ${rows.length} rows → ${seen.size} unique vendor payments`);

  // Load vendor lookup by name (with fuzzy fallback)
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

  // Load bills by vendor for linking — include project_id for propagation
  const { data: bills } = await admin
    .from('vendor_bills')
    .select('id, vendor_id, total_amount, amount_paid, status, project_id')
    .in('status', ['pending', 'partially_paid']);
  const billsByVendor = new Map<string, Array<{ id: string; total_amount: number; amount_paid: number; project_id: string | null }>>();
  for (const b of bills ?? []) {
    if (!billsByVendor.has(b.vendor_id)) billsByVendor.set(b.vendor_id, []);
    billsByVendor.get(b.vendor_id)!.push({
      id: b.id,
      total_amount: Number(b.total_amount),
      amount_paid: Number(b.amount_paid),
      project_id: b.project_id,
    });
  }

  // Idempotency
  const { data: existing } = await admin
    .from('vendor_payments')
    .select('zoho_vendor_payment_id')
    .not('zoho_vendor_payment_id', 'is', null);
  const existingIds = new Set((existing ?? []).map(r => r.zoho_vendor_payment_id as string | null).filter((x): x is string => x != null));

  let skippedNoVendor = 0;
  let skippedNoMatch = 0;
  let linkedToBill = 0;

  for (const [zohoId, r] of seen.entries()) {
    if (existingIds.has(zohoId)) { result.skipped++; continue; }

    const vendorId = findVendorPay(toStr(r['Vendor Name']) ?? '');

    if (!vendorId) {
      skippedNoVendor++;
      result.skipped++;
      continue;
    }

    const paymentAmount = toNumber(r['Amount']);
    const paymentDate = toDateISO(r['Date']) ?? '2023-01-01';

    // Only link to a bill when balance_due matches the payment amount within ₹1.
    // Any looser heuristic (first open bill / latest PO for vendor) corrupts amount_paid
    // via the update_po_amount_paid trigger — see migration 079 for the clean-up.
    const vendorBills = billsByVendor.get(vendorId) ?? [];
    const matchingBill = vendorBills.find(
      b => Math.abs((b.total_amount - b.amount_paid) - paymentAmount) < 1
    );

    if (!matchingBill) {
      skippedNoMatch++;
      result.skipped++;
      continue;
    }

    const vendorBillId = matchingBill.id;
    const projectId = matchingBill.project_id;
    linkedToBill++;

    // project_id is NOT NULL on vendor_payments — if the matched bill has no project, skip.
    if (!projectId) {
      skippedNoMatch++;
      result.skipped++;
      continue;
    }

    const row = {
      vendor_id: vendorId,
      project_id: projectId,
      recorded_by: systemId,
      amount: paymentAmount,
      payment_date: paymentDate,
      payment_method: mapPaymentMode(toStr(r['Mode'])),
      payment_reference: toStr(r['Reference Number']),
      msme_compliant: true,
      vendor_bill_id: vendorBillId,
      purchase_order_id: null,
      notes: toStr(r['Description']),
      source: 'zoho_import',
      zoho_vendor_payment_id: zohoId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('vendor_payments').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; }
      result.errors.push({ row: 0, reason: `${zohoId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
    }
  }

  console.log(`  Linked to bill (exact amount match): ${linkedToBill}, skipped no-vendor: ${skippedNoVendor}, skipped no-match (need Zoho per-bill allocation): ${skippedNoMatch}`);
  if (dryRun) console.log(`  DRY RUN: would process ${seen.size} vendor payments`);
  return result;
}
