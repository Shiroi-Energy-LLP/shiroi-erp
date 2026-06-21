/**
 * seed-bom-imports.ts
 *
 * Parses the per-project "Bill Of Materials" sheets in se-master-file with the
 * shared tolerant parser (apps/erp/src/lib/bom-sheet-parser), fuzzy-matches each
 * to an existing project via the match_project_by_name RPC, and INSERTs a row
 * into pending_bom_imports for review at /bom-review/import.
 *
 * Nothing is written to project_boq_items here — that happens only when a
 * founder/PM confirms a sheet in the review UI (approve_bom_import).
 *
 * Usage:
 *   pnpm tsx scripts/seed-bom-imports.ts --dry-run   # parse + match, no writes
 *   pnpm tsx scripts/seed-bom-imports.ts             # execute (seeds dev)
 *
 * Idempotent: skips a (source_file_name, sheet_name) already present in a
 * pending/imported row.
 */

import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { parseBomWorkbook, type ParsedBomSheet } from '../apps/erp/src/lib/bom-sheet-parser';

loadEnv({ path: resolve('.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SUPABASE_SECRET) throw new Error('.env.local missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');

const DRY_RUN = process.argv.includes('--dry-run');
const SE_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'scripts/data/se-master-file-2026-06-05.xlsx';

const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

interface MatchCandidate {
  project_id: string;
  customer_name: string;
  project_number: string;
  score: number;
}

function classify(score: number): 'exact' | 'fuzzy' | 'none' {
  if (score >= 0.85) return 'exact';
  if (score >= 0.45) return 'fuzzy';
  return 'none';
}

async function matchProject(name: string): Promise<MatchCandidate[]> {
  const { data, error } = await sb.rpc('match_project_by_name', { p_name: name, p_limit: 5 });
  if (error) {
    console.warn(`  ! match_project_by_name failed for "${name}": ${error.message}`);
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    project_id: String(r.project_id),
    customer_name: String(r.customer_name ?? ''),
    project_number: String(r.project_number ?? ''),
    score: Number(r.score ?? 0),
  }));
}

async function main() {
  const fileName = basename(SE_PATH);
  console.log(`\n[seed-bom-imports] ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'} — ${fileName}\n`);

  const buf = toArrayBuffer(readFileSync(resolve(SE_PATH)));
  const { sheets, warnings } = await parseBomWorkbook(buf);
  for (const w of warnings) console.log(`  · ${w}`);

  const batchId = randomUUID();
  let seeded = 0;
  let skipped = 0;
  const tallies = { exact: 0, fuzzy: 0, none: 0 };

  for (const sheet of sheets as ParsedBomSheet[]) {
    const candidates = await matchProject(sheet.projectName);
    const top = candidates[0];
    const confidence = top ? classify(top.score) : 'none';
    tallies[confidence]++;
    const matchedId = top && top.score >= 0.45 ? top.project_id : null;

    console.log(
      `  ${sheet.sheetName.padEnd(28)} → ${String(sheet.lines.length).padStart(3)} lines | ` +
        `${confidence.padEnd(5)} ${top ? `${top.score.toFixed(3)} ${top.customer_name}` : '(no candidate)'}`,
    );

    if (DRY_RUN) continue;

    const { data: existing } = await sb
      .from('pending_bom_imports')
      .select('id')
      .eq('source_file_name', fileName)
      .eq('sheet_name', sheet.sheetName)
      .in('status_review', ['pending', 'imported'])
      .limit(1);
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error } = await sb.from('pending_bom_imports').insert({
      import_batch_id: batchId,
      source_file_name: fileName,
      sheet_name: sheet.sheetName,
      project_name: sheet.projectName,
      normalized_name: sheet.normalizedName,
      matched_project_id: matchedId,
      match_confidence: confidence,
      match_score: top?.score ?? 0,
      match_candidates: candidates,
      header: sheet.header,
      parsed_lines: sheet.lines,
      summary: sheet.summary,
      line_count: sheet.lines.length,
    });
    if (error) {
      console.warn(`  ! insert failed for "${sheet.sheetName}": ${error.message}`);
      continue;
    }
    seeded++;
  }

  console.log(
    `\n[seed-bom-imports] sheets=${sheets.length} ` +
      `match[exact=${tallies.exact} fuzzy=${tallies.fuzzy} none=${tallies.none}] ` +
      (DRY_RUN ? '(dry-run, no writes)' : `seeded=${seeded} skipped=${skipped} batch=${batchId}`),
  );
}

main().catch((e) => {
  console.error('[seed-bom-imports] FATAL', e);
  process.exit(1);
});
