/**
 * retrieve.ts — Shiroi RAG retrieval API.
 *
 * Single public function: retrieve(query, opts) → RagChunk[]
 * Consumers never touch the database directly.
 *
 * Usage:
 *   import { retrieve } from '@/lib/rag/retrieve';
 *   const chunks = await retrieve('what is our standard payment terms?', { top_k: 5 });
 *
 * The function:
 *   1. Embeds the query via Jina (retrieval.query task)
 *   2. Calls the rag_search RPC (cosine similarity, HNSW)
 *   3. Filters by min_similarity
 *   4. Returns typed RagChunk[]
 */

import { createClient } from '@repo/supabase/server';
import { jinaEmbed } from '@/lib/ai/jina-client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceType =
  | 'module_doc'
  | 'master_reference'
  | 'claude_md'
  | 'spec'
  | 'plan'
  | 'review'
  | 'changelog'
  | 'proposal'
  | 'service_ticket'
  | 'lead_activity'
  | 'price_book_item'
  | 'project_decision';

export interface RagChunk {
  id: string;
  source_type: SourceType;
  source_path: string;
  source_id: string | null;
  content: string;
  heading_path: string[] | null;
  metadata: Record<string, unknown>;
  similarity: number; // 0–1, cosine
}

export interface RetrieveOptions {
  /** Number of results to return. Default: 5 */
  top_k?: number;
  /** Filter by source types. Default: all types */
  source_types?: SourceType[];
  /** Minimum cosine similarity threshold. Default: 0.5 */
  min_similarity?: number;
}

// ── RPC row shape ─────────────────────────────────────────────────────────────

interface RagSearchRow {
  id: string;
  source_type: string;
  source_path: string;
  source_id: string | null;
  content: string;
  heading_path: string[] | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * retrieve — vector-similarity search over rag_chunks.
 *
 * @param query   - The user's query text (will be embedded via Jina)
 * @param opts    - top_k, source_types filter, min_similarity
 * @returns       Array of matching chunks ordered by descending similarity
 */
export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RagChunk[]> {
  const op = '[retrieve]';
  const topK = opts.top_k ?? 5;
  const minSim = opts.min_similarity ?? 0.5;
  const sourceTypes = opts.source_types ?? null;

  // Step 1: embed the query (single call, ~50ms)
  const vectors = await jinaEmbed([query], { task: 'retrieval.query' });
  const queryEmbedding = vectors[0];
  if (!queryEmbedding) {
    console.error(`${op} Jina returned empty vector array`);
    return [];
  }

  // Format as Postgres vector literal
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  // Step 2: call rag_search RPC
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('rag_search', {
    query_embedding: embeddingLiteral,
    top_k: topK,
    source_types: sourceTypes ?? undefined,
    min_sim: minSim,
  });

  if (error) {
    console.error(`${op} rag_search RPC failed`, {
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  if (!data || data.length === 0) return [];

  return (data as RagSearchRow[]).map((row) => ({
    id: row.id,
    source_type: row.source_type as SourceType,
    source_path: row.source_path,
    source_id: row.source_id,
    content: row.content,
    heading_path: row.heading_path,
    metadata: row.metadata ?? {},
    similarity: typeof row.similarity === 'number' ? row.similarity : parseFloat(row.similarity),
  }));
}
