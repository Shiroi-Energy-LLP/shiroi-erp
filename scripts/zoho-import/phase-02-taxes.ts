// scripts/zoho-import/phase-02-taxes.ts
// Tax.xls → zoho_tax_codes
// Actual headers: Tax Name | Tax Percentage | Tax Type | Tax Specific Type | Tax Status
// Note: Tax.xls has no "Tax ID" column — we use Tax Name as the primary key.
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoTaxRow {
  'Tax Name': string | null;
  'Tax Percentage': string | number | null;
  'Tax Type': string | null;
  'Tax Specific Type': string | null;
  'Tax Status': string | null;
}

function deriveTaxType(specificType: string | null, name: string): 'CGST' | 'SGST' | 'IGST' | 'CESS' | 'OTHER' {
  const st = (specificType ?? '').toLowerCase();
  if (st === 'cgst') return 'CGST';
  if (st === 'sgst') return 'SGST';
  if (st === 'igst') return 'IGST';
  if (st === 'cess') return 'CESS';
  const u = name.toUpperCase();
  if (u.includes('CGST')) return 'CGST';
  if (u.includes('SGST')) return 'SGST';
  if (u.includes('IGST')) return 'IGST';
  if (u.includes('CESS')) return 'CESS';
  return 'OTHER';
}

export async function runPhase02(): Promise<PhaseResult> {
  const result = emptyResult('02-taxes');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoTaxRow>('Tax.xls');
  const batch = rows
    .filter(r => toStr(r['Tax Name']))
    .map(r => {
      const name = toStr(r['Tax Name'])!;
      return {
        // Tax Name is used as the tax_id since Zoho Tax.xls has no separate ID
        tax_id: name,
        tax_name: name,
        tax_percentage: toNumber(r['Tax Percentage']),
        tax_type: deriveTaxType(toStr(r['Tax Specific Type']), name),
        is_active: String(r['Tax Status'] ?? 'Active').toLowerCase() === 'active',
      };
    });

  console.log(`  ${batch.length} tax codes`);
  if (dryRun) { result.skipped = batch.length; return result; }

  const { error } = await admin.from('zoho_tax_codes').upsert(batch, { onConflict: 'tax_id' });
  if (error) {
    result.failed = batch.length;
    result.errors.push({ row: 0, reason: error.message });
  } else {
    result.inserted = batch.length;
  }
  return result;
}
