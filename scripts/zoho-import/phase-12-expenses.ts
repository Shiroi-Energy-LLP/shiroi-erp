// scripts/zoho-import/phase-12-expenses.ts
// Expense.xls → expenses table (project-tagged only)
// Expense headers: Expense Date | Expense Description | Project Name | Vendor | Amount | Entry Number
// expenses NOT NULL: voucher_number, amount, category_id, submitted_by
// We only import project-tagged rows (Project Name not empty).
// voucher_number: use ZHI/<EntryNumber> or ZHI/EXP-<zohoid>
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoExpenseRow {
  'Expense Date': unknown;
  'Expense Description': string | null;
  'Expense Account': string | null;
  'Project Name': string | null;
  'Vendor': string | null;
  'Amount': string | number | null;
  'Entry Number': string | null;
  'Tax Amount': string | number | null;
  'Total Amount': string | number | null;
  'HSN/SAC': string | null;
}

export async function runPhase12(): Promise<PhaseResult> {
  const result = emptyResult('12-expenses');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoExpenseRow>('Expense.xls');

  // Only project-tagged rows
  const projectRows = rows.filter(r => toStr(r['Project Name']));
  console.log(`  ${rows.length} total expense rows, ${projectRows.length} project-tagged`);

  // Load project mapping
  const { data: projMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');
  const projByName = new Map<string, string>();
  for (const m of projMappings ?? []) {
    projByName.set(m.zoho_project_name.toLowerCase().trim(), m.erp_project_id);
  }

  // Load default expense category (miscellaneous) for catch-all
  const { data: categories } = await admin
    .from('expense_categories')
    .select('id, code');
  const categoryByCode = new Map<string, string>();
  for (const c of categories ?? []) {
    categoryByCode.set(c.code, c.id);
  }
  const miscCategoryId = categoryByCode.get('miscellaneous') ?? (categories?.[0]?.id ?? null);

  if (!miscCategoryId) {
    result.errors.push({ row: 0, reason: 'No expense categories found — run migration 066 first' });
    result.failed = projectRows.length;
    return result;
  }

  // Idempotency
  const { data: existing } = await admin
    .from('expenses')
    .select('zoho_expense_id')
    .not('zoho_expense_id', 'is', null);
  const existingIds = new Set((existing ?? []).map(r => r.zoho_expense_id as string | null).filter((x): x is string => x != null));

  // Track used voucher numbers
  const { data: usedVouchers } = await admin
    .from('expenses')
    .select('voucher_number')
    .like('voucher_number', 'ZHI/%');
  const usedVoucherSet = new Set((usedVouchers ?? []).map(r => r.voucher_number));

  let skippedNoProject = 0;

  for (let i = 0; i < projectRows.length; i++) {
    const r = projectRows[i];
    const entryNum = toStr(r['Entry Number']);
    const zohoId = entryNum ?? `exp-${i}`;

    if (entryNum && existingIds.has(entryNum)) { result.skipped++; continue; }

    const projectName = (toStr(r['Project Name']) ?? '').toLowerCase().trim();
    const projectId = projByName.get(projectName);

    if (!projectId) {
      skippedNoProject++;
      result.skipped++;
      continue;
    }

    let voucherNum = `ZHI/${entryNum ?? zohoId}`;
    // Ensure uniqueness
    let suffix = 0;
    while (usedVoucherSet.has(voucherNum)) {
      suffix++;
      voucherNum = `ZHI/${entryNum ?? zohoId}-${suffix}`;
    }

    // Map account description to expense category
    const account = (toStr(r['Expense Account']) ?? '').toLowerCase();
    let categoryId = miscCategoryId;
    if (account.includes('travel')) categoryId = categoryByCode.get('travel') ?? miscCategoryId;
    else if (account.includes('food') || account.includes('meal')) categoryId = categoryByCode.get('food') ?? miscCategoryId;
    else if (account.includes('lodg') || account.includes('hotel')) categoryId = categoryByCode.get('lodging') ?? miscCategoryId;

    const row = {
      project_id: projectId,
      description: toStr(r['Expense Description']) ?? 'Zoho import',
      expense_date: toDateISO(r['Expense Date']) ?? '2023-01-01',
      amount: toNumber(r['Amount']),
      voucher_number: voucherNum,
      category_id: categoryId,
      status: 'approved',
      submitted_by: systemId,
      submitted_at: new Date().toISOString(),
      approved_by: systemId,
      approved_at: new Date().toISOString(),
      source: 'zoho_import',
      zoho_expense_id: entryNum ?? zohoId,
    };

    if (dryRun) { result.skipped++; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from('expenses').insert(row as any);
    if (error) {
      if (error.code === '23505') { result.skipped++; continue; }
      result.errors.push({ row: i, reason: `${zohoId}: ${error.message}` });
      result.failed++;
    } else {
      result.inserted++;
      usedVoucherSet.add(voucherNum);
    }
  }

  if (skippedNoProject > 0) console.log(`  Skipped ${skippedNoProject} expenses: no matching project`);
  if (dryRun) console.log(`  DRY RUN: would process ${projectRows.length} project expenses`);
  return result;
}
