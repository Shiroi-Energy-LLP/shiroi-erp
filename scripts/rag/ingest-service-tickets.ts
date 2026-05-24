/**
 * ingest-service-tickets.ts — Shiroi RAG Phase 2: index om_service_tickets.
 *
 * Incremental: reads rag_ingest_state WHERE source_type='service_ticket'.
 * 1 chunk per ticket (source_path = 'service_tickets/{id}', chunk_index = 0).
 * Includes project info for context. Tags derived from issue_type + flags.
 *
 * Usage:
 *   pnpm rag:ingest-service-tickets
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   JINA_API_KEY
 *   COHERE_API_KEY  (optional fallback)
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { embed, sleep } from './embed';
import {
  flattenServiceTicket,
  type ServiceTicketRow,
  type ProjectForTicket,
} from './flatteners/service-ticket';

const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Config ────────────────────────────────────────────────────────────────────

const SOURCE_TYPE = 'service_ticket';
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
  errorMsg?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('rag_ingest_state')
    .update({
      last_ingested_at: now,
      chunks_indexed: chunksIndexed,
      last_run_status: errorMsg ? 'error' : 'success',
      last_error: errorMsg ?? null,
      updated_at: now,
    })
    .eq('source_type', SOURCE_TYPE);
}

// ── Chunk diff + upsert ───────────────────────────────────────────────────────

async function getExistingHash(supabase: SupabaseClient, sourcePath: string): Promise<string | null> {
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

interface TicketWithLeadId extends ServiceTicketRow {
  project_id: string;
}

async function fetchTicketPage(
  supabase: SupabaseClient,
  since: string,
  offset: number,
): Promise<TicketWithLeadId[]> {
  const { data, error } = await supabase
    .from('om_service_tickets')
    .select(
      'id, ticket_number, title, description, issue_type, severity, status, ' +
      'sla_hours, sla_breached, resolved_at, resolution_notes, parts_used, ' +
      'parts_cost, is_warranty_claim, recurring_fault, created_at, project_id, updated_at',
    )
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw new Error(`[fetchTicketPage] ${error.message}`);
  return (data ?? []) as unknown as TicketWithLeadId[];
}

async function fetchProject(supabase: SupabaseClient, projectId: string): Promise<ProjectForTicket> {
  const { data, error } = await supabase
    .from('projects')
    .select('project_number, system_size_kwp')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(`[fetchProject] ${error.message}`);

  // We need customer name — get from lead via proposals
  // Simpler: get from the lead through the project's lead_id chain
  // For now use project_number and a placeholder customer lookup
  const { data: leadData } = await supabase
    .from('proposals')
    .select('lead_id')
    .eq('project_id', projectId)
    .maybeSingle()
    .then(async (res) => {
      if (res.data?.lead_id) {
        return supabase
          .from('leads')
          .select('customer_name, segment')
          .eq('id', res.data.lead_id)
          .maybeSingle();
      }
      return { data: null };
    });

  return {
    project_number: data?.project_number ?? projectId,
    customer_name: (leadData as { customer_name?: string } | null)?.customer_name ?? 'Unknown customer',
    segment: (leadData as { segment?: string } | null)?.segment ?? 'commercial',
    system_size_kwp: (data as { system_size_kwp?: number | null } | null)?.system_size_kwp,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.JINA_API_KEY) {
    console.log(
      '\n[rag:ingest-service-tickets] JINA_API_KEY is not set.\n' +
      'Set it in .env.local: JINA_API_KEY=your_key_here\n' +
      'Then re-run: pnpm rag:ingest-service-tickets\n',
    );
    process.exit(0);
  }

  const supabase = createSupabaseClient();
  const startTime = Date.now();

  console.log('\n[rag:ingest-service-tickets] Starting Phase 2 service ticket ingest...\n');

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

    const toEmbed: {
      sourcePath: string;
      sourceId: string;
      content: string;
      hash: string;
      metadata: Record<string, unknown>;
    }[] = [];

    while (hasMore) {
      const rows = await fetchTicketPage(supabase, since, offset);
      if (rows.length === 0) { hasMore = false; break; }
      if (rows.length < PAGE_SIZE) hasMore = false;
      offset += rows.length;

      for (const row of rows) {
        const sourcePath = `service_tickets/${row.id}`;
        try {
          const project = await fetchProject(supabase, row.project_id);
          const content = flattenServiceTicket(row, { project });
          const hash = sha256(content);

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
              ticket_id: row.id,
              ticket_number: row.ticket_number,
              project_number: project.project_number,
              issue_type: row.issue_type,
              severity: row.severity,
              status: row.status,
              sla_breached: row.sla_breached,
              is_warranty_claim: row.is_warranty_claim,
              recurring_fault: row.recurring_fault,
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

      while (toEmbed.length >= EMBED_BATCH_SIZE) {
        const batch = toEmbed.splice(0, EMBED_BATCH_SIZE);
        await embedAndUpsert(supabase, batch);
        totalNew += batch.length;
        if (toEmbed.length > 0) await sleep(200);
      }
    }

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
  console.log(`\n[rag:ingest-service-tickets] Done in ${elapsed}s`);
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
  console.error('\n[rag:ingest-service-tickets] Fatal error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
