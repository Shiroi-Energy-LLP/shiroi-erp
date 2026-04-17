// scripts/zoho-import/phase-05-vendors.ts
// Vendors.xls → merge into vendors table
// Strategy:
//   1. Exact GSTIN match → stamp zoho_vendor_id + fill udyam fields
//   2. Fuzzy name match ≥ 0.80 Jaccard → stamp zoho_vendor_id
//   3. No match → create new vendor row (with source context in notes)
//
// vendors.vendor_code is NOT NULL — use ZHI-V-<zeropaddedN> for new rows.
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { normalizeName, tokens, jaccard } from './normalize';

interface ZohoVendorRow {
  'Contact ID': string | null;
  'Contact Name': string | null;
  'Display Name': string | null;
  'GST Identification Number (GSTIN)': string | null;
  'PAN Number': string | null;
  'MobilePhone': string | null;
  'EmailID': string | null;
  'Phone': string | null;
  'Billing Address': string | null;
  'Billing City': string | null;
  'Billing State': string | null;
  'Billing Code': string | null;
  'MSME/Udyam No': string | null;
  'MSME/Udyam Type': string | null;
  'Payment Terms': string | number | null;
  'Status': string | null;
  'Beneficiary Name': string | null;
  'Vendor Bank Account Number': string | null;
  'Vendor Bank Name': string | null;
}

export async function runPhase05(): Promise<PhaseResult> {
  const result = emptyResult('05-vendors');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const zohoRows = loadSheet<ZohoVendorRow>('Vendors.xls');
  console.log(`  ${zohoRows.length} vendors in Vendors.xls`);

  // Load all ERP vendors
  const { data: erpVendors, error: fetchErr } = await admin
    .from('vendors')
    .select('id, company_name, gstin, zoho_vendor_id, vendor_code');
  if (fetchErr) {
    result.errors.push({ row: 0, reason: 'fetch ERP vendors: ' + fetchErr.message });
    result.failed = zohoRows.length;
    return result;
  }

  const erpList = erpVendors ?? [];
  let newVendorCounter = erpList.length + 1;

  for (let i = 0; i < zohoRows.length; i++) {
    const zRow = zohoRows[i];
    const zohoId = toStr(zRow['Contact ID']);
    if (!zohoId) { result.skipped++; continue; }

    const zohoGstin = toStr(zRow['GST Identification Number (GSTIN)']);
    const zohoName = toStr(zRow['Contact Name']) ?? toStr(zRow['Display Name']) ?? '';
    const udyamNum = toStr(zRow['MSME/Udyam No']);
    const udyamType = toStr(zRow['MSME/Udyam Type']);

    // Skip if already linked
    if (erpList.find(v => v.zoho_vendor_id === zohoId)) { result.skipped++; continue; }

    let matchId: string | null = null;

    // 1. Exact GSTIN match
    if (zohoGstin) {
      const gMatch = erpList.find(
        v => v.gstin && v.gstin.trim().toUpperCase() === zohoGstin.trim().toUpperCase()
      );
      if (gMatch) matchId = gMatch.id;
    }

    // 2. Fuzzy name match
    if (!matchId && zohoName) {
      const zNorm = normalizeName(zohoName);
      const zTok = tokens(zNorm);
      let bestScore = 0;
      let bestId: string | null = null;
      for (const v of erpList) {
        const eTok = tokens(normalizeName(v.company_name));
        const score = jaccard(zTok, eTok);
        if (score > bestScore) { bestScore = score; bestId = v.id; }
      }
      if (bestScore >= 0.80 && bestId) matchId = bestId;
    }

    if (dryRun) {
      if (matchId) {
        console.log(`  DRY RUN: would link vendor "${zohoName}" → ${matchId}`);
      } else {
        console.log(`  DRY RUN: would CREATE new vendor "${zohoName}"`);
      }
      result.skipped++;
      continue;
    }

    if (matchId) {
      // Update existing vendor
      const patch: Record<string, unknown> = { zoho_vendor_id: zohoId };
      if (udyamNum) patch.udyam_number = udyamNum;
      if (udyamType) patch.udyam_type = udyamType;
      if (udyamNum) patch.is_msme = true;

      const { error: updErr } = await admin
        .from('vendors')
        .update(patch)
        .eq('id', matchId)
        .is('zoho_vendor_id', null);

      if (updErr) {
        result.errors.push({ row: i, reason: updErr.message });
        result.failed++;
      } else {
        result.updated++;
        const v = erpList.find(v => v.id === matchId);
        if (v) v.zoho_vendor_id = zohoId;
      }
    } else {
      // Create new vendor row from Zoho data
      const vendorCode = `ZHI-V-${String(newVendorCounter).padStart(4, '0')}`;
      newVendorCounter++;

      const newVendor = {
        vendor_code: vendorCode,
        company_name: zohoName || `Zoho Vendor ${zohoId}`,
        gstin: zohoGstin,
        pan_number: toStr(zRow['PAN Number']),
        phone: toStr(zRow['MobilePhone']) ?? toStr(zRow['Phone']),
        email: toStr(zRow['EmailID']),
        address_line1: toStr(zRow['Billing Address']),
        city: toStr(zRow['Billing City']),
        state: toStr(zRow['Billing State']),
        pincode: toStr(zRow['Billing Code']),
        vendor_type: 'other' as const,
        is_msme: !!(udyamNum),
        is_preferred: false,
        is_blacklisted: false,
        payment_terms_days: toNumber(zRow['Payment Terms'], 0),
        bank_account_number: toStr(zRow['Vendor Bank Account Number']),
        bank_name: toStr(zRow['Vendor Bank Name']),
        bank_account_name: toStr(zRow['Beneficiary Name']),
        is_active: String(zRow['Status'] ?? 'Active').toLowerCase() === 'active',
        udyam_number: udyamNum,
        udyam_type: udyamType,
        zoho_vendor_id: zohoId,
        notes: 'Created from Zoho import',
      };

      const { data: newRow, error: insErr } = await admin
        .from('vendors')
        .insert(newVendor)
        .select('id, company_name, gstin, zoho_vendor_id, vendor_code')
        .single();

      if (insErr) {
        result.errors.push({ row: i, reason: `create vendor "${zohoName}": ${insErr.message}` });
        result.failed++;
      } else if (newRow) {
        result.inserted++;
        erpList.push(newRow);
      }
    }
  }

  return result;
}
