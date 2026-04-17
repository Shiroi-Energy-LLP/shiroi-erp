// scripts/zoho-import/phase-01-accounts.ts
// Chart_of_Accounts.xls → zoho_account_codes
// Actual headers: Account ID | Account Name | Account Code | Account Type | Parent Account | Account Status
import { admin } from './supabase';
import { loadSheet, toStr } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoAccountRow {
  'Account ID': string | null;
  'Account Name': string | null;
  'Account Code': string | null;
  'Account Type': string | null;
  'Parent Account': string | null;
  'Account Status': string | null;
  // some exports use "Is Active"
  'Is Active': string | null;
}

export async function runPhase01(): Promise<PhaseResult> {
  const result = emptyResult('01-accounts');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoAccountRow>('Chart_of_Accounts.xls');
  console.log(`  ${rows.length} accounts in Chart_of_Accounts.xls`);

  const batch = rows
    .filter(r => toStr(r['Account ID']))
    .map(r => ({
      account_id: String(r['Account ID']),
      account_name: toStr(r['Account Name']) ?? 'Unknown',
      account_code: toStr(r['Account Code']),
      account_type: toStr(r['Account Type']) ?? 'Other',
      parent_account: toStr(r['Parent Account']),
      // Account Status = "Active" / "Inactive"; Is Active = "true"/"false"
      is_active: r['Account Status'] != null
        ? String(r['Account Status']).toLowerCase() === 'active'
        : String(r['Is Active'] ?? 'true').toLowerCase() !== 'false',
    }));

  if (dryRun) {
    console.log(`  DRY RUN: would upsert ${batch.length} accounts`);
    result.skipped = batch.length;
    return result;
  }

  const { error } = await admin
    .from('zoho_account_codes')
    .upsert(batch, { onConflict: 'account_id' });

  if (error) {
    console.error('  upsert failed', error.message);
    result.failed = batch.length;
    result.errors.push({ row: 0, reason: error.message });
  } else {
    result.inserted = batch.length;
  }
  return result;
}
