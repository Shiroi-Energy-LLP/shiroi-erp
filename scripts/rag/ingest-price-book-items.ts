/**
 * ingest-price-book-items.ts — Shiroi RAG Phase 2: index price_book_items into rag_chunks.
 *
 * Incremental: reads rag_ingest_state WHERE source_type='price_book_item' to get
 * the last_ingested_at cursor. Only processes items updated since then.
 * Only active items (is_active = true) are indexed.
 *
 * Strategy: 1 chunk per item (source_path = 'price_book_item/{id}', chunk_index = 0).
 * Content = flattenPriceBookItem() output. Hash-diffs to skip unchanged rows.
 *
 * Usage:
 *   pnpm rag:ingest-price-book
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   JINA_API_KEY              (required for embedding)
 *   COHERE_API_KEY            (optional fallback)
 *
 * Exits 0 on success. Exits 0 with message if JINA_API_KEY is unset.
 * Exits 1 on unexpected errors.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { embed, sleep } from './embed';
import {
  flattenPriceBookItem,
  type PriceBookItemRow,
} from './flatteners/price-book-item';

// Load .env.local from repo root
const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Config ────────────────────────────────────────────────────────────────────

const SOURCE_TYPE = 'price_book_item';
const PAGE_SIZE = 50;
const UPSERT_BATCH_SIZE = 50;
const EMBED_BATCH_SIZE = 96;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set.');
  if (!key) throw new Error('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set.');
  return createClient(url, key, { auth: { persistSession: false } });
}

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

// ── State management ──────────────────────────────────────────────────────────

async function ensureIngestState(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase
    .from('rag_ingest_state')
    .select('source_type')
    .eq('source_type', SOURCE_TYPE)
    .maybeSingle();

  if (error) throw new Error(`[ensureIngestState] ${error.message}`);

  if (!data) {
    console.log(`  [INIT] Creating rag_ingest_state row for source_type='${SOURCE_TYPE}'`);
    const { error: insertErr } = await supabase
      .from('rag_ingest_state')
      .insert({
        source_type: SOURCE_TYPE,
        last_ingested_at: '1970-01-01T00:00:00Z',
        chunks_indexed: 0,
        last_run_status: 'idle',
      });
    if (insertErr) throw new Error(`[ensureIngestState] insert failed: ${insertErr.message}`);
  }
}

async function getIngestState(supabase: SupabaseClient): Promise<{ last_ingested_at: string; chunks_indexed: number }> {
  const { data, error } = await supabase
    .from('rag_ingest_state')
    .select('last_ingested_at, chunks_indexed')
    .eq('source_type', SOURCE_TYPE)
    .single();

  if (error) throw new Error(`[getIngestState] ${error.message}`);
  return {
    last_ingested_at: data?.last_ingested_at ?? '1970-01-01T00:00:00Z',
    chunks_indexed: data?.chunks_indexed ?? 0,
  };
}

async function setIngestRunning(supabase: SupabaseClient): Promise<void> {
  await supabase
    .from('rag_ingest_state')
    .update({ last_run_status: 'running', updated_at: new Date().toISOString() })
    .eq('source_type', SOURCE_TYPE);
}

async function setIngestDone(
  supabase: SupabaseClient,
  chunksIndexed: number,
  error?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('rag_ingest_state')
    .update({
      last_ingested_at: now,
      chunks_indexed: chunksIndexed,
      last_run_status: error ? 'error' : 'success',
      last_error: error ?? null,
      updated_at: now,
    })
    .eq('source_type', SOURCE_TYPE);
}

// ── Chunk diff + upsert ───────────────────────────────────────────────────────

async function getExistingHash(
  supabase: SupabaseClient,
  sourcePath: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('content_hash')
    .eq('source_path', sourcePath)
    .eq('chunk_index', 0)
    .maybeSingle();

  if (error) throw new Error(`[getExistingHash] ${error.message}`);
  return data?.content_hash ?? null;
}

async function upsertChunks(supabase: SupabaseClient, rows: object[]): Promise<void> {
  const { error } = await supabase
    .from('rag_chunks')
    .upsert(rows, { onConflict: 'source_path,chunk_index' });
  if (error) throw new Error(`[upsertChunks] ${error.message}`);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchItemPage(
  supabase: SupabaseClient,
  since: string,
  offset: number,
): Promise<PriceBookItemRow[]> {
  const { data, error } = await supabase
    .from('price_book_items')
    .select(
      'id, item_category, item_description, brand, model, specification, unit, ' +
      'base_price, last_purchase_price, price_variance_pct, gst_type, gst_rate, ' +
      'hsn_code, effective_from, effective_until, update_recommended, is_active, updated_at',
    )
    .eq('is_active', true)
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw new Error(`[fetchItemPage] ${error.message}`);
  return (data ?? []) as unknown as PriceBookItemRow[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.JINA_API_KEY) {
    console.log(
      '\n[rag:ingest-price-book] JINA_API_KEY is not set.\n' +
      'Set it before running ingest:\n' +
      '  1. Sign up at https://jina.ai to get a free API key.\n' +
      '  2. Add JINA_API_KEY=your_key_here to .env.local\n' +
      '  3. Re-run: pnpm rag:ingest-price-book\n',
    );
    process.exit(0);
  }

  const supabase = createSupabaseClient();
  const startTime = Date.now();

  console.log('\n[rag:ingest-price-book] Starting Phase 2 price book ingest...\n');

  // Ensure state row exists (create if missing)
  await ensureIngestState(supabase);

  // Load ingest state
  const state = await getIngestState(supabase);
  const since = state.last_ingested_at;
  console.log(`  Cursor: updated_at > ${since}`);
  console.log('  Filter: is_active = true only');
  await setIngestRunning(supabase);

  let totalNew = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let grandTotal = state.chunks_indexed;

  try {
    let offset = 0;
    let hasMore = true;

    const toEmbed: {
      sourcePath: string;
      sourceId: string;
      content: string;
      hash: string;
      metadata: Record<string, unknown>;
    }[] = [];

    while (hasMore) {
      const rows = await fetchItemPage(supabase, since, offset);
      if (rows.length === 0) {
        hasMore = false;
        break;
      }
      if (rows.length < PAGE_SIZE) hasMore = false;
      offset += rows.length;

      for (const row of rows) {
        const sourcePath = `price_book_item/${row.id}`;
        try {
          const content = flattenPriceBookItem(row);
          const hash = sha256(content);

          // Diff
          const existingHash = await getExistingHash(supabase, sourcePath);
          if (existingHash === hash) {
            totalSkipped++;
            console.log(`  [SKIP] ${sourcePath} — unchanged`);
            continue;
          }

          toEmbed.push({
            sourcePath,
            sourceId: row.id,
            content,
            hash,
            metadata: {
              item_id: row.id,
              item_category: row.item_category,
              brand: row.brand ?? null,
              model: row.model ?? null,
              unit: row.unit,
              gst_type: row.gst_type,
              update_recommended: row.update_recommended,
            },
          });

          console.log(`  [QUEUE] ${sourcePath} — will embed`);
        } catch (rowErr) {
          totalErrors++;
          console.error(
            `  [ERROR] ${sourcePath}:`,
            rowErr instanceof Error ? rowErr.message : String(rowErr),
          );
        }
      }

      // Embed + upsert in batches
      while (toEmbed.length >= EMBED_BATCH_SIZE) {
        const batch = toEmbed.splice(0, EMBED_BATCH_SIZE);
        await embedAndUpsert(supabase, batch);
        totalNew += batch.length;
        if (toEmbed.length > 0) await sleep(200);
      }
    }

    // Embed remainder
    if (toEmbed.length > 0) {
      await embedAndUpsert(supabase, toEmbed);
      totalNew += toEmbed.length;
    }

    grandTotal = Math.max(grandTotal, 0) + totalNew;
    await setIngestDone(supabase, grandTotal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setIngestDone(supabase, grandTotal, msg);
    throw err;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[rag:ingest-price-book] Done in ${elapsed}s`);
  console.log(`  New/updated chunks: ${totalNew}`);
  console.log(`  Skipped (unchanged): ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('');
}

async function embedAndUpsert(
  supabase: SupabaseClient,
  items: {
    sourcePath: string;
    sourceId: string;
    content: string;
    hash: string;
    metadata: Record<string, unknown>;
  }[],
): Promise<void> {
  const vectors = await embed(items.map((i) => i.content));
  const now = new Date().toISOString();

  const rows = items.map((item, idx) => ({
    source_type: SOURCE_TYPE,
    source_path: item.sourcePath,
    source_id: item.sourceId,
    chunk_index: 0,
    content: item.content,
    heading_path: null,
    metadata: item.metadata,
    embedding: `[${vectors[idx].join(',')}]`,
    embedding_model: 'jina-embeddings-v3',
    embedding_dim: 1024,
    content_hash: item.hash,
    last_indexed_at: now,
  }));

  for (let b = 0; b < rows.length; b += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(b, b + UPSERT_BATCH_SIZE);
    await upsertChunks(supabase, batch);
    if (b + UPSERT_BATCH_SIZE < rows.length) await sleep(50);
  }
}

main().catch((e) => {
  console.error('\n[rag:ingest-price-book] Fatal error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
