/**
 * Phase 6: Recalculate BOM Correction Factors from Real Project Data
 *
 * With both budget (proposal_bom_lines) and actual (purchase_order_items) data,
 * compute per-category correction factors from completed projects.
 *
 * correction_factor = AVG(actual_cost / budget_cost) per item_category
 *
 * Usage:
 *   npx tsx scripts/recalculate-correction-factors.ts --dry-run
 *   npx tsx scripts/recalculate-correction-factors.ts
 */

import { createClient } from '@supabase/supabase-js';
import { isDryRun, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function main() {
  const op = '[recalc-correction-factors]';
  const dry = isDryRun();

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}`);

  // ═══ Step 1: Get completed projects with both BOM and PO data ═══
  console.log(`${op} Finding completed projects with budget + actual data...`);

  const { data: projects, error: projError } = await supabase
    .from('projects')
    .select('id, proposal_id, lead_id, status')
    .eq('status', 'completed');

  if (projError || !projects) {
    console.error(`${op} Failed to fetch projects:`, projError?.message);
    return;
  }
  console.log(`${op} ${projects.length} completed projects`);

  // Get proposals for these projects
  const proposalIds = projects.map((p) => p.proposal_id).filter(Boolean) as string[];

  // Get BOM lines grouped by proposal + category
  const { data: bomLines } = await supabase
    .from('proposal_bom_lines')
    .select('proposal_id, item_category, total_price')
    .in('proposal_id', proposalIds);

  if (!bomLines || bomLines.length === 0) {
    console.log(`${op} No BOM lines found for completed projects`);
    return;
  }

  // Build proposal → { category → total_budget }
  const budgetByProposal = new Map<string, Map<string, number>>();
  for (const line of bomLines) {
    if (!budgetByProposal.has(line.proposal_id)) {
      budgetByProposal.set(line.proposal_id, new Map());
    }
    const catMap = budgetByProposal.get(line.proposal_id)!;
    catMap.set(line.item_category, (catMap.get(line.item_category) ?? 0) + (line.total_price ?? 0));
  }

  console.log(`${op} ${budgetByProposal.size} proposals have BOM budget data`);

  // Get PO items grouped by project + category
  const projectIds = projects.map((p) => p.id);

  const { data: poItems } = await supabase
    .from('purchase_order_items')
    .select('purchase_order_id, item_category, total_price')
    .limit(10000);

  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, project_id')
    .in('project_id', projectIds);

  if (!poItems || !pos) {
    console.log(`${op} No PO data found`);
    return;
  }

  // Build project → { category → total_actual }
  const poByProject = new Map<string, string>(); // po_id → project_id
  for (const po of pos) {
    poByProject.set(po.id, po.project_id);
  }

  const actualByProject = new Map<string, Map<string, number>>();
  for (const item of poItems) {
    const projectId = poByProject.get(item.purchase_order_id);
    if (!projectId) continue;
    if (!actualByProject.has(projectId)) {
      actualByProject.set(projectId, new Map());
    }
    const catMap = actualByProject.get(projectId)!;
    catMap.set(item.item_category, (catMap.get(item.item_category) ?? 0) + (item.total_price ?? 0));
  }

  console.log(`${op} ${actualByProject.size} projects have PO actual data`);

  // ═══ Step 2: Calculate correction factors per category ═══
  const corrections = new Map<string, { ratios: number[]; budgetTotal: number; actualTotal: number }>();

  for (const project of projects) {
    if (!project.proposal_id) continue;
    const budget = budgetByProposal.get(project.proposal_id);
    const actual = actualByProject.get(project.id);
    if (!budget || !actual) continue;

    // For each category present in BOTH budget and actual
    for (const [category, budgetAmt] of budget.entries()) {
      const actualAmt = actual.get(category);
      if (!actualAmt || budgetAmt === 0) continue;

      if (!corrections.has(category)) {
        corrections.set(category, { ratios: [], budgetTotal: 0, actualTotal: 0 });
      }
      const entry = corrections.get(category)!;
      entry.ratios.push(actualAmt / budgetAmt);
      entry.budgetTotal += budgetAmt;
      entry.actualTotal += actualAmt;
    }
  }

  console.log(`\n${op} Correction factors from ${corrections.size} categories:`);
  console.log(`${'Category'.padEnd(22)} ${'Factor'.padEnd(8)} ${'Data Pts'.padEnd(10)} ${'Avg Budget'.padEnd(14)} ${'Avg Actual'.padEnd(14)} Interpretation`);
  console.log('-'.repeat(90));

  const results: { category: string; factor: number; dataPoints: number }[] = [];

  for (const [category, data] of [...corrections.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (data.ratios.length < 2) continue; // Need at least 2 data points

    // Use median for robustness (outlier resistant)
    const sorted = data.ratios.sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const factor = Math.round(median * 100) / 100;
    const avgBudget = data.budgetTotal / data.ratios.length;
    const avgActual = data.actualTotal / data.ratios.length;
    const interp = factor > 1.05 ? 'OVER budget' : factor < 0.95 ? 'UNDER budget' : 'ON budget';

    console.log(
      `  ${category.padEnd(20)} ${factor.toFixed(2).padEnd(8)} ${String(data.ratios.length).padEnd(10)} ₹${Math.round(avgBudget).toLocaleString('en-IN').padEnd(12)} ₹${Math.round(avgActual).toLocaleString('en-IN').padEnd(12)} ${interp}`
    );

    results.push({ category, factor, dataPoints: data.ratios.length });
  }

  logMigrationStart('recalc-correction-factors', results.length);

  let stats = { updated: 0, errors: 0 };

  if (!dry && results.length > 0) {
    // Check if bom_correction_factors table exists
    const { data: tableCheck } = await supabase
      .from('bom_correction_factors')
      .select('id')
      .limit(1);

    if (tableCheck !== null) {
      for (const r of results) {
        const { error } = await supabase
          .from('bom_correction_factors')
          .upsert({
            item_category: r.category,
            correction_factor: r.factor,
            data_points_count: r.dataPoints,
            is_active: true,
            updated_at: new Date().toISOString(),
            notes: `[RECALCULATED] From ${r.dataPoints} completed projects on ${new Date().toISOString().split('T')[0]}`,
          }, { onConflict: 'item_category' });

        if (error) {
          console.error(`  ${op} Upsert error for ${r.category}: ${error.message}`);
          stats.errors++;
        } else {
          stats.updated++;
        }
      }
    } else {
      console.log(`${op} bom_correction_factors table not found — logging results only`);
    }
  }

  logMigrationEnd('recalc-correction-factors', {
    processed: results.length,
    inserted: dry ? results.length : stats.updated,
    skipped: 0,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[recalc-correction-factors] Fatal error:', err);
  process.exit(1);
});
