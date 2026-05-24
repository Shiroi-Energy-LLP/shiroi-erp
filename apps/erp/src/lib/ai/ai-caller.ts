/**
 * ai-caller.ts — provider-agnostic AI text generation helper.
 *
 * Usage:
 *   import { callAi } from '@/lib/ai/ai-caller';
 *
 *   const text = await callAi('Write a 3-sentence summary of...', { maxTokens: 400 });
 *
 * The active provider is controlled by AI_PROVIDER env var:
 *   AI_PROVIDER=anthropic   → Direct Anthropic API (default)
 *   AI_PROVIDER=openrouter  → OpenRouter (any model via AI_MODEL env var)
 */

import { getAiConfig } from './ai-config';
import { createOpenRouterClient, chatOpenRouter } from './openrouter-client';
import type { AiConfig } from './ai-config';

export interface CallAiOptions {
  maxTokens?: number;
  model?: string;
}

/**
 * callAi — fire a single-turn prompt and return the text response.
 *
 * Swapping providers is a config change (AI_PROVIDER env var) — no code change.
 */
export async function callAi(
  prompt: string,
  options: CallAiOptions = {},
): Promise<string> {
  const op = '[callAi]';
  const config: AiConfig = getAiConfig({
    maxTokens: options.maxTokens ?? 1024,
    model: options.model,
  });

  if (config.provider === 'openrouter') {
    const client = createOpenRouterClient(config);
    return chatOpenRouter(client, config, [{ role: 'user', content: prompt }]);
  }

  // Default: Anthropic direct API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`${op} ANTHROPIC_API_KEY not set`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${op} Anthropic API error ${response.status}: ${body}`);
  }

  const result = await response.json();
  return (result.content?.[0]?.text ?? '').trim();
}
