/**
 * Phase 2 — seed reconciliation data on DEV (idempotent).
 *
 * Loads Manivel's workbook into `recon_sheet_projects`, runs the SAME matcher the
 * audit used (imported from reconcile-manivel.ts), pulls the ERP profitability
 * rollup, and writes one `project_reconciliation` row per active ERP project
 * (matched proposal or erp_only). Core `projects` rows are NOT touched — Manivel
 * confirms/overrides in the reconciliation UI.
 *
 * Run: pnpm exec tsx scripts/seed-manivel-reconciliation.ts
 */
import { admin, loadSheet, loadErp, computeMatches, type ReconRow } from './reconcile-manivel';

const DUMMY = '00000000-0000-0000-0000-000000000000';

async function run() {
  const sheet = loadSheet();
  const erp = await loadErp();
  const { rows } = computeMatches(sheet, erp);
  console.log(`Sheet: ${sheet.length}  ERP: ${erp.length}`);

  // 1. reset (idempotent) — children first
  await admin.from('project_reconciliation').delete().neq('project_id', DUMMY);
  await admin.from('recon_sheet_projects').delete().neq('id', DUMMY);

  // 2. insert sheet snapshot, capture generated ids by normalized name
  const sheetInsert = sheet.map((s) => ({
    sheet_no: s.no, name: s.name, name_norm: s.nameNorm, size_kwp: s.size, status: s.status,
    location: s.location, sheet_year: s.year, project_cost: s.projectCost,
    actual_cost: s.actualCost, profit_rs: s.profitRs,
  }));
  const { data: inserted, error: insErr } = await admin
    .from('recon_sheet_projects').insert(sheetInsert).select('id, name_norm');
  if (insErr) throw new Error(`recon_sheet_projects insert failed: ${insErr.message}`);
  const sheetIdByNorm = new Map<string, string>();
  for (const r of inserted ?? []) sheetIdByNorm.set(r.name_norm as string, r.id as string);
  console.log(`recon_sheet_projects: ${inserted?.length ?? 0} rows`);

  // 3. ERP profitability rollup (SQL-computed; never aggregated in JS)
  const { data: prof, error: profErr } = await admin.rpc('get_project_profitability');
  if (profErr) throw new Error(`profitability rpc failed: ${profErr.message}`);
  const profById = new Map<string, { revenue: number | null; cost: number | null }>();
  for (const p of (prof ?? []) as Array<Record<string, unknown>>) {
    profById.set(p.project_id as string, {
      revenue: p.revenue_erp == null ? null : Number(p.revenue_erp),
      cost: p.cost_erp == null ? null : Number(p.cost_erp),
    });
  }

  // 4. best (highest-score) sheet match per ERP project — resolves collisions
  const bestByErp = new Map<string, ReconRow>();
  for (const r of rows) {
    if (!r.erp || r.bucket === 'sheet-only') continue;
    const prev = bestByErp.get(r.erp.id);
    if (!prev || r.score > prev.score) bestByErp.set(r.erp.id, r);
  }

  // 5. one project_reconciliation row per ERP project
  const reconRows = erp.map((e) => {
    const m = bestByErp.get(e.id);
    const pf = profById.get(e.id) ?? { revenue: e.contracted, cost: null };
    if (m) {
      return {
        project_id: e.id,
        matched_sheet_id: sheetIdByNorm.get(m.sheet.nameNorm) ?? null,
        match_score: m.score,
        match_method: m.bucket === 'sheet-only' ? 'ambiguous' : m.bucket,
        status: 'proposed',
        resolved_year: m.sheet.year ?? e.orderYear ?? null,
        resolved_status: e.status,
        sheet_project_cost: m.sheet.projectCost,
        sheet_actual_cost: m.sheet.actualCost,
        revenue_erp: pf.revenue,
        cost_erp: pf.cost,
        preferred_source: 'erp',
      };
    }
    // erp-only: not in the sheet → older pre-2022 history unless it carries a real order year
    return {
      project_id: e.id,
      matched_sheet_id: null,
      match_score: null,
      match_method: 'erp_only',
      status: 'proposed',
      resolved_year: e.orderYear ?? 2021,
      resolved_status: e.status,
      sheet_project_cost: null,
      sheet_actual_cost: null,
      revenue_erp: pf.revenue,
      cost_erp: pf.cost,
      preferred_source: 'erp',
    };
  });

  // chunked insert
  let n = 0;
  for (let i = 0; i < reconRows.length; i += 200) {
    const chunk = reconRows.slice(i, i + 200);
    const { error } = await admin.from('project_reconciliation').insert(chunk);
    if (error) throw new Error(`project_reconciliation insert failed @${i}: ${error.message}`);
    n += chunk.length;
  }

  const byMethod = reconRows.reduce<Record<string, number>>((a, r) => {
    a[r.match_method] = (a[r.match_method] ?? 0) + 1; return a;
  }, {});
  console.log(`project_reconciliation: ${n} rows`, byMethod);
  console.log('Seed complete.');
}

run().catch((e) => { console.error(e); process.exit(1); });
