'use server';

/**
 * ask-action.ts — server action wrapper for the /ask page.
 *
 * askInternalQuestion:
 *   1. Auth guard (401 if not authenticated)
 *   2. Rate-limit check (30 q/day for non-founders)
 *   3. answerInternalQuestion() → RAG + Haiku
 *   4. Log to rag_query_log via admin client
 *   5. Return ok({ answer, citations, remaining })
 *
 * recordRagFeedback:
 *   Thumbs-up/down on a completed rag_query_log entry.
 */

import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { getUserProfile } from '@/lib/auth';
import { answerInternalQuestion } from './knowledge-qa';
import { checkAndIncrementRateLimit } from './knowledge-qa-rate-limit';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { RagChunk } from '@/lib/rag/retrieve';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AskCitation {
  id: string;
  source_type: string;
  source_path: string;
  heading_path: string[] | null;
  content: string;
  similarity: number;
}

export interface AskResult {
  /** The AI-generated answer text. */
  answer: string;
  /** Source chunks that grounded the answer. */
  citations: AskCitation[];
  /**
   * Questions remaining today (null = founder / unlimited).
   * Reflects remaining AFTER this question is counted.
   */
  remaining: number | null;
  /** UUID of the rag_query_log row — needed for thumbs feedback. */
  query_log_id: string;
  /** Round-trip latency in ms. */
  latency_ms: number;
}

// ── askInternalQuestion ────────────────────────────────────────────────────────

/**
 * askInternalQuestion — public server action for the /ask page.
 *
 * Never throws — always returns ActionResult<AskResult>.
 */
export async function askInternalQuestion(
  question: string,
): Promise<ActionResult<AskResult>> {
  const op = '[askInternalQuestion]';

  // Step 1 — auth
  const profile = await getUserProfile();
  if (!profile) {
    return err('Not authenticated. Please sign in to use the knowledge assistant.');
  }

  // Validate question up front
  const trimmed = question.trim();
  if (!trimmed) {
    return err('Question cannot be empty.');
  }
  if (trimmed.length > 1000) {
    return err('Question is too long (max 1000 characters).');
  }

  // Step 2 — rate limit
  let rateLimitResult: Awaited<ReturnType<typeof checkAndIncrementRateLimit>>;
  try {
    rateLimitResult = await checkAndIncrementRateLimit(profile.id, profile.role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} rate limit check threw`, {
      userId: profile.id,
      error: msg,
      timestamp: new Date().toISOString(),
    });
    // Allow on error — better to let through than block
    rateLimitResult = { allowed: true, remaining: null };
  }

  if (!rateLimitResult.allowed) {
    return err(
      'You have reached your daily limit of 30 questions. Your limit resets after 24 hours.',
      'RATE_LIMIT_EXCEEDED',
    );
  }

  // Step 3 — answer via RAG + Haiku
  const qaResult = await answerInternalQuestion(trimmed);
  if (!qaResult.success) {
    return err(qaResult.error);
  }

  const { answer, citations, latency_ms } = qaResult.data;

  // Step 4 — log to rag_query_log via admin client (bypasses RLS)
  let queryLogId = '';
  try {
    const admin = createAdminClient();
    const { data: logRow, error: logErr } = await admin
      .from('rag_query_log')
      .insert({
        caller_id: profile.id,
        caller_role: profile.role,
        query_text: trimmed,
        retrieved_chunk_ids: citations.map((c: RagChunk) => c.id),
        ai_answer: answer,
        ai_tokens_in: qaResult.data.tokens_in ?? null,
        ai_tokens_out: qaResult.data.tokens_out ?? null,
        ai_model: 'claude-haiku-4-5-20251001',
        latency_ms,
      })
      .select('id')
      .single();

    if (logErr) {
      // Non-fatal — answer is already computed; don't fail the user
      console.error(`${op} rag_query_log insert failed`, {
        error: logErr.message,
        code: logErr.code,
        timestamp: new Date().toISOString(),
      });
    } else if (logRow) {
      queryLogId = logRow.id;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} rag_query_log insert threw`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
  }

  // Step 5 — return result
  const askCitations: AskCitation[] = citations.map((c: RagChunk) => ({
    id: c.id,
    source_type: c.source_type,
    source_path: c.source_path,
    heading_path: c.heading_path,
    content: c.content,
    similarity: c.similarity,
  }));

  return ok({
    answer,
    citations: askCitations,
    remaining: rateLimitResult.remaining,
    query_log_id: queryLogId,
    latency_ms,
  });
}

// ── recordRagFeedback ──────────────────────────────────────────────────────────

/**
 * recordRagFeedback — thumbs-up/down on a completed rag_query_log entry.
 *
 * The user can only vote once per log entry — enforced client-side (no server
 * constraint needed since multiple votes in the same direction are harmless for
 * quality tracking, and we don't want to over-engineer v1).
 */
export async function recordRagFeedback(
  queryLogId: string,
  helpful: boolean,
): Promise<ActionResult<void>> {
  const op = '[recordRagFeedback]';

  if (!queryLogId) return err('Missing query log ID.');

  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated.');

  // Fetch current counters then increment (single-row, no RPC needed)
  const supabase = await createClient();
  const { data: current, error: fetchErr } = await supabase
    .from('rag_query_log')
    .select('thumbs_up_count, thumbs_down_count')
    .eq('id', queryLogId)
    .single();

  if (fetchErr || !current) {
    console.error(`${op} fetch failed`, {
      queryLogId,
      error: fetchErr?.message,
      timestamp: new Date().toISOString(),
    });
    return err('Log entry not found.');
  }

  const upCount = (current.thumbs_up_count ?? 0) + (helpful ? 1 : 0);
  const downCount = (current.thumbs_down_count ?? 0) + (helpful ? 0 : 1);

  const { error: updateErr } = await supabase
    .from('rag_query_log')
    .update({ thumbs_up_count: upCount, thumbs_down_count: downCount })
    .eq('id', queryLogId);

  if (updateErr) {
    console.error(`${op} update failed`, {
      queryLogId,
      error: updateErr.message,
      timestamp: new Date().toISOString(),
    });
    return err(updateErr.message);
  }

  return ok(undefined);
}
