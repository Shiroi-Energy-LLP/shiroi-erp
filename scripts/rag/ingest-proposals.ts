/**
 * ingest-proposals.ts — Shiroi RAG Phase 2: index proposals into rag_chunks.
 *
 * Incremental: reads rag_ingest_state WHERE source_type='proposal' to get
 * the last_ingested_at cursor. Only processes proposals updated since then.
 *
 * Strategy: 1 chunk per proposal (source_path = 'proposals/{id}', chunk_index = 0).
 * Content = flattenProposal() output. Hash-diffs to skip unchanged rows.
 *
 * Usage:
 *   pnpm rag:ingest-proposals
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
  flattenProposal,
  type ProposalRow,
  type LeadForProposal,
  type BomLineForProposal,
} from './flatteners/proposal';

// Load .env.local from repo root
const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Config ────────────────────────────────────────────────────────────────────

const SOURCE_TYPE = 'proposal';
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

async function upsertChunk(supabase: SupabaseClient, row: object): Promise<void> {
  const { error } = await supabase
    .from('rag_chunks')
    .upsert(row, { onConflict: 'source_path,chunk_index' });
  if (error) throw new Error(`[upsertChunk] ${error.message}`);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchProposalPage(
  supabase: SupabaseClient,
  since: string,
  offset: number,
): Promise<ProposalRow[]> {
  const { data, error } = await supabase
    .from('proposals')
    .select(
      'id, proposal_number, status, sent_at, accepted_at, system_size_kwp, ' +
      'system_type, structure_type, total_after_discount, discount_amount, ' +
      'gross_margin_pct, notes, updated_at, lead_id',
    )
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw new Error(`[fetchProposalPage] ${error.message}`);
  return (data ?? []) as unknown as ProposalRow[];
}

async function fetchLead(supabase: SupabaseClient, leadId: string): Promise<LeadForProposal> {
  const { data, error } = await supabase
    .from('leads')
    .select('customer_name, segment, city, state')
    .eq('id', leadId)
    .single();
  if (error) throw new Error(`[fetchLead] lead ${leadId}: ${error.message}`);
  return data as LeadForProposal;
}

async function fetchBomLines(supabase: SupabaseClient, proposalId: string): Promise<BomLineForProposal[]> {
  const { data, error } = await supabase
    .from('proposal_bom_lines')
    .select('quantity, brand, model, unit, unit_price, item_description, scope_owner')
    .eq('proposal_id', proposalId)
    .order('line_number', { ascending: true });
  if (error) throw new Error(`[fetchBomLines] proposal ${proposalId}: ${error.message}`);
  return (data ?? []) as BomLineForProposal[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.JINA_API_KEY) {
    console.log(
      '\n[rag:ingest-proposals] JINA_API_KEY is not set.\n' +
      'Set it before running ingest:\n' +
      '  1. Sign up at https://jina.ai to get a free API key.\n' +
      '  2. Add JINA_API_KEY=your_key_here to .env.local\n' +
      '  3. Re-run: pnpm rag:ingest-proposals\n',
    );
    process.exit(0);
  }

  const supabase = createSupabaseClient();
  const startTime = Date.now();

  console.log('\n[rag:ingest-proposals] Starting Phase 2 proposal ingest...\n');

  // Load ingest state
  const state = await getIngestState(supabase);
  const since = state.last_ingested_at;
  console.log(`  Cursor: updated_at > ${since}`);
  await setIngestRunning(supabase);

  let totalNew = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let grandTotal = state.chunks_indexed;

  try {
    let offset = 0;
    let hasMore = true;

    // Accumulate rows needing embed across pages for batching
    const toEmbed: {
      sourcePath: string;
      sourceId: string;
      content: string;
      hash: string;
      metadata: Record<string, unknown>;
    }[] = [];

    while (hasMore) {
      const rows = await fetchProposalPage(supabase, since, offset);
      if (rows.length === 0) {
        hasMore = false;
        break;
      }
      if (rows.length < PAGE_SIZE) hasMore = false;
      offset += rows.length;

      for (const row of rows) {
        const sourcePath = `proposals/${row.id}`;
        try {
          // Gather related data
          const lead = await fetchLead(supabase, (row as unknown as { lead_id: string }).lead_id);
          const bomLines = await fetchBomLines(supabase, row.id);

          // Flatten
          const content = flattenProposal(row, { lead, bomLines });
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
              proposal_id: row.id,
              proposal_number: row.proposal_number,
              customer_name: lead.customer_name,
              segment: lead.segment,
              city: lead.city,
              state: lead.state,
              system_size_kwp: row.system_size_kwp,
              total_after_discount: row.total_after_discount,
              status: row.status,
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

      // Embed + upsert in batches to avoid blowing Jina quota
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
  console.log(`\n[rag:ingest-proposals] Done in ${elapsed}s`);
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
    await upsertChunk(supabase, batch as unknown as object);
    if (b + UPSERT_BATCH_SIZE < rows.length) await sleep(50);
  }
}

main().catch((e) => {
  console.error('\n[rag:ingest-proposals] Fatal error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
