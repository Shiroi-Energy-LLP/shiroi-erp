/**
 * Phase 2 orchestrator: walk all `documents` rows missing `extracted_text`
 * and call the `process-document` edge function for each. Rate-limited
 * (10 RPS by default, configurable) to respect API quotas.
 *
 * Idempotency: skips documents that already have extracted_text (the edge
 * function also enforces this with `skip_if_extracted=true`).
 *
 * Run:
 *   npx tsx scripts/extract-existing-documents.ts --dry-run
 *   npx tsx scripts/extract-existing-documents.ts --limit 10
 *   npx tsx scripts/extract-existing-documents.ts            # all
 *
 * Phase 2.1 NOTE: the edge function is currently a scaffold that doesn't
 * actually call extraction/embedding APIs. So running this script today
 * is harmless — it just touches updated_at for each document. When the
 * edge function is wired (phase 2.2), this script becomes the production
 * backfill orchestrator. Cost estimate before that: ~$5-15 one-time for
 * the 1,353-folder corpus + ~$0.10/day ongoing.
 *
 * Output: console summary + scripts/data/documents-extract-audit.csv
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
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
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 && process.argv[limitArg + 1] ? parseInt(process.argv[limitArg + 1]!, 10) : 0;
const RPS = 10;
const MIN_DELAY_MS = 1000 / RPS;

interface AuditRow {
  document_id: string;
  name: string;
  category: string;
  storage_backend: string;
  status: 'planned' | 'skipped' | 'failed' | 'dry_run';
  strategy?: string;
  http_status?: number;
  error?: string;
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } });
  const fnUrl = `${SUPABASE_URL}/functions/v1/process-document`;

  console.log(`[extract] DRY_RUN=${DRY_RUN} limit=${LIMIT || 'all'}`);

  // Fetch unindexed documents (no extracted_text yet)
  let query = supabase
    .from('documents')
    .select('id, name, category, storage_backend, mime_type')
    .is('extracted_text', null)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: true });
  if (LIMIT > 0) query = query.limit(LIMIT);

  const { data: docs, error: queryErr } = await query;
  if (queryErr) {
    console.error('[extract] Query failed', queryErr);
    process.exit(1);
  }

  console.log(`[extract] Found ${docs?.length ?? 0} unindexed documents`);

  const audit: AuditRow[] = [];
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of docs ?? []) {
    if (DRY_RUN) {
      audit.push({
        document_id: doc.id,
        name: doc.name,
        category: doc.category,
        storage_backend: doc.storage_backend,
        status: 'dry_run',
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      const resp = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document_id: doc.id, skip_if_extracted: true }),
      });

      const body = (await resp.json().catch(() => ({}))) as { strategy?: string; skipped?: string };

      if (!resp.ok) {
        console.error(`[extract] ${doc.id} → ${resp.status}`, body);
        audit.push({
          document_id: doc.id,
          name: doc.name,
          category: doc.category,
          storage_backend: doc.storage_backend,
          status: 'failed',
          http_status: resp.status,
          error: JSON.stringify(body),
        });
        failed++;
      } else if (body.skipped) {
        audit.push({
          document_id: doc.id,
          name: doc.name,
          category: doc.category,
          storage_backend: doc.storage_backend,
          status: 'skipped',
          strategy: body.strategy,
        });
        skipped++;
      } else {
        audit.push({
          document_id: doc.id,
          name: doc.name,
          category: doc.category,
          storage_backend: doc.storage_backend,
          status: 'planned',
          strategy: body.strategy,
        });
        processed++;
      }
    } catch (e) {
      console.error(`[extract] ${doc.id} threw`, e);
      audit.push({
        document_id: doc.id,
        name: doc.name,
        category: doc.category,
        storage_backend: doc.storage_backend,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }

    // Rate limit
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_DELAY_MS) {
      await new Promise((res) => setTimeout(res, MIN_DELAY_MS - elapsed));
    }

    if ((processed + skipped + failed) % 50 === 0) {
      console.log(`[extract] Progress: ${processed} planned, ${skipped} skipped, ${failed} failed`);
    }
  }

  console.log('---');
  console.log(`[extract] Summary:`);
  console.log(`  Documents processed: ${processed}`);
  console.log(`  Skipped (already extracted): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total: ${audit.length}`);

  mkdirSync('scripts/data', { recursive: true });
  const csvHeader = 'document_id,name,category,storage_backend,status,strategy,http_status,error\n';
  const csvBody = audit
    .map((r) =>
      [
        r.document_id,
        `"${r.name.replace(/"/g, '""')}"`,
        r.category,
        r.storage_backend,
        r.status,
        r.strategy ?? '',
        r.http_status ?? '',
        r.error ? `"${r.error.replace(/"/g, '""')}"` : '',
      ].join(','),
    )
    .join('\n');
  const csvPath = resolve(process.cwd(), 'scripts/data/documents-extract-audit.csv');
  writeFileSync(csvPath, csvHeader + csvBody, 'utf-8');
  console.log(`[extract] Audit written to ${csvPath}`);
}

main().catch((e) => {
  console.error('[extract] Fatal:', e);
  process.exit(1);
});
