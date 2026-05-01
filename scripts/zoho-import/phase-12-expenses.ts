// scripts/zoho-import/phase-12-expenses.ts
// Expense.xls → expenses table.
// Grain: one row per expense. Dedupe key = `Expense Reference ID` (per-expense unique)
//   falling back to `Entry Number` + row index for older rows that predate that column.
//
// Project attribution (Apr 19 2026 — data accuracy pass):
//   - Expense.xls has NO Project ID column (only Project Name + Customer Name).
//   - Name lookup via zoho_project_mapping (143 rows vs. 12 before Phase 06 rewrite).
//   - Customer Name fallback (matches projects.customer_name) when Project Name blank.
//   - expenses.project_id is NULLABLE — unattributed expenses still import so company
//     totals stay complete.
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoExpenseRow {
  'Expense Date': unknown;
  'Expense Description': string | null;
  'Expense Account': string | null;
  'Project Name': string | null;
  'Customer Name': string | null;
  'Vendor': string | null;
  'Amount': string | number | null;
  'Expense Amount': string | number | null;
  'Total': string | number | null;
  'Entry Number': string | null;
  'Expense Reference ID': string | null;
  'Tax Amount': string | number | null;
  'Total Amount': string | number | null;
  'HSN/SAC': string | null;
}

export async function runPhase12(): Promise<PhaseResult> {
  const result = emptyResult('12-expenses');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const systemId = await getSystemEmployeeId();

  const rows = loadSheet<ZohoExpenseRow>('Expense.xls');
  console.log(`  ${rows.length} expense rows in Expense.xls`);

  // Project lookups: by mapped Zoho name and by customer-name fallback.
  const { data: projMappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');
  const projByName = new Map<string, string>();
  for (const m of projMappings ?? []) {
    projByName.set(m.zoho_project_name.toLowerCase().trim(), m.erp_project_id);
  }
  const { data: erpProjects } = await admin
    .from('projects')
    .select('id, customer_name');
  const projByCust = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    projByCust.set(p.customer_name.toLowerCase().trim(), p.id);
  }

  // Expense categories.
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
    result.failed = rows.length;
    return result;
  }

  // Idempotency.
  const { data: existing } = await admin
    .from('expenses')
    .select('zoho_expense_id')
    .not('zoho_expense_id', 'is', null);
  const existingIds = new Set(
    (existing ?? []).map(r => r.zoho_expense_id as string | null).filter((x): x is string => x != null)
  );

  const { data: usedVouchers } = await admin
    .from('expenses')
    .select('voucher_number')
    .like('voucher_number', 'ZHI/%');
  const usedVoucherSet = new Set((usedVouchers ?? []).map(r => r.voucher_number));

  let resolvedByName = 0;
  let resolvedByCust = 0;
  let unresolvedProject = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Prefer Expense Reference ID (stable per-expense); fall back to Entry Number + index.
    const refId = toStr(r['Expense Reference ID']);
    const entryNum = toStr(r['Entry Number']);
    const zohoId = refId ?? (entryNum ? `E${entryNum}-${i}` : `exp-${i}`);
    if (existingIds.has(zohoId)) { result.skipped++; continue; }

    const projectName = (toStr(r['Project Name']) ?? '').toLowerCase().trim();
    const customerName = (toStr(r['Customer Name']) ?? '').toLowerCase().trim();
    let projectId: string | null = null;
    if (projectName && projByName.has(projectName)) {
      projectId = projByName.get(projectName)!;
      resolvedByName++;
    } else if (customerName && projByCust.has(customerName)) {
      projectId = projByCust.get(customerName)!;
      resolvedByCust++;
    } else {
      unresolvedProject++;
    }

    // Voucher uniqueness (DB constraint). Expense Reference ID is best; Entry Number is fallback.
    let voucherNum = `ZHI/${refId ?? entryNum ?? zohoId}`;
    let suffix = 0;
    while (usedVoucherSet.has(voucherNum)) {
      suffix++;
      voucherNum = `ZHI/${refId ?? entryNum ?? zohoId}-${suffix}`;
    }

    // Category: coarse keyword match on Expense Account.
    const account = (toStr(r['Expense Account']) ?? '').toLowerCase();
    let categoryId = miscCategoryId;
    if (account.includes('travel')) categoryId = categoryByCode.get('travel') ?? miscCategoryId;
    else if (account.includes('food') || account.includes('meal')) categoryId = categoryByCode.get('food') ?? miscCategoryId;
    else if (account.includes('lodg') || account.includes('hotel')) categoryId = categoryByCode.get('lodging') ?? miscCategoryId;

    // Zoho column: "Amount" doesn't exist in Expense.xls — it's "Expense Amount" or "Total".
    // Use Total (includes tax) for the expense amount so cashflow totals reconcile.
    const amount = toNumber(r['Total']) || toNumber(r['Expense Amount']);
    if (amount <= 0) { result.skipped++; continue; }

    // Derive workflow timestamps from the voucher date so the expenses
    // list (ordered by submitted_at DESC) and get_expense_kpis
    // (approved_month_amt filters on approved_at) reflect real history
    // instead of rolling every import into "this month". Anchor at 12:00
    // IST via explicit ISO offset. Historical rows get fixed by mig 086.
    const expenseDate = toDateISO(r['Expense Date']) ?? '2023-01-01';
    const historicalTs = `${expenseDate}T12:00:00+05:30`;

    const row = {
      project_id: projectId,
      description: toStr(r['Expense Description']) ?? 'Zoho import',
      expense_date: expenseDate,
      amount,
      voucher_number: voucherNum,
      category_id: categoryId,
      status: 'approved',
      submitted_by: systemId,
      submitted_at: historicalTs,
      approved_by: systemId,
      approved_at: historicalTs,
      created_at: historicalTs,
      source: 'zoho_import',
      zoho_expense_id: zohoId,
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

  console.log(`  Project resolution: ${resolvedByName} by name, ${resolvedByCust} by customer, ${unresolvedProject} NULL`);
  if (dryRun) console.log(`  DRY RUN: would process ${rows.length} expenses`);
  return result;
}
