/**
 * cohere-client.ts — Cohere embeddings fallback for Shiroi ERP.
 *
 * Uses embed-multilingual-v3.0 (1024-dim) as a fallback when Jina AI fails.
 * Only invoked by scripts/rag/embed.ts when COHERE_API_KEY is set and Jina throws.
 *
 * NOTE: This is a fallback stub. If COHERE_API_KEY is unset, cohereEmbed
 * throws immediately with a clear message — it does not silently fail.
 *
 * Usage (via embed.ts, not called directly):
 *   import { cohereEmbed } from '@/lib/ai/cohere-client';
 *   const vectors = await cohereEmbed(['text chunk here']);
 */

const COHERE_API_URL = 'https://api.cohere.com/v2/embed';
const COHERE_MODEL = 'embed-multilingual-v3.0';
const EXPECTED_DIM = 1024;
const MAX_BATCH_SIZE = 96; // Cohere v2 limit

interface CohereEmbedResponse {
  embeddings: {
    float?: number[][];
  };
}

/**
 * cohereEmbed — embed texts using Cohere embed-multilingual-v3.0.
 *
 * @param texts - One or more strings to embed (max 96 per call)
 * @param inputType - 'search_document' for ingest, 'search_query' for queries
 * @returns Array of 1024-dimensional float vectors
 * @throws if COHERE_API_KEY is unset, batch too large, or API errors
 */
export async function cohereEmbed(
  texts: string | string[],
  inputType: 'search_document' | 'search_query' = 'search_document',
): Promise<number[][]> {
  const op = '[cohereEmbed]';

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${op} COHERE_API_KEY is not set. ` +
      'This is the Jina fallback embedder. ' +
      'Set COHERE_API_KEY in .env.local if you need the fallback path. ' +
      'Get a key at https://cohere.com',
    );
  }

  const inputArray = Array.isArray(texts) ? texts : [texts];

  if (inputArray.length === 0) return [];
  if (inputArray.length > MAX_BATCH_SIZE) {
    throw new Error(
      `${op} Batch size ${inputArray.length} exceeds Cohere maximum of ${MAX_BATCH_SIZE}.`,
    );
  }

  const response = await fetch(COHERE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      texts: inputArray,
      input_type: inputType,
      embedding_types: ['float'],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${op} Cohere API error ${response.status}: ${body.substring(0, 300)}`,
    );
  }

  const json = (await response.json()) as CohereEmbedResponse;
  const floatEmbeddings = json.embeddings?.float;

  if (!floatEmbeddings || floatEmbeddings.length !== inputArray.length) {
    throw new Error(
      `${op} Cohere returned ${floatEmbeddings?.length ?? 0} embeddings for ${inputArray.length} inputs.`,
    );
  }

  // floatEmbeddings is narrowed to number[][] past the guard above
  const verified: number[][] = floatEmbeddings;

  // Dimension assertion
  for (let i = 0; i < verified.length; i++) {
    if (verified[i]!.length !== EXPECTED_DIM) {
      throw new Error(
        `${op} Cohere embedding at index ${i} has dimension ${verified[i]!.length}, expected ${EXPECTED_DIM}.`,
      );
    }
  }

  return verified;
}
