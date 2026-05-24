/**
 * ingest-docs.ts — Shiroi RAG Phase 1 ingest orchestrator.
 *
 * Walks SOURCES (docs only in Phase 1), chunks markdown files, computes
 * sha256 content_hash per chunk, diffs against existing rag_chunks,
 * embeds only new/changed chunks via Jina (Cohere fallback), and
 * batch-upserts to Supabase.
 *
 * Also cleans up rag_chunks for files that no longer exist.
 *
 * Usage:
 *   pnpm rag:ingest-docs
 *   # or directly:
 *   tsx scripts/rag/ingest-docs.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
 *   SUPABASE_SECRET_KEY       (service-role key — needed for write access)
 *   JINA_API_KEY              (required for embedding)
 *   COHERE_API_KEY            (optional — fallback if Jina fails)
 *
 * Exits with code 0 on success.
 * Exits with code 0 if JINA_API_KEY is unset (prints instruction, no error).
 * Exits with code 1 only on unexpected errors.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { chunkMarkdown } from './chunk-markdown';
import { embed, sleep } from './embed';
import { SOURCES } from './sources';

// Load .env.local from repo root
const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Configuration ─────────────────────────────────────────────────────────────

const UPSERT_BATCH_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set. ' +
      'Check .env.local at the repo root.',
    );
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set. ' +
      'Check .env.local at the repo root.',
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

interface RagChunkRow {
  id: string;
  source_path: string;
  chunk_index: number;
  content_hash: string;
}

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

/** Load existing rag_chunks for a given source_path (all chunks for that file). */
async function loadExistingChunks(
  supabase: SupabaseClient,
  sourcePath: string,
): Promise<Map<number, RagChunkRow>> {
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('id, source_path, chunk_index, content_hash')
    .eq('source_path', sourcePath);

  if (error) {
    throw new Error(`Failed to load existing chunks for ${sourcePath}: ${error.message}`);
  }

  const map = new Map<number, RagChunkRow>();
  for (const row of data ?? []) {
    map.set(row.chunk_index, row as RagChunkRow);
  }
  return map;
}

/** Upsert a batch of rag_chunks rows. */
async function upsertChunks(
  supabase: SupabaseClient,
  rows: object[],
): Promise<void> {
  const { error } = await supabase
    .from('rag_chunks')
    .upsert(rows, { onConflict: 'source_path,chunk_index' });

  if (error) {
    throw new Error(`Upsert failed: ${error.message}`);
  }
}

/** Delete rag_chunks for a source_path that is no longer in the file system. */
async function deleteOrphanedChunks(
  supabase: SupabaseClient,
  orphanedPaths: string[],
): Promise<void> {
  if (orphanedPaths.length === 0) return;
  const { error } = await supabase
    .from('rag_chunks')
    .delete()
    .in('source_path', orphanedPaths);
  if (error) {
    throw new Error(`Delete orphaned chunks failed: ${error.message}`);
  }
  console.log(`  Deleted chunks for ${orphanedPaths.length} removed file(s): ${orphanedPaths.join(', ')}`);
}

/** Get all distinct source_paths in rag_chunks for a given source_type. */
async function getIndexedPaths(
  supabase: SupabaseClient,
  sourceType: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('source_path')
    .eq('source_type', sourceType);

  if (error) throw new Error(`getIndexedPaths failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.source_path as string));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Early exit if JINA_API_KEY is missing — don't error, just instruct
  if (!process.env.JINA_API_KEY) {
    console.log(
      '\n[rag:ingest-docs] JINA_API_KEY is not set.\n' +
      'Set it before running ingest:\n' +
      '  1. Sign up at https://jina.ai to get a free API key.\n' +
      '  2. Add JINA_API_KEY=your_key_here to .env.local\n' +
      '  3. Re-run: pnpm rag:ingest-docs\n',
    );
    process.exit(0);
  }

  const supabase = createSupabaseClient();
  const startTime = Date.now();

  let totalFiles = 0;
  let totalChunksNew = 0;
  let totalChunksUnchanged = 0;
  let totalChunksDeleted = 0;

  console.log('\n[rag:ingest-docs] Starting Phase 1 docs ingest...\n');

  for (const source of SOURCES) {
    console.log(`\n--- ${source.label} (${source.type}) ---`);

    // Find files matching the glob
    const files = await glob(source.glob, { cwd: repoRoot, absolute: true });
    const fileSet = new Set(files.map((f) => path.relative(repoRoot, f).replace(/\\/g, '/')));

    console.log(`  Found ${files.length} file(s)`);

    // Get currently indexed paths for this source_type
    const indexedPaths = await getIndexedPaths(supabase, source.type);

    // Find orphaned paths (indexed but file no longer exists)
    const orphanedPaths = [...indexedPaths].filter((p) => !fileSet.has(p));
    if (orphanedPaths.length > 0) {
      await deleteOrphanedChunks(supabase, orphanedPaths);
      totalChunksDeleted += orphanedPaths.length;
    }

    // Process each file
    for (const absPath of files) {
      const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/');
      totalFiles++;

      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch (e) {
        console.error(`  [SKIP] Cannot read ${relPath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      const chunks = chunkMarkdown(content, { maxTokens: 800, overlap: 100 });
      if (chunks.length === 0) {
        console.log(`  [SKIP] ${relPath} — no chunks generated (empty or too short)`);
        continue;
      }

      // Load existing chunks for this file
      const existingChunks = await loadExistingChunks(supabase, relPath);

      // Determine which chunks need embedding
      const toEmbed: { chunkIndex: number; content: string; heading_path: string[]; hash: string }[] = [];
      let fileUnchanged = 0;

      for (const chunk of chunks) {
        const hash = sha256(chunk.content);
        const existing = existingChunks.get(chunk.chunk_index);
        if (existing && existing.content_hash === hash) {
          fileUnchanged++;
        } else {
          toEmbed.push({
            chunkIndex: chunk.chunk_index,
            content: chunk.content,
            heading_path: chunk.heading_path,
            hash,
          });
        }
      }

      totalChunksUnchanged += fileUnchanged;

      if (toEmbed.length === 0) {
        console.log(`  [OK] ${relPath} — ${fileUnchanged} chunks unchanged`);
        continue;
      }

      console.log(`  [EMBED] ${relPath} — ${toEmbed.length} new/changed, ${fileUnchanged} unchanged`);

      // Embed in batches of 100
      const vectors = await embed(toEmbed.map((c) => c.content));

      // Build upsert rows
      const rows = toEmbed.map((c, i) => ({
        source_type: source.type,
        source_path: relPath,
        source_id: null,
        chunk_index: c.chunkIndex,
        content: c.content,
        heading_path: c.heading_path,
        metadata: {},
        embedding: `[${vectors[i].join(',')}]`,
        embedding_model: 'jina-embeddings-v3',
        embedding_dim: 1024,
        content_hash: c.hash,
        last_indexed_at: new Date().toISOString(),
      }));

      // Batch upsert
      for (let b = 0; b < rows.length; b += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(b, b + UPSERT_BATCH_SIZE);
        await upsertChunks(supabase, batch);
        if (b + UPSERT_BATCH_SIZE < rows.length) await sleep(50);
      }

      totalChunksNew += toEmbed.length;

      // Clean up extra chunks from previous version (if file got shorter)
      const maxNewIndex = Math.max(...chunks.map((c) => c.chunk_index));
      const staleChunkIndices = [...existingChunks.keys()].filter((idx) => idx > maxNewIndex);
      if (staleChunkIndices.length > 0) {
        const { error } = await supabase
          .from('rag_chunks')
          .delete()
          .eq('source_path', relPath)
          .in('chunk_index', staleChunkIndices);
        if (error) {
          console.warn(`  [WARN] Could not delete stale chunks for ${relPath}: ${error.message}`);
        } else {
          totalChunksDeleted += staleChunkIndices.length;
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[rag:ingest-docs] Done in ${elapsed}s`);
  console.log(`  Files processed : ${totalFiles}`);
  console.log(`  Chunks embedded : ${totalChunksNew}`);
  console.log(`  Chunks unchanged: ${totalChunksUnchanged}`);
  console.log(`  Chunks deleted  : ${totalChunksDeleted}`);
  console.log('');
}

main().catch((e) => {
  console.error('\n[rag:ingest-docs] Fatal error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
