/**
 * jina-client.ts — Jina AI embeddings client for Shiroi ERP.
 *
 * Uses jina-embeddings-v3 (1024-dim, multilingual including Tamil).
 * Free tier covers Shiroi's entire expected volume (10M tokens/month).
 *
 * Usage:
 *   import { jinaEmbed } from '@/lib/ai/jina-client';
 *   const vectors = await jinaEmbed(['What is the payment terms?']);
 *
 * task param:
 *   'retrieval.passage' — for indexing documents (ingest)
 *   'retrieval.query'   — for query-time embedding
 */

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL = 'jina-embeddings-v3';
const EXPECTED_DIM = 1024;
const MAX_BATCH_SIZE = 100;
const TIMEOUT_MS = 3000;

export interface JinaEmbedOptions {
  task?: 'retrieval.passage' | 'retrieval.query' | 'text-matching' | 'classification';
}

interface JinaEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
  usage: { total_tokens: number };
}

/**
 * jinaEmbed — embed one or more texts using Jina AI v3.
 *
 * @param texts - One string or an array of strings (max 100 per call)
 * @param options - Optional task type (default: 'retrieval.passage')
 * @returns Array of 1024-dimensional float vectors, one per input text
 * @throws if JINA_API_KEY is unset, batch is too large, dims mismatch, or API errors
 */
export async function jinaEmbed(
  texts: string | string[],
  options: JinaEmbedOptions = {},
): Promise<number[][]> {
  const op = '[jinaEmbed]';

  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${op} JINA_API_KEY is not set. ` +
      'Add it to .env.local for local dev and to Vercel env vars for production. ' +
      'Get a key at https://jina.ai',
    );
  }

  const inputArray = Array.isArray(texts) ? texts : [texts];

  if (inputArray.length === 0) return [];
  if (inputArray.length > MAX_BATCH_SIZE) {
    throw new Error(
      `${op} Batch size ${inputArray.length} exceeds maximum of ${MAX_BATCH_SIZE}. ` +
      'Split into smaller batches before calling jinaEmbed.',
    );
  }

  const task = options.task ?? 'retrieval.passage';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(JINA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: JINA_MODEL,
        task,
        input: inputArray,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${op} Jina API error ${response.status}: ${body.substring(0, 300)}`,
    );
  }

  const json = (await response.json()) as JinaEmbeddingResponse;
  const embeddings = json.data;

  if (!embeddings || embeddings.length !== inputArray.length) {
    throw new Error(
      `${op} Jina returned ${embeddings?.length ?? 0} embeddings for ${inputArray.length} inputs.`,
    );
  }

  // Sort by index (Jina guarantees order but be safe)
  embeddings.sort((a, b) => a.index - b.index);

  // Dimension assertion
  for (const { index, embedding } of embeddings) {
    if (embedding.length !== EXPECTED_DIM) {
      throw new Error(
        `${op} Embedding at index ${index} has dimension ${embedding.length}, expected ${EXPECTED_DIM}. ` +
        'Model may have changed — update EXPECTED_DIM if intentional.',
      );
    }
  }

  return embeddings.map((e) => e.embedding);
}
