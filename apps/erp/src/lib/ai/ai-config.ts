/**
 * ai-config.ts — environment-driven AI provider configuration.
 *
 * Supported providers:
 *   anthropic   — Direct Anthropic API (default). Needs ANTHROPIC_API_KEY.
 *   openrouter  — OpenRouter (multi-model). Needs OPENROUTER_API_KEY + AI_MODEL.
 *
 * Usage:
 *   Set AI_PROVIDER=openrouter and AI_MODEL=gpt-4o in .env.local to route
 *   all AI calls through OpenRouter. Swap back to Anthropic with AI_PROVIDER=anthropic.
 *
 * See docs/SHIROI_MASTER_REFERENCE.md § AI for per-model capability notes.
 */

export type AiProvider = 'anthropic' | 'openrouter';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  maxTokens: number;
  /** OpenRouter-specific: site URL for attribution / rate-limit tiers */
  openRouterSiteUrl?: string;
  openRouterSiteName?: string;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4-5';

export function getAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic') as AiProvider;

  const defaultModel =
    provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_ANTHROPIC_MODEL;

  return {
    provider,
    model: process.env.AI_MODEL ?? defaultModel,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '1024', 10),
    openRouterSiteUrl: 'https://erp.shiroienergy.com',
    openRouterSiteName: 'Shiroi Energy ERP',
    ...overrides,
  };
}
