'use server';

/**
 * monthly-perf-narrator.ts — AI narrative generator for A4 monthly customer
 * performance reports.
 *
 * T8.2: narrateMonthlyPerf(project, kpis) → Haiku 2-sentence WhatsApp note.
 *
 * Keeps the same callHaikuWithSystem pattern as briefing-narrator.ts to avoid
 * adding another layer of abstraction before the ai-caller abstraction
 * (F8) is ready.
 */

import { getAiConfig } from './ai-config';
import type { PerfCohortItem, MonthlyPerfKpis } from './monthly-perf-kpis';

// Claude Haiku — fast, cheap, appropriate for per-customer narratives.
const HAIKU_MODEL = 'claude-haiku-4-5-20250514';

export interface PerfNarration {
  narrative: string;   // 2-sentence WhatsApp note
  tokens_in: number;
  tokens_out: number;
}

// ── Month name helper ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthName(m: number): string {
  return MONTH_NAMES[m] ?? String(m);
}

// ── Friendly date format ──────────────────────────────────────────────────────

/** "2026-05-15" → "15-May" */
function friendlyDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [, mm, dd] = parts as [string, string, string];
  const mIdx = parseInt(mm, 10);
  const abbrev = (MONTH_NAMES[mIdx] ?? mm).slice(0, 3);
  return `${parseInt(dd, 10)}-${abbrev}`;
}

// ── INR formatting for prompt ─────────────────────────────────────────────────

function formatInrShort(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)} Cr`;
  if (amount >= 100_000)    return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000)      return `₹${(amount / 1_000).toFixed(0)}K`;
  return `₹${Math.round(amount)}`;
}

// ── Low-level Anthropic call ──────────────────────────────────────────────────

async function callHaikuWithSystem(
  system: string,
  user: string,
  maxTokens: number,
  apiKey: string,
  model: string,
): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const op = '[callHaikuWithSystem:monthly-perf]';
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

// ── narrateMonthlyPerf ────────────────────────────────────────────────────────

/**
 * Generates a warm, 2-sentence WhatsApp note for a customer about their
 * solar system's monthly performance. Uses Claude Haiku.
 *
 * If the API key is missing or the call fails, returns a templated fallback
 * so the orchestrator can still upsert the record without the narrative.
 */
export async function narrateMonthlyPerf(
  project: PerfCohortItem,
  kpis: MonthlyPerfKpis,
  year: number,
  month: number,
): Promise<PerfNarration> {
  const op = '[narrateMonthlyPerf]';

  const config = getAiConfig({ model: HAIKU_MODEL, maxTokens: 200 });
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const mName = monthName(month);
  const firstName = project.customer_name.split(' ')[0] ?? project.customer_name;
  const savingsFormatted = formatInrShort(kpis.estimated_savings_inr);
  const topDayFormatted = kpis.top_date ? friendlyDate(kpis.top_date) : null;

  // Variance phrasing
  let varianceLine = '';
  if (kpis.variance_pct != null) {
    const sign = kpis.variance_pct >= 0 ? '+' : '';
    varianceLine = `${sign}${kpis.variance_pct}% vs expected`;
  }

  // Fallback narrative — used if API key missing or call fails.
  const fallback = buildFallback(
    firstName,
    project.system_size_kwp,
    kpis.actual_kwh,
    mName,
    savingsFormatted,
    varianceLine,
    topDayFormatted,
    kpis.top_kwh,
  );

  if (!apiKey) {
    console.warn(`${op} ANTHROPIC_API_KEY not set — using fallback narrative`, {
      projectId: project.project_id,
      timestamp: new Date().toISOString(),
    });
    return { narrative: fallback, tokens_in: 0, tokens_out: 0 };
  }

  const model = config.provider === 'openrouter'
    ? (process.env.AI_MODEL ?? 'anthropic/claude-haiku-4-5')
    : (process.env.AI_MODEL ?? HAIKU_MODEL);

  const systemPrompt =
    `You write friendly 2-sentence WhatsApp notes for solar customers in Indian English. ` +
    `Tone: warm and factual, not salesy. Use ₹ format for money. No emoji. No hash symbols. ` +
    `Maximum 240 characters total. Return only the message text — no labels, no quotes.`;

  const topDayPart = topDayFormatted && kpis.top_kwh != null
    ? `Top day: ${topDayFormatted} (${kpis.top_kwh} kWh).`
    : '';

  const variancePart = varianceLine ? `(${varianceLine})` : '';

  const userMessage =
    `Write a friendly 2-sentence WhatsApp note to ${firstName} about their ` +
    `${project.system_size_kwp} kWp solar system's ${mName} performance: ` +
    `generated ${kpis.actual_kwh.toFixed(0)} kWh ${variancePart}, ` +
    `estimated savings ${savingsFormatted}. ${topDayPart}`;

  try {
    const result = await callHaikuWithSystem(systemPrompt, userMessage, 200, apiKey, model);
    // Clamp to 240 chars to fit WhatsApp template variable limits
    const narrative = result.text.slice(0, 240);
    return {
      narrative,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Haiku call failed — using fallback narrative`, {
      error: msg,
      projectId: project.project_id,
      timestamp: new Date().toISOString(),
    });
    return { narrative: fallback, tokens_in: 0, tokens_out: 0 };
  }
}

// ── Fallback narrative ────────────────────────────────────────────────────────

function buildFallback(
  firstName: string,
  sizeKwp: number,
  actualKwh: number,
  mName: string,
  savings: string,
  variance: string,
  topDay: string | null,
  topKwh: number | null,
): string {
  const variancePart = variance ? ` (${variance})` : '';
  const topPart = topDay && topKwh != null
    ? ` Top day: ${topDay} (${topKwh.toFixed(0)} kWh).`
    : '';
  return (
    `Hi ${firstName}! Your ${sizeKwp} kWp solar system generated ` +
    `${actualKwh.toFixed(0)} kWh in ${mName}${variancePart}, saving ~${savings}.${topPart}`
  );
}
