'use server';

/**
 * ingest-state-actions.ts — Server actions for the RAG ingest status section.
 *
 * getRagIngestStatus: fetch chunk counts + ingest state per source_type
 * triggerReIngest: call POST /api/rag/ingest-all server-side (keeps secret on server)
 */

import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';
import type { ActionResult } from '@/lib/types/actions';
import { ok, err } from '@/lib/types/actions';
import type { IngestSourceStatus } from './_client/ingest-status-client';

/**
 * getRagIngestStatus — fetch per-source chunk counts joined with rag_ingest_state.
 * Founder-only.
 */
export async function getRagIngestStatus(): Promise<ActionResult<IngestSourceStatus[]>> {
  const op = '[getRagIngestStatus]';

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');
  if (profile.role !== 'founder') return err('Founder only');

  const supabase = await createClient();

  // Fetch chunk counts per source_type
  const { data: chunkCounts, error: countErr } = await supabase
    .from('rag_chunks')
    .select('source_type')
    // We need a group-by count — use the RPC pattern or a raw query.
    // Supabase JS doesn't support GROUP BY directly, so we use count on each type.
    // We'll fetch ingest_state rows (which include chunks_indexed) + do a live count
    // via a second query per type. To keep it simple, use rag_ingest_state.chunks_indexed
    // as the "indexed count" and a separate live count for the actual DB count.
    .limit(0); // dummy — we don't need these rows

  if (countErr) {
    console.error(`${op} rag_chunks query failed`, { error: countErr.message, timestamp: new Date().toISOString() });
    // Non-fatal — proceed with ingest_state data
  }

  // Fetch rag_ingest_state rows
  const { data: stateRows, error: stateErr } = await supabase
    .from('rag_ingest_state')
    .select('source_type, last_ingested_at, last_run_status, chunks_indexed')
    .order('source_type', { ascending: true });

  if (stateErr) {
    console.error(`${op} rag_ingest_state query failed`, { error: stateErr.message, timestamp: new Date().toISOString() });
    return err(stateErr.message);
  }

  // Also get live chunk counts per source_type from rag_chunks
  // We do this by querying once and letting the DB aggregate via RPC — or we can
  // query source_type counts individually. Since the structured types are only 4-5,
  // we do a per-type count query for accuracy.
  const structuredTypes = ['proposal', 'service_ticket', 'lead_activity', 'price_book_item'];
  const docTypes = ['module_doc', 'master_reference', 'claude_md', 'spec', 'plan', 'review', 'changelog'];

  const allTypes = [...structuredTypes, ...docTypes];
  const chunkCountMap: Record<string, number> = {};

  for (const sourceType of allTypes) {
    const { count, error: cErr } = await supabase
      .from('rag_chunks')
      .select('*', { count: 'estimated', head: true })
      .eq('source_type', sourceType);

    if (!cErr) {
      chunkCountMap[sourceType] = count ?? 0;
    }
  }

  // Build the combined status list from ingest_state rows
  const statuses: IngestSourceStatus[] = (stateRows ?? []).map((row) => ({
    source_type: row.source_type,
    chunk_count: chunkCountMap[row.source_type] ?? (row.chunks_indexed ?? 0),
    last_ingested_at: row.last_ingested_at,
    last_run_status: row.last_run_status ?? 'idle',
    chunks_indexed: row.chunks_indexed ?? 0,
  }));

  // Add doc types that don't have an ingest_state row (Phase 1 docs)
  for (const docType of docTypes) {
    if (!statuses.some((s) => s.source_type === docType)) {
      statuses.push({
        source_type: docType,
        chunk_count: chunkCountMap[docType] ?? 0,
        last_ingested_at: null,
        last_run_status: 'idle',
        chunks_indexed: 0,
      });
    }
  }

  // Sort: structured types first, then doc types alphabetically
  statuses.sort((a, b) => {
    const aIsStructured = structuredTypes.includes(a.source_type);
    const bIsStructured = structuredTypes.includes(b.source_type);
    if (aIsStructured && !bIsStructured) return -1;
    if (!aIsStructured && bIsStructured) return 1;
    return a.source_type.localeCompare(b.source_type);
  });

  return ok(statuses);
}

/**
 * triggerReIngest — call POST /api/rag/ingest-all server-side.
 * The x-webhook-secret is kept on the server, never sent to the client.
 * For granularity, source_type is passed but the endpoint re-ingests all.
 * A future enhancement could add per-source-type API routes.
 */
export async function triggerReIngest(sourceType: string): Promise<ActionResult<void>> {
  const op = '[triggerReIngest]';

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');
  if (profile.role !== 'founder') return err('Founder only');

  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(`${op} N8N_WEBHOOK_SECRET not set`, { timestamp: new Date().toISOString() });
    return err('Webhook secret not configured — cannot trigger re-ingest from UI');
  }

  const baseUrl = process.env.NEXT_PUBLIC_ERP_URL ?? 'http://localhost:3000';
  const url = `${baseUrl}/api/rag/ingest-all`;

  console.log(`${op} triggering re-ingest`, { sourceType, url, timestamp: new Date().toISOString() });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify({ triggered_by: 'rag-debug-ui', source_type_hint: sourceType }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)');
      console.error(`${op} API returned ${response.status}`, { body: body.substring(0, 200), timestamp: new Date().toISOString() });
      return err(`API returned ${response.status}: ${body.substring(0, 100)}`);
    }

    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} fetch failed`, { error: msg, timestamp: new Date().toISOString() });
    return err(`Request failed: ${msg}`);
  }
}
