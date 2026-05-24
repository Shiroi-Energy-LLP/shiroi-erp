'use server';

/**
 * rag-debug-actions.ts — Server actions for the RAG debug page.
 *
 * searchRag: embed + retrieve + log to rag_query_log
 * thumbsRagLog: increment thumbs_up or thumbs_down on a log entry
 */

import { retrieve, type RetrieveOptions, type SourceType } from '@/lib/rag/retrieve';
import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';
import type { ActionResult } from '@/lib/types/actions';
import { ok, err } from '@/lib/types/actions';
import type { RagChunk } from '@/lib/rag/retrieve';

export interface RagSearchResult {
  logId: string;
  query: string;
  chunks: RagChunk[];
  latencyMs: number;
}

/**
 * searchRag — run a RAG query and log it to rag_query_log.
 */
export async function searchRag(
  query: string,
  opts: { top_k?: number; source_types?: string[] } = {},
): Promise<ActionResult<RagSearchResult>> {
  const op = '[searchRag]';

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');
  if (profile.role !== 'founder') return err('Forbidden — founder only');

  if (!query.trim()) return err('Query cannot be empty');

  const t0 = Date.now();

  let chunks: RagChunk[] = [];
  try {
    const retrieveOpts: RetrieveOptions = {
      top_k: opts.top_k ?? 5,
      min_similarity: 0.4, // lower threshold for debug page — show borderline results too
    };
    if (opts.source_types && opts.source_types.length > 0) {
      retrieveOpts.source_types = opts.source_types as SourceType[];
    }
    chunks = await retrieve(query, retrieveOpts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} retrieve failed`, { error: msg, timestamp: new Date().toISOString() });
    return err(`Retrieval failed: ${msg}`);
  }

  const latencyMs = Date.now() - t0;

  // Log to rag_query_log
  const supabase = await createClient();
  const { data: logRow, error: logErr } = await supabase
    .from('rag_query_log')
    .insert({
      caller_id: profile.id,
      caller_role: profile.role,
      query_text: query,
      retrieved_chunk_ids: chunks.map((c) => c.id),
      ai_answer: null, // debug page doesn't synthesize an answer
      ai_tokens_in: null,
      ai_tokens_out: null,
      ai_model: 'none',
      latency_ms: latencyMs,
    })
    .select('id')
    .single();

  if (logErr) {
    // Non-fatal — still return results even if logging fails
    console.error(`${op} log insert failed`, { error: logErr.message, timestamp: new Date().toISOString() });
  }

  return ok({
    logId: logRow?.id ?? '',
    query,
    chunks,
    latencyMs,
  });
}

/**
 * thumbsRagLog — increment thumbs_up or thumbs_down on a rag_query_log entry.
 */
export async function thumbsRagLog(
  logId: string,
  direction: 'up' | 'down',
): Promise<ActionResult<void>> {
  const op = '[thumbsRagLog]';

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated');
  if (profile.role !== 'founder') return err('Forbidden');

  if (!logId) return err('Missing logId');

  const supabase = await createClient();
  const column = direction === 'up' ? 'thumbs_up_count' : 'thumbs_down_count';

  // Fetch current value then increment (no RPC needed for simple counter)
  const { data: current, error: fetchErr } = await supabase
    .from('rag_query_log')
    .select(column)
    .eq('id', logId)
    .single();

  if (fetchErr || !current) {
    console.error(`${op} fetch failed`, { logId, error: fetchErr?.message, timestamp: new Date().toISOString() });
    return err('Log entry not found');
  }

  const currentVal = (current as Record<string, number>)[column] ?? 0;

  const { error: updateErr } = await supabase
    .from('rag_query_log')
    .update({ [column]: currentVal + 1 })
    .eq('id', logId);

  if (updateErr) {
    console.error(`${op} update failed`, { logId, error: updateErr.message, timestamp: new Date().toISOString() });
    return err(updateErr.message);
  }

  return ok(undefined);
}
