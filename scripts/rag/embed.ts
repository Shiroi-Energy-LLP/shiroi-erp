/**
 * embed.ts — Jina embedding wrapper with Cohere fallback for RAG ingest scripts.
 *
 * This module runs in the Node.js script context (NOT in Next.js / Edge Runtime).
 * It reads JINA_API_KEY and COHERE_API_KEY from process.env directly.
 *
 * Fallback chain:
 *   1. Jina jina-embeddings-v3 (primary)
 *   2. Cohere embed-multilingual-v3.0 (fallback if Jina throws + COHERE_API_KEY set)
 *   3. Throws if both fail
 *
 * Usage:
 *   import { embed } from './embed';
 *   const vectors = await embed(['chunk 1 text', 'chunk 2 text']);
 */

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL = 'jina-embeddings-v3';
const EXPECTED_DIM = 1024;
const MAX_BATCH_SIZE = 100;

const COHERE_API_URL = 'https://api.cohere.com/v2/embed';
const COHERE_MODEL = 'embed-multilingual-v3.0';
const COHERE_MAX_BATCH = 96;

/** Small delay helper to respect rate limits */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jinaEmbedBatch(texts: string[]): Promise<number[][]> {
  const op = '[jinaEmbedBatch]';
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${op} JINA_API_KEY is not set. ` +
      'Set it in .env.local or export JINA_API_KEY=... before running the ingest script.',
    );
  }

  const response = await fetch(JINA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      task: 'retrieval.passage',
      input: texts,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`${op} Jina API ${response.status}: ${body.substring(0, 300)}`);
  }

  const json = (await response.json()) as { data: Array<{ index: number; embedding: number[] }> };
  const sorted = [...json.data].sort((a, b) => a.index - b.index);

  for (const { index, embedding } of sorted) {
    if (embedding.length !== EXPECTED_DIM) {
      throw new Error(`${op} Jina dim mismatch at index ${index}: got ${embedding.length}, expected ${EXPECTED_DIM}`);
    }
  }

  return sorted.map((e) => e.embedding);
}

async function cohereEmbedBatch(texts: string[]): Promise<number[][]> {
  const op = '[cohereEmbedBatch]';
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error(`${op} COHERE_API_KEY is not set — cannot use Cohere fallback.`);
  }

  const response = await fetch(COHERE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      texts,
      input_type: 'search_document',
      embedding_types: ['float'],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`${op} Cohere API ${response.status}: ${body.substring(0, 300)}`);
  }

  const json = (await response.json()) as { embeddings: { float?: number[][] } };
  const floats = json.embeddings?.float;
  if (!floats || floats.length !== texts.length) {
    throw new Error(`${op} Cohere returned ${floats?.length ?? 0} embeddings for ${texts.length} inputs.`);
  }
  return floats;
}

/**
 * embed — embed an array of texts using Jina, falling back to Cohere on failure.
 *
 * Batches automatically (up to MAX_BATCH_SIZE per Jina call).
 * Adds 200ms delay between batches to respect Jina rate limits.
 *
 * @param texts - Array of text strings to embed
 * @returns Array of 1024-dimensional float vectors in the same order
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const op = '[embed]';
  if (texts.length === 0) return [];

  const allVectors: number[][] = [];
  const batchSize = Math.min(MAX_BATCH_SIZE, COHERE_MAX_BATCH);

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    if (i > 0) await sleep(200); // Rate limit courtesy

    try {
      const vectors = await jinaEmbedBatch(batch);
      allVectors.push(...vectors);
    } catch (jinaErr) {
      console.warn(`${op} Jina failed for batch ${i}–${i + batch.length}, trying Cohere fallback`, {
        error: jinaErr instanceof Error ? jinaErr.message : String(jinaErr),
        timestamp: new Date().toISOString(),
      });
      try {
        const vectors = await cohereEmbedBatch(batch);
        allVectors.push(...vectors);
      } catch (cohereErr) {
        const msg = cohereErr instanceof Error ? cohereErr.message : String(cohereErr);
        throw new Error(
          `${op} Both Jina and Cohere failed for batch ${i}–${i + batch.length}. ` +
          `Cohere error: ${msg}`,
        );
      }
    }
  }

  return allVectors;
}
