// scripts/zoho-import/reconcile.ts
// Compare ERP totals vs Zoho XLS totals per project.
// Writes discrepancies to reconciliation_discrepancies table and a markdown report.
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import * as fs from 'fs';
import * as path from 'path';

interface ZohoInvoiceRow {
  'Invoice ID': string | null;
  'Total': string | number | null;
  'Balance': string | number | null;
  'Project Name': string | null;
}

interface ZohoBillRow {
  'Bill ID': string | null;
  'Total': string | number | null;
  'Balance': string | number | null;
  'Project Name': string | null;
}

export async function runReconcile(): Promise<PhaseResult> {
  const result = emptyResult('reconcile');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  console.log('  Loading Zoho XLS totals...');

  // Build Zoho invoice totals per project name
  const invRows = loadSheet<ZohoInvoiceRow>('Invoice.xls');
  const zohoInvByProj = new Map<string, { invoiced: number; received: number }>();
  const seenInvIds = new Set<string>();
  for (const r of invRows) {
    const id = toStr(r['Invoice ID']);
    if (!id || seenInvIds.has(id)) continue;
    seenInvIds.add(id);
    const name = (toStr(r['Project Name']) ?? '').toLowerCase().trim();
    if (!name) continue;
    const tot = toNumber(r['Total']);
    const bal = toNumber(r['Balance']);
    const cur = zohoInvByProj.get(name) ?? { invoiced: 0, received: 0 };
    cur.invoiced += tot;
    cur.received += tot - bal;
    zohoInvByProj.set(name, cur);
  }

  // Build Zoho bill totals per project name
  const billRows = loadSheet<ZohoBillRow>('Bill.xls');
  const zohoBillByProj = new Map<string, { billed: number; paid: number }>();
  const seenBillIds = new Set<string>();
  for (const r of billRows) {
    const id = toStr(r['Bill ID']);
    if (!id || seenBillIds.has(id)) continue;
    seenBillIds.add(id);
    const name = (toStr(r['Project Name']) ?? '').toLowerCase().trim();
    if (!name) continue;
    const tot = toNumber(r['Total']);
    const bal = toNumber(r['Balance']);
    const cur = zohoBillByProj.get(name) ?? { billed: 0, paid: 0 };
    cur.billed += tot;
    cur.paid += tot - bal;
    zohoBillByProj.set(name, cur);
  }

  // Load project mappings
  const { data: mappings } = await admin
    .from('zoho_project_mapping')
    .select('zoho_project_name, erp_project_id');

  if (!mappings || mappings.length === 0) {
    console.log('  No project mappings found — run phase 06 first');
    return result;
  }

  // Load ERP profitability totals via RPC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profRows, error: profErr } = await (admin as any)
    .rpc('get_project_profitability_v2');
  if (profErr) {
    result.errors.push({ row: 0, reason: 'profitability RPC failed: ' + profErr.message });
    return result;
  }

  const erpByProject = new Map<string, {
    total_invoiced: number;
    total_received: number;
    total_billed: number;
    total_vendor_paid: number;
  }>();
  for (const r of profRows ?? []) {
    erpByProject.set(r.project_id, {
      total_invoiced: Number(r.total_invoiced),
      total_received: Number(r.total_received),
      total_billed: Number(r.total_billed),
      total_vendor_paid: Number(r.total_vendor_paid),
    });
  }

  const TOLERANCE = 1; // ₹1 rounding tolerance
  const discrepancies: Array<{
    entity_type: string;
    entity_ref: string;
    metric: string;
    erp_value: number;
    zoho_value: number;
    diff: number;
  }> = [];

  for (const m of mappings) {
    const zohoName = m.zoho_project_name.toLowerCase().trim();
    const projectId = m.erp_project_id;
    const erp = erpByProject.get(projectId);
    const zohoInv = zohoInvByProj.get(zohoName);
    const zohoBill = zohoBillByProj.get(zohoName);

    if (zohoInv && erp) {
      const metrics: Array<[string, number, number]> = [
        ['total_invoiced', erp.total_invoiced, zohoInv.invoiced],
        ['total_received', erp.total_received, zohoInv.received],
      ];
      for (const [metric, erpVal, zohoVal] of metrics) {
        if (Math.abs(erpVal - zohoVal) > TOLERANCE) {
          discrepancies.push({
            entity_type: 'project_totals',
            entity_ref: projectId,
            metric,
            erp_value: erpVal,
            zoho_value: zohoVal,
            diff: erpVal - zohoVal,
          });
        }
      }
    }

    if (zohoBill && erp) {
      const metrics: Array<[string, number, number]> = [
        ['total_billed', erp.total_billed, zohoBill.billed],
        ['total_vendor_paid', erp.total_vendor_paid, zohoBill.paid],
      ];
      for (const [metric, erpVal, zohoVal] of metrics) {
        if (Math.abs(erpVal - zohoVal) > TOLERANCE) {
          discrepancies.push({
            entity_type: 'project_totals',
            entity_ref: projectId,
            metric,
            erp_value: erpVal,
            zoho_value: zohoVal,
            diff: erpVal - zohoVal,
          });
        }
      }
    }
  }

  console.log(`  Found ${discrepancies.length} discrepancies (>₹1 tolerance) across ${mappings.length} projects`);

  // Write markdown report
  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.resolve(__dirname, `../../docs/zoho-import-report-${today}.md`);
  const lines: string[] = [
    `# Zoho Import Reconciliation Report — ${today}`,
    '',
    `**Projects mapped:** ${mappings.length}`,
    `**Discrepancies found:** ${discrepancies.length}`,
    '',
    '## Summary',
    '',
    `| Entity | Metric | ERP Value | Zoho Value | Diff |`,
    `|--------|--------|-----------|------------|------|`,
    ...discrepancies.slice(0, 50).map(d =>
      `| ${d.entity_ref.slice(0, 8)} | ${d.metric} | ₹${d.erp_value.toLocaleString('en-IN')} | ₹${d.zoho_value.toLocaleString('en-IN')} | ₹${d.diff.toLocaleString('en-IN')} |`
    ),
  ];
  if (discrepancies.length > 50) lines.push(`\n_...and ${discrepancies.length - 50} more_`);

  if (!dryRun) {
    fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
    console.log(`  Report written to ${reportPath}`);

    // Write to reconciliation_discrepancies table
    if (discrepancies.length > 0) {
      const today2 = today;
      const dbRows = discrepancies.map(d => ({
        entity_type: d.entity_type as 'project_totals',
        entity_ref: d.entity_ref,
        metric: d.metric,
        erp_value: d.erp_value,
        zoho_value: d.zoho_value,
        discovered_date: today2,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from('reconciliation_discrepancies')
        .upsert(dbRows, { onConflict: 'entity_type,entity_ref,metric,discovered_date' });
      if (error) {
        result.errors.push({ row: 0, reason: 'write discrepancies: ' + error.message });
      } else {
        result.inserted = dbRows.length;
      }
    }
  } else {
    console.log(`  DRY RUN: would write ${discrepancies.length} discrepancies`);
    result.skipped = discrepancies.length;
  }

  return result;
}
