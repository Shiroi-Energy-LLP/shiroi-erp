/**
 * openrouter-client.ts — OpenAI-compatible client pointed at OpenRouter.
 *
 * OpenRouter exposes an OpenAI-compatible REST API, so we re-use the openai
 * SDK but override the base URL. This means any model available on OpenRouter
 * (GPT-4o, Claude, Llama, Mistral, etc.) is a single env-var change away.
 *
 * Prerequisites:
 *   npm add openai   (or pnpm add openai — add to apps/erp/package.json)
 *   Set OPENROUTER_API_KEY in .env.local
 *
 * See https://openrouter.ai/docs for model IDs and pricing.
 */

import OpenAI from 'openai';
import type { AiConfig } from './ai-config';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function createOpenRouterClient(config: AiConfig): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Add it to .env.local to use OpenRouter provider.',
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': config.openRouterSiteUrl ?? 'https://erp.shiroienergy.com',
      'X-Title': config.openRouterSiteName ?? 'Shiroi Energy ERP',
    },
  });
}

export async function chatOpenRouter(
  client: OpenAI,
  config: AiConfig,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens,
    messages,
  });
  return completion.choices[0]?.message?.content?.trim() ?? '';
}
