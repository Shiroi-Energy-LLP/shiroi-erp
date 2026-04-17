// scripts/zoho-import/phase-03-items.ts
// Item.xls → zoho_items
// Note: intra_state_tax_id / inter_state_tax_id reference zoho_tax_codes.tax_id
// which after phase-02 are keyed by Tax Name (e.g. "GST18", "IGST18")
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoItemRow {
  'Item ID': string | null;
  'Item Name': string | null;
  'SKU': string | null;
  'HSN/SAC': string | null;
  'Rate': string | null;
  'Purchase Rate': string | null;
  'Account': string | null;
  'Purchase Account': string | null;
  'Intra State Tax Name': string | null;
  'Inter State Tax Name': string | null;
  'Status': string | null;
}

export async function runPhase03(): Promise<PhaseResult> {
  const result = emptyResult('03-items');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoItemRow>('Item.xls');
  console.log(`  ${rows.length} items in Item.xls`);

  // Load valid tax IDs from zoho_tax_codes to avoid FK violations.
  // Item.xls uses "group" names like GST18 which don't exist in Tax.xls —
  // those get nulled out rather than failing the whole batch.
  const { data: taxCodes } = await admin.from('zoho_tax_codes').select('tax_id');
  const validTaxIds = new Set((taxCodes ?? []).map(t => t.tax_id));
  const resolvesTax = (name: string | null | undefined): string | null => {
    if (!name) return null;
    return validTaxIds.has(name) ? name : null;
  };

  const batch = rows
    .filter(r => toStr(r['Item ID']))
    .map(r => ({
      zoho_item_id: String(r['Item ID']),
      item_name: toStr(r['Item Name']) ?? 'Unknown',
      sku: toStr(r['SKU']),
      hsn_code: toStr(r['HSN/SAC']),
      // Rate field may be "INR 0.00" format
      rate: toNumber(r['Rate']),
      purchase_rate: toNumber(r['Purchase Rate']),
      sales_account: toStr(r['Account']),
      purchase_account: toStr(r['Purchase Account']),
      // Null out group tax names (GST18 etc.) that aren't in zoho_tax_codes
      intra_state_tax_id: resolvesTax(toStr(r['Intra State Tax Name'])),
      inter_state_tax_id: resolvesTax(toStr(r['Inter State Tax Name'])),
      is_active: String(r['Status'] ?? 'Active').toLowerCase() !== 'inactive',
    }));

  if (dryRun) {
    console.log(`  DRY RUN: would upsert ${batch.length} items`);
    result.skipped = batch.length;
    return result;
  }

  // Insert in batches of 200 to avoid payload limits
  const BATCH = 200;
  for (let i = 0; i < batch.length; i += BATCH) {
    const chunk = batch.slice(i, i + BATCH);
    const { error } = await admin
      .from('zoho_items')
      .upsert(chunk, { onConflict: 'zoho_item_id' });
    if (error) {
      console.error(`  chunk ${i}-${i + BATCH} failed:`, error.message);
      result.failed += chunk.length;
      result.errors.push({ row: i, reason: error.message });
    } else {
      result.inserted += chunk.length;
    }
  }
  return result;
}
