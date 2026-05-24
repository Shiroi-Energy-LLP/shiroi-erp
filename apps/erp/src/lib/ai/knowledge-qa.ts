'use server';

/**
 * knowledge-qa.ts — Shiroi internal knowledge Q&A via RAG + Haiku.
 *
 * answerInternalQuestion(question, opts):
 *   1. Retrieves the top-k most relevant chunks from the Shiroi docs index.
 *   2. If nothing is found above the similarity threshold, returns a
 *      "not in docs" response without hallucinating.
 *   3. Builds a strict cite-or-refuse prompt and calls Haiku.
 *   4. Returns the answer text, the source chunks (for citation display),
 *      token counts, and latency.
 *
 * Callers: askInternalQuestion() server action in ask-action.ts.
 */

import { retrieve, type RagChunk, type SourceType } from '@/lib/rag/retrieve';
import { callAi } from '@/lib/ai/ai-caller';

// ── Constants ──────────────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_MAX_TOKENS = 800;
const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIMILARITY = 0.45;

const NO_DOCS_ANSWER =
  "I don't have this in our documentation. Try rephrasing or check the relevant module doc directly.";

const SYSTEM_PROMPT = `You are the Shiroi Energy internal knowledge assistant. \
Answer based ONLY on the provided documentation excerpts. \
Always cite sources by their source_path. \
If the excerpts don't contain the answer, say so explicitly — do not guess. \
Be concise (2-4 sentences usually). \
Use Indian English conventions. \
Money in ₹ Indian format.`;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KnowledgeAnswer {
  answer: string;
  citations: RagChunk[];
  used_chunks_count: number;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms: number;
}

export interface KnowledgeQaOptions {
  top_k?: number;
  min_similarity?: number;
  source_types?: string[];
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * answerInternalQuestion — retrieve docs chunks and synthesize an answer.
 *
 * @param question - The user's natural-language question (non-empty trimmed string)
 * @param opts     - Optional overrides for retrieval params
 * @returns        success + KnowledgeAnswer | failure + error string
 */
export async function answerInternalQuestion(
  question: string,
  opts: KnowledgeQaOptions = {},
): Promise<{ success: true; data: KnowledgeAnswer } | { success: false; error: string }> {
  const op = '[answerInternalQuestion]';

  // Step 1 — validate
  const trimmed = question.trim();
  if (!trimmed) {
    return { success: false, error: 'Question cannot be empty.' };
  }

  const t0 = Date.now();

  // Step 2 — retrieve
  let chunks: RagChunk[] = [];
  try {
    chunks = await retrieve(trimmed, {
      top_k: opts.top_k ?? DEFAULT_TOP_K,
      min_similarity: opts.min_similarity ?? DEFAULT_MIN_SIMILARITY,
      // source_types from KnowledgeQaOptions is string[]; RetrieveOptions wants SourceType[].
      // The values are identical at runtime — only widened for the caller's convenience.
      source_types: opts.source_types as unknown as SourceType[] | undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} retrieve failed`, { error: msg, timestamp: new Date().toISOString() });
    return { success: false, error: `Retrieval failed: ${msg}` };
  }

  // Step 3 — no chunks above threshold
  if (chunks.length === 0) {
    return {
      success: true,
      data: {
        answer: NO_DOCS_ANSWER,
        citations: [],
        used_chunks_count: 0,
        latency_ms: Date.now() - t0,
      },
    };
  }

  // Step 4 — build prompt
  const excerptText = chunks
    .map((c, i) => {
      const breadcrumb = c.heading_path && c.heading_path.length > 0
        ? ` › ${c.heading_path.join(' › ')}`
        : '';
      return `[Excerpt ${i + 1}] Source: ${c.source_path}${breadcrumb}\n${c.content}`;
    })
    .join('\n\n---\n\n');

  const userMessage = `Question: ${trimmed}\n\nDocumentation excerpts:\n\n${excerptText}\n\nAnswer the question using only these excerpts, citing source_paths inline.`;

  // Step 5 — call Haiku
  let answer: string;
  try {
    answer = await callAi(
      `${SYSTEM_PROMPT}\n\n${userMessage}`,
      { model: HAIKU_MODEL, maxTokens: HAIKU_MAX_TOKENS },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} callAi failed`, { error: msg, timestamp: new Date().toISOString() });
    return { success: false, error: `AI call failed: ${msg}` };
  }

  const latency_ms = Date.now() - t0;

  // Step 6 — return result
  // Token counts are not exposed by callAi() today; leave optional fields undefined.
  return {
    success: true,
    data: {
      answer: answer.trim(),
      citations: chunks,
      used_chunks_count: chunks.length,
      latency_ms,
    },
  };
}
