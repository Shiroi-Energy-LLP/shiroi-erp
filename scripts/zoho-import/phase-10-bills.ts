// scripts/zoho-import/phase-10-bills.ts
// Bill.xls → vendor_bills + vendor_bill_items
// One row per line item; grouped by Bill ID.
// Bill.xls key columns: Bill ID | Bill Number | Bill Date | Due Date | Bill Status |
//   Vendor Name | SubTotal | Total | Balance | Project Name | Tax ID | Tax Name |
//   CGST Rate % | SGST Rate % | IGST Rate % | CGST | SGST | IGST |
//   Item Name | Quantity | Rate | HSN/SAC | Account | Tax Percentage
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { normalizeName, tokens, jaccard } from './normalize';

interface ZohoBillRow {
  'Bill ID': string | null;
  'Bill Number': string | null;
  'Bill Date': unknown;
  'Due Date': unknown;
  'Bill Status': string | null;
  'Vendor Name': string | null;
  'SubTotal': string | number | null;
  'Total': string | number | null;
  'Balance': string | number | null;
  'Project Name': string | null;
  'Item Name': string | null;
  'Product ID': string | null;
  'Quantity': string | number | null;
  'Rate': string | number | null;
  'HSN/SAC': string | null;
  'Account': string | null;
  'Tax ID': string | null;
  'Tax Name': string | null;
  'Tax Percentage': string | number | null;
  'Tax Amount': string | number | null;
  'Item Total': string | number | null;
  'CGST Rate %': string | number | null;
  'SGST Rate %': string | number | null;
  'IGST Rate %': string | number | null;
  'CGST': string | number | null;
  'SGST': string | number | null;
  'IGST': string | number | null;
  'CESS': string | number | null;
  'Adjustment': string | number | null;
  'Vendor Notes': string | null;
}

function mapBillStatus(s: string | null): 'draft' | 'pending' | 'partially_paid' | 'paid' | 'cancelled' {
  const v = (s ?? '').toLowerCase().trim();
  if (v === 'paid') return 'paid';
  if (v === 'partially paid') return 'partially_paid';
  if (v === 'void' || v === 'cancelled') return 'cancelled';
  if (v === 'draft') return 'draft';
  return 'pending';
}

export async function runPhase10(): Promise<PhaseResult> {
  const result = emptyResult('10-bills');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoBillRow>('Bill.xls');
  console.log(`  ${rows.length} rows in Bill.xls`);

  // Group rows by Bill ID
  const billMap = new Map<string, ZohoBillRow[]>();
  for (const r of rows) {
    const id = toStr(r['Bill ID']);
    if (!id) continue;
    if (!billMap.has(id)) billMap.set(id, []);
    billMap.get(id)!.push(r);
  }
  console.log(`  ${billMap.size} unique bills`);

  // Load vendor lookup by name (exact + fuzzy fallback for suffix differences)
  const { data: erpVendors } = await admin.from('vendors').select('id, company_name');
  const vendorByName = new Map<string, string>();
  for (const v of erpVendors ?? []) {
    vendorByName.set(v.company_name.toLowerCase().trim(), v.id);
  }
  const findVendorBills = (rawName: string): string | undefined => {
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

  // Load project mapping (by Zoho project name → ERP project id)
  const { data: projMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');
  const projByName = new Map<string, string>();
  for (const m of projMappings ?? []) {
    projByName.set(m.zoho_project_name.toLowerCase().trim(), m.erp_project_id);
  }

  // Idempotency: load existing bill zoho IDs
  const { data: existingBills } = await admin
    .from('vendor_bills')
    .select('zoho_bill_id')
    .not('zoho_bill_id', 'is', null);
  const existingBillIds = new Set((existingBills ?? []).map(b => b.zoho_bill_id as string | null).filter((x): x is string => x != null));

  let skippedNoVendor = 0;
  let skippedDuplicate = 0;

  for (const [zohoBillId, lineItems] of billMap.entries()) {
    if (existingBillIds.has(zohoBillId)) { skippedDuplicate++; result.skipped++; continue; }

    const firstRow = lineItems[0];
    const vendorId = findVendorBills(toStr(firstRow['Vendor Name']) ?? '');

    if (!vendorId) {
      skippedNoVendor++;
      result.errors.push({ row: 0, reason: `vendor not found: "${toStr(firstRow['Vendor Name'])}" (Bill ${toStr(firstRow['Bill Number'])})` });
      result.skipped++;
      continue;
    }

    const projectName = (toStr(firstRow['Project Name']) ?? '').toLowerCase().trim();
    const projectId = projectName ? (projByName.get(projectName) ?? null) : null;

    const billDate = toDateISO(firstRow['Bill Date']) ?? '2023-01-01';
    const dueDate = toDateISO(firstRow['Due Date']);
    const total = toNumber(firstRow['Total']);
    const balance = toNumber(firstRow['Balance']);
    const subtotal = toNumber(firstRow['SubTotal']);

    // Aggregate tax by type from line items
    let cgstTotal = 0, sgstTotal = 0, igstTotal = 0, cessTotal = 0;
    for (const li of lineItems) {
      cgstTotal += toNumber(li['CGST']);
      sgstTotal += toNumber(li['SGST']);
      igstTotal += toNumber(li['IGST']);
      cessTotal += toNumber(li['CESS']);
    }

    const amountPaid = Math.max(0, total - balance);
    const status = mapBillStatus(toStr(firstRow['Bill Status']));

    // Check for duplicate bill_number for this vendor
    const billNumber = `ZHI/${toStr(firstRow['Bill Number']) ?? zohoBillId}`;

    if (dryRun) { result.skipped++; continue; }

    // Insert bill header
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newBill, error: billErr } = await (admin as any)
      .from('vendor_bills')
      .insert({
        bill_number: billNumber,
        bill_date: billDate,
        due_date: dueDate,
        vendor_id: vendorId,
        project_id: projectId,
        subtotal,
        cgst_amount: cgstTotal,
        sgst_amount: sgstTotal,
        igst_amount: igstTotal,
        cess_amount: cessTotal,
        round_off: toNumber(firstRow['Adjustment']),
        total_amount: total,
        amount_paid: amountPaid,
        status,
        source: 'zoho_import',
        zoho_bill_id: zohoBillId,
        notes: toStr(firstRow['Vendor Notes']),
        created_by: systemId,
      })
      .select('id')
      .single();

    if (billErr) {
      if (billErr.code === '23505') {
        // Duplicate vendor+bill_number or zoho_bill_id
        result.skipped++;
        continue;
      }
      result.errors.push({ row: 0, reason: `bill ${zohoBillId}: ${billErr.message}` });
      result.failed++;
      continue;
    }

    const billId = newBill.id as string;

    // Insert line items
    const itemRows = lineItems
      .filter(li => toStr(li['Item Name']))
      .map(li => ({
        vendor_bill_id: billId,
        item_name: toStr(li['Item Name'])!,
        hsn_code: toStr(li['HSN/SAC']),
        quantity: toNumber(li['Quantity'], 1),
        rate: toNumber(li['Rate']),
        taxable_amount: toNumber(li['Item Total']),
        cgst_rate_pct: toNumber(li['CGST Rate %']),
        sgst_rate_pct: toNumber(li['SGST Rate %']),
        igst_rate_pct: toNumber(li['IGST Rate %']),
        cgst_amount: toNumber(li['CGST']),
        sgst_amount: toNumber(li['SGST']),
        igst_amount: toNumber(li['IGST']),
        total_amount: toNumber(li['Item Total']) + toNumber(li['Tax Amount']),
        zoho_account_code: toStr(li['Account']),
        zoho_item_id: toStr(li['Product ID']),
      }));

    if (itemRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: itemErr } = await (admin as any)
        .from('vendor_bill_items')
        .insert(itemRows);
      if (itemErr) {
        console.error(`  bill items for ${zohoBillId}:`, itemErr.message);
      }
    }

    result.inserted++;
  }

  if (skippedNoVendor > 0) console.log(`  Skipped ${skippedNoVendor} bills: vendor not found`);
  if (skippedDuplicate > 0) console.log(`  Skipped ${skippedDuplicate} bills: already imported`);

  return result;
}
