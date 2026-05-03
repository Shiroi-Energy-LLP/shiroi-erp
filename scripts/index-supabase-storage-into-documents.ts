/**
 * Phase 2 backfill: walk the `proposal-files` Supabase Storage bucket and
 * create `documents` rows for each file that isn't already indexed.
 *
 * Bucket layout (mig 013): `proposal-files/{lead_id}/{filename}`. Lead IDs
 * are top-level "directories" within the bucket. We list each lead's files
 * and insert one documents row per file with:
 *   - lead_id = the directory name
 *   - storage_backend = 'supabase'
 *   - storage_path = `{lead_id}/{filename}`
 *   - category inferred from extension (PDF → proposal_pdf, image → site
 *     survey photo, xlsx → costing_sheet, default → misc)
 *   - mime_type + size_bytes from storage object metadata
 *
 * Idempotency: skip if a documents row already exists with the same
 * (lead_id, storage_path) tuple. Run with --dry-run first to see counts.
 *
 * Run:
 *   npx tsx scripts/index-supabase-storage-into-documents.ts --dry-run
 *   npx tsx scripts/index-supabase-storage-into-documents.ts
 *
 * Output: console summary + scripts/data/documents-backfill-storage-audit.csv
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, extname } from 'path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

type DocumentCategory =
  | 'site_survey_photo'
  | 'roof_layout'
  | 'cad_drawing'
  | 'sketchup_model'
  | 'proposal_pdf'
  | 'costing_sheet'
  | 'bom_excel'
  | 'electricity_bill'
  | 'kyc_document'
  | 'invoice'
  | 'misc';

function inferCategoryFromName(filename: string, mime: string | undefined): DocumentCategory {
  const ext = extname(filename).toLowerCase();
  const lower = filename.toLowerCase();
  if (ext === '.pdf') {
    if (lower.includes('proposal') || lower.includes('quote')) return 'proposal_pdf';
    if (lower.includes('invoice')) return 'invoice';
    if (lower.includes('bill')) return 'electricity_bill';
    return 'proposal_pdf';
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    if (lower.includes('bom')) return 'bom_excel';
    if (lower.includes('cost')) return 'costing_sheet';
    return 'costing_sheet';
  }
  if (ext === '.dwg') return 'cad_drawing';
  if (ext === '.skp') return 'sketchup_model';
  if (mime && mime.startsWith('image/')) {
    if (lower.includes('layout') || lower.includes('roof')) return 'roof_layout';
    return 'site_survey_photo';
  }
  return 'misc';
}

interface AuditRow {
  lead_id: string;
  filename: string;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  inferred_category: DocumentCategory;
  action: 'inserted' | 'skipped_duplicate' | 'skipped_lead_missing' | 'failed';
  error?: string;
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } });
  console.log(`[indexer] DRY_RUN=${DRY_RUN} verbose=${VERBOSE}`);

  // 1. List top-level "directories" (= lead UUIDs) in proposal-files bucket
  const { data: topLevel, error: topErr } = await supabase.storage
    .from('proposal-files')
    .list('', { limit: 5000 });
  if (topErr) {
    console.error('[indexer] List top-level failed', topErr);
    process.exit(1);
  }

  const leadIds = (topLevel ?? [])
    .filter((entry) => !entry.name.includes('.'))
    .map((entry) => entry.name);
  console.log(`[indexer] Found ${leadIds.length} lead directories in proposal-files/`);

  // 2. Fetch existing lead IDs to validate (skip orphan files)
  const { data: validLeads } = await supabase.from('leads').select('id');
  const validLeadSet = new Set((validLeads ?? []).map((l: { id: string }) => l.id));
  console.log(`[indexer] ${validLeadSet.size} valid lead rows in DB`);

  // 3. Fetch existing documents (lead_id, storage_path) tuples for dedup
  const { data: existingDocs } = await supabase
    .from('documents')
    .select('lead_id, storage_path')
    .eq('storage_backend', 'supabase')
    .not('storage_path', 'is', null);
  const existingSet = new Set(
    (existingDocs ?? []).map(
      (d: { lead_id: string | null; storage_path: string | null }) => `${d.lead_id}::${d.storage_path}`,
    ),
  );
  console.log(`[indexer] ${existingSet.size} documents already indexed`);

  const audit: AuditRow[] = [];
  let inserted = 0;
  let skippedDup = 0;
  let skippedOrphan = 0;
  let failed = 0;

  for (const leadId of leadIds) {
    if (!validLeadSet.has(leadId)) {
      // Probably an orphan directory — skip
      audit.push({
        lead_id: leadId,
        filename: '(directory)',
        storage_path: leadId,
        size_bytes: null,
        mime_type: null,
        inferred_category: 'misc',
        action: 'skipped_lead_missing',
      });
      skippedOrphan++;
      continue;
    }

    const { data: files, error: listErr } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
    if (listErr) {
      console.error(`[indexer] List ${leadId} failed:`, listErr.message);
      continue;
    }

    for (const file of files ?? []) {
      if (file.name.startsWith('.')) continue; // skip placeholder files
      const storagePath = `${leadId}/${file.name}`;
      const dedupKey = `${leadId}::${storagePath}`;

      if (existingSet.has(dedupKey)) {
        audit.push({
          lead_id: leadId,
          filename: file.name,
          storage_path: storagePath,
          size_bytes: null,
          mime_type: null,
          inferred_category: 'misc',
          action: 'skipped_duplicate',
        });
        skippedDup++;
        continue;
      }

      const meta = (file.metadata ?? {}) as Record<string, unknown>;
      const size = typeof meta.size === 'number' ? meta.size : null;
      const mime = typeof meta.mimetype === 'string' ? meta.mimetype : null;
      const category = inferCategoryFromName(file.name, mime ?? undefined);

      if (DRY_RUN) {
        audit.push({
          lead_id: leadId,
          filename: file.name,
          storage_path: storagePath,
          size_bytes: size,
          mime_type: mime,
          inferred_category: category,
          action: 'inserted',
        });
        inserted++;
        if (VERBOSE) console.log(`[indexer]   would insert: ${storagePath} (${category})`);
        continue;
      }

      const insertRow = {
        lead_id: leadId,
        category,
        storage_backend: 'supabase' as const,
        storage_path: storagePath,
        name: file.name,
        mime_type: mime,
        size_bytes: size,
        tags: [] as string[],
      };

      const { error: insertErr } = await supabase.from('documents').insert(insertRow);
      if (insertErr) {
        console.error(`[indexer] Insert failed: ${storagePath}`, insertErr.message);
        audit.push({
          lead_id: leadId,
          filename: file.name,
          storage_path: storagePath,
          size_bytes: size,
          mime_type: mime,
          inferred_category: category,
          action: 'failed',
          error: insertErr.message,
        });
        failed++;
      } else {
        audit.push({
          lead_id: leadId,
          filename: file.name,
          storage_path: storagePath,
          size_bytes: size,
          mime_type: mime,
          inferred_category: category,
          action: 'inserted',
        });
        inserted++;
        if (VERBOSE) console.log(`[indexer]   inserted: ${storagePath} (${category})`);
      }
    }
  }

  console.log('---');
  console.log(`[indexer] Summary:`);
  console.log(`  Lead directories scanned: ${leadIds.length}`);
  console.log(`  Documents ${DRY_RUN ? 'would be inserted' : 'inserted'}: ${inserted}`);
  console.log(`  Skipped (already indexed): ${skippedDup}`);
  console.log(`  Skipped (lead missing in DB): ${skippedOrphan}`);
  console.log(`  Failed: ${failed}`);

  // Write audit CSV
  mkdirSync('scripts/data', { recursive: true });
  const csvHeader = 'lead_id,filename,storage_path,size_bytes,mime_type,inferred_category,action,error\n';
  const csvBody = audit
    .map((r) =>
      [
        r.lead_id,
        `"${r.filename.replace(/"/g, '""')}"`,
        `"${r.storage_path.replace(/"/g, '""')}"`,
        r.size_bytes ?? '',
        r.mime_type ?? '',
        r.inferred_category,
        r.action,
        r.error ? `"${r.error.replace(/"/g, '""')}"` : '',
      ].join(','),
    )
    .join('\n');
  const csvPath = resolve(process.cwd(), 'scripts/data/documents-backfill-storage-audit.csv');
  writeFileSync(csvPath, csvHeader + csvBody, 'utf-8');
  console.log(`[indexer] Audit written to ${csvPath}`);
}

main().catch((e) => {
  console.error('[indexer] Fatal:', e);
  process.exit(1);
});
