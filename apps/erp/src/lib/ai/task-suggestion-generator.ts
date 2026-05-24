// Server-only utility — no 'use server' directive needed (not a Server Action module).
import Anthropic from '@anthropic-ai/sdk';
import type { StaleItem } from './task-suggestion-scanner';

/** Claude Haiku 4.5 — cost-optimised model for bulk task suggestions. */
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 256;

/**
 * generateSuggestedTask — calls Claude Haiku 4.5 to draft a task title
 * and 1-2 sentence description for a stale entity.
 *
 * Returns { title, description, tokens_used }.
 * Throws on API failure (caller should catch and mark queue row as error).
 */
export async function generateSuggestedTask(
  item: StaleItem,
): Promise<{ title: string; description: string; tokens_used: number }> {
  const op = '[generateSuggestedTask]';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`${op} ANTHROPIC_API_KEY not set`);

  const client = new Anthropic({ apiKey });

  const systemPrompt =
    'You write follow-up task titles for the Shiroi Energy CRM. ' +
    'Style: imperative verb phrase, 8-15 words. Tone: direct, no fluff. Indian English. ' +
    'Output must be valid JSON: {"title": "...", "description": "..."}. ' +
    'Description: 1-2 sentences, practical, tells the assignee exactly what to do.';

  const userMessage =
    `Context: ${item.entity_type} stale. ${item.context_blurb}. ` +
    `Reason: ${item.staleness_signal}.\n\n` +
    `Write a task title + 1-2 sentence description for the assignee. ` +
    `Output only valid JSON, no markdown.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  const block = response.content[0];
  if (block?.type !== 'text') {
    throw new Error(`${op} Unexpected response type: ${block?.type ?? 'none'}`);
  }

  let parsed: { title?: string; description?: string };
  try {
    parsed = JSON.parse(block.text.trim()) as { title?: string; description?: string };
  } catch {
    console.error(`${op} Failed to parse AI JSON:`, {
      raw: block.text,
      item,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} AI returned non-JSON: ${block.text.slice(0, 100)}`);
  }

  const title = parsed.title?.trim();
  const description = parsed.description?.trim();

  if (!title || !description) {
    throw new Error(`${op} AI returned incomplete JSON — missing title or description`);
  }

  return { title, description, tokens_used: tokensUsed };
}
