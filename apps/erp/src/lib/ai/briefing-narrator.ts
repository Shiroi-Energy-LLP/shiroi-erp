'use server';

/**
 * briefing-narrator.ts — AI narrative generator for the daily executive briefing.
 *
 * Uses Haiku via the existing ai-caller abstraction (provider-agnostic).
 * RAG context is retrieved to give the AI a sense of "what's normal at Shiroi."
 * Two calls: (1) full narrative, (2) WhatsApp-short version ≤500 chars.
 */

import { getAiConfig } from './ai-config';
import { retrieve } from '@/lib/rag/retrieve';
import type { BriefingKpis } from './briefing-kpis';

// Claude Haiku 4.5 — fast, cheap, appropriate for daily briefings
const HAIKU_MODEL = 'claude-haiku-4-5-20250514';

export interface Briefing {
  narrative: string;       // 3 paragraphs, ~600–900 words
  whatsapp_short: string;  // ≤500 chars version for WhatsApp
  tokens_in: number;
  tokens_out: number;
}

// ── Money formatting for prompt ───────────────────────────────────────────────

function formatCrLakh(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${(amount / 10_000_000).toFixed(1)} Cr`;
  }
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)}L`;
  }
  if (amount >= 1_000) {
    return `₹${(amount / 1_000).toFixed(0)}K`;
  }
  return `₹${amount.toFixed(0)}`;
}

// ── RAG context formatter ─────────────────────────────────────────────────────

function formatRagChunks(chunks: Awaited<ReturnType<typeof retrieve>>): string {
  if (chunks.length === 0) return '(no baseline context retrieved)';
  return chunks
    .map((c, i) => {
      const src = c.source_path.split('/').pop() ?? c.source_path;
      return `[${i + 1}] ${src}:\n${c.content.slice(0, 600)}`;
    })
    .join('\n\n');
}

// ── KPI bundle formatter for prompt ──────────────────────────────────────────

function formatKpisForPrompt(kpis: BriefingKpis): string {
  const lines: string[] = [
    `Date: ${kpis.date} (yesterday)`,
    `Recipient role: ${kpis.recipient_role}`,
    '',
    '--- SALES ---',
    `New leads yesterday: ${kpis.leads_new_yesterday}`,
    `Lead stage counts: ${JSON.stringify(kpis.leads_by_stage)}`,
    `Pipeline closing this week: ${kpis.pipeline_close_this_week.count} leads worth ${formatCrLakh(kpis.pipeline_close_this_week.total_value)}`,
    `Expected orders this week: ${kpis.expected_orders_this_week}`,
    '',
    '--- CASH & PAYMENTS ---',
    `Cash / total receivables now: ${formatCrLakh(kpis.cash_position_now)}`,
    `Payments expected this week: ${kpis.expected_payments_this_week.count} milestones, total ${formatCrLakh(kpis.expected_payments_this_week.total)}`,
    `MSME aging 30+ days: ${formatCrLakh(kpis.msme_aging_30plus)}`,
    `MSME aging 40+ days: ${formatCrLakh(kpis.msme_aging_40plus)}`,
    '',
    '--- PROJECTS ---',
    `Projects in progress: ${kpis.projects_in_progress_count}`,
    `Commissioning this week: ${kpis.commissioning_this_week}`,
    `Delayed / on-hold projects: ${kpis.delayed_projects_count}`,
    '',
    '--- O&M ---',
    `Open critical tickets: ${kpis.open_critical_tickets}`,
    '',
    '--- ANOMALIES ---',
  ];
  if (kpis.anomalies.length === 0) {
    lines.push('(none detected)');
  } else {
    for (const anomaly of kpis.anomalies) {
      lines.push(`• ${anomaly}`);
    }
  }
  return lines.join('\n');
}

// ── Anthropic direct call (with system + user separation) ────────────────────

async function callHaikuWithSystem(
  system: string,
  user: string,
  maxTokens: number,
  apiKey: string,
  model: string,
): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const op = '[callHaikuWithSystem]';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${op} Anthropic API error ${response.status}: ${body}`);
  }

  const result = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = (result.content?.[0]?.text ?? '').trim();
  return {
    text,
    tokens_in: result.usage?.input_tokens ?? 0,
    tokens_out: result.usage?.output_tokens ?? 0,
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function narrateBriefing(kpis: BriefingKpis): Promise<Briefing> {
  const op = '[narrateBriefing]';
  const config = getAiConfig({ model: HAIKU_MODEL, maxTokens: 1200 });

  // Step 1: RAG context — "what's normal at Shiroi"
  let ragChunks: Awaited<ReturnType<typeof retrieve>> = [];
  try {
    ragChunks = await retrieve('Shiroi operations baseline normal day performance', {
      source_types: ['module_doc', 'master_reference'],
      top_k: 3,
      min_similarity: 0.4,
    });
  } catch (ragErr) {
    // RAG failure is non-fatal — proceed without baseline context
    console.warn(`${op} RAG retrieval failed, proceeding without baseline`, {
      error: ragErr instanceof Error ? ragErr.message : String(ragErr),
      timestamp: new Date().toISOString(),
    });
  }

  const ragContext = formatRagChunks(ragChunks);
  const kpiText = formatKpisForPrompt(kpis);

  // Step 2: Build system prompt
  const roleLabel =
    kpis.recipient_role === 'founder'
      ? 'Vivek (Founder, Shiroi Energy LLP)'
      : kpis.recipient_role === 'marketing_manager'
        ? 'Prem (Sales Head, Shiroi Energy LLP)'
        : 'Manivel (Project Manager Head, Shiroi Energy LLP)';

  const systemPrompt = `You write executive morning briefings for Shiroi Energy LLP, a Chennai-based solar EPC company. Recipient: ${roleLabel}.

Style rules:
- Direct, factual, no fluff. Indian English.
- Money in Indian format: ₹2.4 Cr / ₹5.0L / ₹50K (use formatCrLakh convention).
- Three paragraphs exactly:
  (1) Yesterday's wins and key numbers — what happened, what moved.
  (2) Anomalies, risks, or decisions needed today — flag anything requiring action.
  (3) What to focus on today — 2-3 concrete priorities.
- Cite specific numbers, not generalities.
- Skip sections with zero data gracefully (e.g. "No new leads yesterday").
- Total length: 200–350 words.`;

  const userMessage = `Yesterday's data:\n${kpiText}\n\nShiroi baseline (for context, to help identify what's unusual):\n${ragContext}\n\nWrite the morning briefing for ${roleLabel}.`;

  // Use Anthropic direct API for system+user separation (callAi only supports user)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No Claude key → degrade to SQL-only. The briefing route still returns its
    // deterministic action_block; the AI narrative is simply omitted. Keeps the
    // morning digests working without a Claude dependency.
    console.warn(`${op} ANTHROPIC_API_KEY not set — returning empty narrative (SQL-only digest)`, {
      timestamp: new Date().toISOString(),
    });
    return { narrative: '', whatsapp_short: '', tokens_in: 0, tokens_out: 0 };
  }

  const model = config.provider === 'openrouter'
    ? (process.env.AI_MODEL ?? 'anthropic/claude-haiku-4-5')
    : (process.env.AI_MODEL ?? HAIKU_MODEL);

  let totalTokensIn = 0;
  let totalTokensOut = 0;

  // Step 3: Generate full narrative
  let narrative = '';
  try {
    const result = await callHaikuWithSystem(systemPrompt, userMessage, 1200, apiKey, model);
    narrative = result.text;
    totalTokensIn += result.tokens_in;
    totalTokensOut += result.tokens_out;
  } catch (e) {
    // AI call failed (rate limit, network, bad key) → degrade to SQL-only rather
    // than 500-ing the route, so the action_block still reaches the digest.
    console.error(`${op} narrative generation failed — degrading to SQL-only digest`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    return { narrative: '', whatsapp_short: '', tokens_in: totalTokensIn, tokens_out: totalTokensOut };
  }

  // Step 4: Generate WA-short version (≤500 chars)
  // Extract first ~2 sentences + key numbers, capped at 500 chars.
  // Two-call approach: ask Haiku to compress the narrative.
  let whatsappShort = '';
  try {
    const waSystemPrompt = `You compress executive briefings into a WhatsApp message of MAXIMUM 480 characters (not words — characters). Include: key numbers, 1 anomaly if any, top priority. No greetings, no emoji unless critical. Indian English. Start with the date.`;
    const waUserMessage = `Compress this briefing into ≤480 characters for WhatsApp:\n\n${narrative}`;
    const waResult = await callHaikuWithSystem(waSystemPrompt, waUserMessage, 300, apiKey, model);
    whatsappShort = waResult.text.slice(0, 500);
    totalTokensIn += waResult.tokens_in;
    totalTokensOut += waResult.tokens_out;
  } catch (e) {
    console.warn(`${op} WA-short generation failed, falling back to truncation`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    // Fallback: first paragraph, truncated
    whatsappShort = narrative.split('\n\n')[0]?.slice(0, 497) ?? narrative.slice(0, 497);
    const firstParaLen: number = narrative.split('\n\n')[0]?.length ?? 0;
    if (whatsappShort.length < firstParaLen) {
      whatsappShort = whatsappShort + '…';
    }
  }

  return {
    narrative,
    whatsapp_short: whatsappShort,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
  };
}
