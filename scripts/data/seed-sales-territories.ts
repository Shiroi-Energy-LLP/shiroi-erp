/**
 * scripts/data/seed-sales-territories.ts
 *
 * Idempotent seed for `sales_territories` — Tamil Nadu coverage.
 * Uses INSERT … ON CONFLICT DO NOTHING semantics via upsert with ignoreDuplicates.
 *
 * Usage:
 *   pnpm seed:territories
 *   # or directly:
 *   tsx scripts/data/seed-sales-territories.ts
 *
 * Required env vars (loaded from .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *
 * The script looks up Prem's employee row by first name match.
 * If not found, it warns and seeds those rows with NULL assignee.
 * It never throws on missing Prem — all 7 territories are always seeded.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../packages/types/database';

// Load .env.local from repo root
const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Client ────────────────────────────────────────────────────────────────────

function buildClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local to run this script.',
    );
  }

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Territory definitions ─────────────────────────────────────────────────────

interface TerritoryDef {
  territory_name: string;
  cities: string[];
  segment: string | null;
  assignee_key: 'prem' | null; // which named rep to assign, or null
}

const TERRITORIES: TerritoryDef[] = [
  {
    territory_name: 'Chennai South',
    cities: [
      'chennai', 'tambaram', 'chrompet', 'pallavaram', 'velachery',
      'adyar', 'guindy', 'perungudi', 'ambattur', 'sholinganallur', 'omr',
    ],
    segment: null,
    assignee_key: 'prem',
  },
  {
    territory_name: 'Chennai North',
    cities: [
      'madhavaram', 'manali', 'tondiarpet', 'royapuram', 'ennore',
      'redhills', 'korattur', 'mogappair', 'anna nagar', 'kilpauk',
      't. nagar', 'mylapore',
    ],
    segment: null,
    assignee_key: 'prem',
  },
  {
    territory_name: 'Coimbatore',
    cities: ['coimbatore', 'peelamedu', 'saravanampatti', 'podanur'],
    segment: null,
    assignee_key: null, // no rep yet — fallback to Prem handled at routing time
  },
  {
    territory_name: 'Trichy + Madurai',
    cities: ['trichy', 'tiruchirappalli', 'madurai', 'dindigul', 'karur'],
    segment: null,
    assignee_key: null,
  },
  {
    territory_name: 'Salem + Erode',
    cities: ['salem', 'erode', 'namakkal', 'dharmapuri', 'krishnagiri'],
    segment: null,
    assignee_key: null,
  },
  {
    territory_name: 'Tirunelveli + South TN',
    cities: ['tirunelveli', 'thoothukudi', 'kanyakumari', 'nagercoil'],
    segment: null,
    assignee_key: null,
  },
  {
    territory_name: 'Vellore + North TN',
    cities: ['vellore', 'ranipet', 'tirupattur', 'hosur', 'kanchipuram', 'chengalpattu'],
    segment: null,
    assignee_key: null,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== seed-sales-territories ===\n');

  const supabase = buildClient();

  // 1. Look up Prem's employee id
  let premId: string | null = null;

  const { data: premRows, error: premErr } = await supabase
    .from('employees')
    .select('id, full_name')
    .ilike('full_name', '%prem%')
    .eq('is_active', true)
    .limit(5);

  if (premErr) {
    console.warn(`[seed] WARN: Failed to look up Prem — will seed as NULL assignee:`, premErr.message);
  } else if (!premRows || premRows.length === 0) {
    console.warn('[seed] WARN: No active employee matching "prem" found — Chennai territories will have NULL assignee.');
  } else {
    if (premRows.length > 1) {
      console.warn(
        `[seed] WARN: Multiple employees match "prem" (${premRows.map((r) => r.full_name).join(', ')}) — using first: ${premRows[0]!.full_name}`,
      );
    }
    premId = premRows[0]!.id;
    console.log(`[seed] Found Prem: "${premRows[0]!.full_name}" (${premId})`);
  }

  // 2. Resolve assignees
  const assigneeMap: Record<'prem', string | null> = { prem: premId };

  // 3. Build insert rows
  const rows: Database['public']['Tables']['sales_territories']['Insert'][] = TERRITORIES.map(
    (t) => ({
      territory_name: t.territory_name,
      cities: t.cities,
      segment: t.segment,
      default_assignee_employee_id:
        t.assignee_key ? (assigneeMap[t.assignee_key] ?? null) : null,
      active: true,
    }),
  );

  // 4. Upsert — ON CONFLICT DO NOTHING (ignoreDuplicates)
  // The table has no unique constraint on territory_name, so we check existence first
  // and skip rows that already exist by name (idempotent).
  const { data: existing, error: existErr } = await supabase
    .from('sales_territories')
    .select('territory_name');

  if (existErr) {
    console.error('[seed] ERROR: Failed to query existing territories:', existErr.message);
    process.exit(1);
  }

  const existingNames = new Set((existing ?? []).map((r) => r.territory_name));

  const toInsert = rows.filter((r) => !existingNames.has(r.territory_name!));
  const toSkip = rows.filter((r) => existingNames.has(r.territory_name!));

  if (toSkip.length > 0) {
    console.log(`[seed] Skipping ${toSkip.length} already-existing territories:`);
    toSkip.forEach((r) => console.log(`  • ${r.territory_name}`));
  }

  if (toInsert.length === 0) {
    console.log('\n[seed] All territories already exist — nothing to insert.');
    console.log('\n=== Done ===\n');
    return;
  }

  console.log(`\n[seed] Inserting ${toInsert.length} territories:`);
  toInsert.forEach((r) => {
    const assigneeLabel = r.default_assignee_employee_id
      ? `${r.default_assignee_employee_id.slice(0, 8)}…`
      : 'NULL (no assignee)';
    console.log(`  • ${r.territory_name} — ${r.cities?.length ?? 0} cities — assignee: ${assigneeLabel}`);
  });

  const { error: insertErr } = await supabase.from('sales_territories').insert(toInsert);

  if (insertErr) {
    console.error('\n[seed] ERROR: Insert failed:', insertErr.message);
    process.exit(1);
  }

  console.log('\n[seed] All territories inserted successfully.');
  console.log('\n=== Done ===\n');
}

main().catch((e) => {
  console.error('[seed] Fatal error:', e);
  process.exit(1);
});
