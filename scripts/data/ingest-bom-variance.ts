/**
 * scripts/data/ingest-bom-variance.ts
 *
 * S5 — T5.1 — One-shot backfill script for bom_actual_vs_budgetary.
 *
 * Status: bom_actual_vs_budgetary has 0 rows; vendor_delivery_challan_items
 * also has 0 rows. The only source of both planned and received quantities
 * is project_boq_items, which has 751 rows across 58 projects.
 *
 * This script derives variance from project_boq_items alone:
 *   budgetary_qty    = quantity (BOQ planned quantity)
 *   actual_qty       = received_qty (GRN received quantity)
 *   budgetary_total  = quantity × unit_price (planned cost)
 *   actual_total     = received_qty × unit_price (received cost at BOQ rate)
 *
 * Note: actual_unit_cost is not separately recorded — we reuse unit_price.
 * Once vendor bills are keyed in, this should be rerun with actual invoice
 * unit costs to get true variance. This backfill gives a baseline.
 *
 * Category mapping (BOQ item_category → bom_actual_vs_budgetary category):
 *   solar_panels         → panels
 *   inverter             → inverter
 *   mms                  → mounting_structure
 *   dc_accessories       → dc_cable
 *   ac_accessories       → ac_cable
 *   earthing_accessories → earthing
 *   ic                   → la_system
 *   conduits             → accessories
 *   generation_meter     → accessories
 *   safety_accessories   → accessories
 *   transport_civil      → other
 *   statutory_approvals  → other
 *   miscellaneous        → other
 *   others               → other
 *
 * Multiple BOQ rows in the same (project, category) are summed before upsert.
 *
 * Usage:
 *   npx tsx scripts/data/ingest-bom-variance.ts [--dry-run] [--project-id <uuid>]
 *
 * Prerequisites:
 *   - PROD_SUPABASE_URL and PROD_SUPABASE_SECRET_KEY (or dev equivalents) in env
 *   - Or set INGEST_SUPABASE_URL / INGEST_SUPABASE_KEY for an override
 *
 * DO NOT run on prod without Vivek's explicit approval — this mutates
 * bom_actual_vs_budgetary rows for completed projects.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../packages/types/database';

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, string> = {
  solar_panels: 'panels',
  inverter: 'inverter',
  mms: 'mounting_structure',
  dc_accessories: 'dc_cable',
  ac_accessories: 'ac_cable',
  earthing_accessories: 'earthing',
  ic: 'la_system',
  conduits: 'accessories',
  generation_meter: 'accessories',
  safety_accessories: 'accessories',
  transport_civil: 'other',
  statutory_approvals: 'other',
  miscellaneous: 'other',
  others: 'other',
};

function mapCategory(boqCategory: string): string {
  return CATEGORY_MAP[boqCategory] ?? 'other';
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const projectIdArg = args.includes('--project-id') ? args[args.indexOf('--project-id') + 1] : null;

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

function buildClient() {
  const url = process.env.INGEST_SUPABASE_URL ?? process.env.PROD_SUPABASE_URL;
  const key = process.env.INGEST_SUPABASE_KEY ?? process.env.PROD_SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      'Set INGEST_SUPABASE_URL + INGEST_SUPABASE_KEY (or PROD_SUPABASE_URL + PROD_SUPABASE_SECRET_KEY) to run this script.',
    );
  }

  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== ingest-bom-variance ${DRY_RUN ? '[DRY RUN]' : '[WRITE MODE]'} ===`);
  if (projectIdArg) console.log(`Scoped to project: ${projectIdArg}`);

  const supabase = buildClient();

  // 1. Fetch BOQ items
  let query = supabase
    .from('project_boq_items')
    .select('project_id, item_category, quantity, received_qty, unit_price, total_price');

  if (projectIdArg) {
    query = query.eq('project_id', projectIdArg);
  }

  const { data: boqItems, error: fetchErr } = await query;

  if (fetchErr) {
    console.error('Failed to fetch project_boq_items:', fetchErr.message);
    process.exit(1);
  }

  if (!boqItems || boqItems.length === 0) {
    console.log('No BOQ items found — nothing to ingest.');
    return;
  }

  console.log(`Fetched ${boqItems.length} BOQ rows`);

  // 2. Aggregate by (project_id, mapped_category)
  type Agg = {
    project_id: string;
    category: string;
    budgetary_qty: number;
    actual_qty: number;
    budgetary_total: number;
    actual_total: number;
  };

  const aggMap = new Map<string, Agg>();

  for (const item of boqItems) {
    const category = mapCategory(item.item_category);
    const key = `${item.project_id}::${category}`;

    const qty = item.quantity ?? 0;
    const receivedQty = item.received_qty ?? 0;
    const unitPrice = item.unit_price ?? 0;

    const existing = aggMap.get(key);
    if (existing) {
      existing.budgetary_qty += qty;
      existing.actual_qty += receivedQty;
      existing.budgetary_total += qty * unitPrice;
      existing.actual_total += receivedQty * unitPrice;
    } else {
      aggMap.set(key, {
        project_id: item.project_id,
        category,
        budgetary_qty: qty,
        actual_qty: receivedQty,
        budgetary_total: qty * unitPrice,
        actual_total: receivedQty * unitPrice,
      });
    }
  }

  const rows = Array.from(aggMap.values());
  console.log(`Aggregated to ${rows.length} (project, category) rows`);

  if (DRY_RUN) {
    console.log('\nDry-run: first 10 rows that would be upserted:');
    for (const r of rows.slice(0, 10)) {
      const varPct =
        r.budgetary_total > 0
          ? (((r.actual_total - r.budgetary_total) / r.budgetary_total) * 100).toFixed(1)
          : 'N/A';
      console.log(
        `  ${r.project_id.slice(0, 8)}… | ${r.category.padEnd(20)} | budg=${r.budgetary_qty} units ₹${r.budgetary_total.toFixed(0)} | actual=${r.actual_qty} units ₹${r.actual_total.toFixed(0)} | variance=${varPct}%`,
      );
    }
    console.log('\nDry-run complete — no writes.');
    return;
  }

  // 3. Upsert into bom_actual_vs_budgetary
  const today = new Date().toISOString().slice(0, 10);

  const upsertPayload = rows.map((r) => ({
    project_id: r.project_id,
    category: r.category,
    budgetary_qty: Math.round(r.budgetary_qty * 100) / 100,
    actual_qty: Math.round(r.actual_qty * 100) / 100,
    budgetary_unit_cost: null, // unit cost not reliably derivable from aggregated rows
    actual_unit_cost: null,
    budgetary_total_cost: Math.round(r.budgetary_total * 100) / 100,
    actual_total_cost: Math.round(r.actual_total * 100) / 100,
    recorded_at: today,
    updated_at: new Date().toISOString(),
  }));

  // Batch in chunks of 100 to avoid payload limits
  const CHUNK = 100;
  let upserted = 0;
  let failed = 0;

  for (let i = 0; i < upsertPayload.length; i += CHUNK) {
    const chunk = upsertPayload.slice(i, i + CHUNK);
    const { error: upsertErr } = await supabase
      .from('bom_actual_vs_budgetary')
      .upsert(chunk, { onConflict: 'project_id,category,recorded_at' });

    if (upsertErr) {
      console.error(`Chunk ${i / CHUNK + 1} failed:`, upsertErr.message);
      failed += chunk.length;
    } else {
      upserted += chunk.length;
      process.stdout.write(`\r  Upserted ${upserted}/${upsertPayload.length}…`);
    }
  }

  console.log(`\n\nDone. ${upserted} rows upserted, ${failed} failed.`);

  if (failed > 0) {
    console.warn('Some rows failed — check upsert conflict policy and table constraints.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
