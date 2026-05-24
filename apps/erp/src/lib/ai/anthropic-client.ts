/**
 * Anthropic Claude API client factory for Shiroi ERP.
 *
 * Provides a typed wrapper around the Anthropic SDK so calling code
 * doesn't need to handle API key initialization, retry config, or
 * SDK versioning. All ERP server actions that call Claude MUST use
 * this factory — never import @anthropic-ai/sdk directly.
 *
 * Model: claude-sonnet-4-20250514 (as configured in CLAUDE.md)
 *
 * Usage:
 *   import { getAnthropicClient, CLAUDE_MODEL } from '@/lib/ai/anthropic-client';
 *   const client = getAnthropicClient();
 *   const msg = await client.messages.create({ model: CLAUDE_MODEL, ... });
 */

import Anthropic from '@anthropic-ai/sdk';

/** The canonical model for all ERP AI calls. */
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514' as const;

/** Max tokens for generation tasks (narrative, summary). */
export const MAX_TOKENS_GENERATION = 1024;

/** Max tokens for short outputs (subject lines, one-liners). */
export const MAX_TOKENS_SHORT = 256;

let _client: Anthropic | null = null;

/**
 * Returns a singleton Anthropic client.
 * Throws if ANTHROPIC_API_KEY is not set.
 */
export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Configure it in .env.local for local dev, ' +
      'or in Vercel environment variables for production.',
    );
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Simple text generation helper. Wraps the most common use case:
 * single user message → assistant text response.
 *
 * @param systemPrompt - System context for the assistant
 * @param userMessage - The user turn content
 * @param maxTokens - Optional token cap (default MAX_TOKENS_GENERATION)
 * @returns The generated text, or null on failure
 */
export async function generateText(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = MAX_TOKENS_GENERATION,
): Promise<string | null> {
  const op = '[generateText]';
  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = message.content[0];
    if (block?.type !== 'text') return null;
    return block.text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Anthropic API call failed`, { error: msg, timestamp: new Date().toISOString() });
    return null;
  }
}
