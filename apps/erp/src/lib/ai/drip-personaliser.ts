'use server';
/**
 * drip-personaliser.ts — AI-driven variable value generator for F1 customer drip templates.
 *
 * Meta WhatsApp templates are FIXED (approved by Meta — cannot change body/structure).
 * This module personalises only the VALUES of the {{N}} placeholder variables per customer.
 *
 * Flow:
 *   1. Lookup customer history (prior messages, tickets, payments) for context
 *   2. Call Claude Haiku with a structured prompt asking for JSON { vars: [...] }
 *   3. Validate each var (non-empty string, ≤30 chars)
 *   4. UPDATE customer_outreach_queue with the AI personalisation audit columns
 *   5. Return the vars array so the caller (API route) can pass them to Meta
 *
 * Latency budget: <2 s total (Haiku is fast; Supabase roundtrips are minimal).
 * If Haiku takes longer, n8n's continueOnFail on the HTTP Request node falls back
 * to static variable values.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Json } from '@repo/types/database';
import { DRIP_TEMPLATES, type DripTemplateName } from './drip-template-registry';

// Re-export for consumers that import from this file.
export type { DripTemplateName };

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Claude Haiku 4.5 — fast and cheap for high-volume drip personalisation.
 * Using the same model constant pattern as task-suggestion-generator.ts.
 */
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/** Each Meta template variable value must be ≤30 chars. */
const MAX_VAR_LENGTH = 30;

/** Generous enough for the JSON object with 5 vars, conservative enough to stay fast. */
const MAX_TOKENS = 512;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PersonaliseInput {
  templateName: DripTemplateName;
  customerName: string;
  /** e.g. 'residential' | 'commercial' | 'industrial' */
  customerSegment: string;
  projectNumber: string;
  /** Any static variable values that should be passed through without AI flavour
   *  (e.g. URLs, phone numbers). Key = 1-based variable index, value = string.
   *  The AI is instructed to preserve these exactly. */
  passThrough?: Record<number, string>;
  /** Additional free-form context for the AI (e.g. "payment is ₹1,50,000 due 30 Jun 2026"). */
  contextOverrides?: Record<string, unknown>;
}

export interface PersonalisedVariables {
  /** Ordered values matching {{1}}, {{2}}, etc. in the template body. */
  vars: string[];
  ai_tokens_in: number;
  ai_tokens_out: number;
  ai_model: string;
}

// ── Customer history lookup ────────────────────────────────────────────────────

interface CustomerHistory {
  recent_messages: Array<{ template_name: string; sent_at: string }>;
  open_ticket_count: number;
  total_payments_received: number;
}

async function fetchCustomerHistory(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<CustomerHistory> {
  const op = '[fetchCustomerHistory]';

  // Recent messages (last 10) for this project
  const { data: messages, error: msgError } = await admin
    .from('customer_message_log')
    .select('template_name, sent_at')
    .eq('project_id', projectId)
    .order('sent_at', { ascending: false })
    .limit(10);

  if (msgError) {
    console.warn(`${op} failed to fetch customer_message_log`, {
      project_id: projectId,
      error: msgError.message,
      timestamp: new Date().toISOString(),
    });
  }

  // Open O&M tickets for this project
  const { count: ticketCount, error: ticketError } = await admin
    .from('om_service_tickets')
    .select('id', { count: 'estimated', head: true })
    .eq('project_id', projectId)
    .eq('status', 'open');

  if (ticketError) {
    console.warn(`${op} failed to fetch om_service_tickets`, {
      project_id: projectId,
      error: ticketError.message,
      timestamp: new Date().toISOString(),
    });
  }

  // Payment count received for this project
  const { count: paymentCount, error: paymentError } = await admin
    .from('customer_payments')
    .select('id', { count: 'estimated', head: true })
    .eq('project_id', projectId);

  if (paymentError) {
    console.warn(`${op} failed to fetch customer_payments`, {
      project_id: projectId,
      error: paymentError.message,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    recent_messages: (messages ?? [])
      .filter((m): m is typeof m & { sent_at: string } => m.sent_at !== null)
      .map((m) => ({
        template_name: m.template_name,
        sent_at: m.sent_at,
      })),
    open_ticket_count: ticketCount ?? 0,
    total_payments_received: paymentCount ?? 0,
  };
}

// ── AI call ────────────────────────────────────────────────────────────────────

/**
 * Calls Claude Haiku and returns the raw parsed vars array.
 * Throws on API failure — caller wraps in try/catch.
 */
async function callHaikuForVars(
  template: (typeof DRIP_TEMPLATES)[DripTemplateName],
  input: PersonaliseInput,
  history: CustomerHistory,
): Promise<{ vars: string[]; tokens_in: number; tokens_out: number }> {
  const op = '[callHaikuForVars]';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`${op} ANTHROPIC_API_KEY not set`);

  const client = new Anthropic({ apiKey });

  // Build the pass-through note for the system prompt
  const passThrough = input.passThrough ?? {};
  const passThroughNote =
    Object.keys(passThrough).length > 0
      ? `\n\nIMPORTANT — some variables must be copied EXACTLY as given (do not rephrase):\n${Object.entries(passThrough)
          .map(([i, v]) => `  {{${i}}} = "${v}"`)
          .join('\n')}`
      : '';

  const systemPrompt =
    'You generate variable values for a Meta WhatsApp template at Shiroi Energy, a solar EPC company in Chennai. ' +
    'The template structure is FIXED — Meta has approved it and it cannot change. ' +
    'You only generate the VALUES for the {{N}} placeholders. ' +
    'Rules:\n' +
    '  • Each value MUST be ≤30 characters. Trim aggressively if needed.\n' +
    '  • Tone: warm, Indian English, professional. No corporate jargon.\n' +
    '  • Format money as ₹ with Indian commas (e.g. ₹1,50,000) but count characters carefully.\n' +
    '  • Use ✅ only where a milestone is clearly positive. No other emoji.\n' +
    '  • If a variable position is a URL or phone number, copy it exactly — do not shorten.\n' +
    '  • Output STRICT JSON: { "vars": ["value1", "value2", ...] } — no markdown, no explanation.\n' +
    '  • The "vars" array length MUST exactly match the number of {{N}} placeholders in the template.' +
    passThroughNote;

  // Summarise the prior interaction history
  const historyLines: string[] = [];
  if (history.recent_messages.length > 0) {
    historyLines.push(
      `Prior WhatsApp touches: ${history.recent_messages.map((m) => m.template_name).join(', ')}`,
    );
  }
  if (history.open_ticket_count > 0) {
    historyLines.push(`Open O&M tickets: ${history.open_ticket_count}`);
  }
  if (history.total_payments_received > 0) {
    historyLines.push(`Payments received so far: ${history.total_payments_received}`);
  }
  const historyContext =
    historyLines.length > 0 ? historyLines.join('\n') : 'No prior interactions recorded.';

  // Build variable descriptions
  const varDescriptions = template.variable_descriptions
    .map((desc, i) => `  ${desc.replace(`{{${i + 1}}}`, `{{${i + 1}}}`)}`)
    .join('\n');

  // Build context overrides block
  const overridesBlock =
    input.contextOverrides && Object.keys(input.contextOverrides).length > 0
      ? `\nAdditional context:\n${Object.entries(input.contextOverrides)
          .map(([k, v]) => `  ${k}: ${String(v)}`)
          .join('\n')}`
      : '';

  const userMessage =
    `Template: ${input.templateName}\n` +
    `Template body (FIXED — do not change structure):\n${template.body}\n\n` +
    `Variable positions (${template.variable_count} total):\n${varDescriptions}\n\n` +
    `Customer context:\n` +
    `  Name: ${input.customerName}\n` +
    `  Segment: ${input.customerSegment}\n` +
    `  Project: ${input.projectNumber}\n` +
    `  Prior interactions:\n  ${historyContext}` +
    overridesBlock +
    `\n\nReturn STRICT JSON: { "vars": [v1, v2, ...] } with exactly ${template.variable_count} values. No markdown.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const tokens_in = response.usage?.input_tokens ?? 0;
  const tokens_out = response.usage?.output_tokens ?? 0;

  const block = response.content[0];
  if (block?.type !== 'text') {
    throw new Error(`${op} Unexpected Haiku response type: ${block?.type ?? 'none'}`);
  }

  let parsed: { vars?: unknown };
  try {
    // Strip markdown code fences if Haiku wraps the JSON despite instructions
    const raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(raw) as { vars?: unknown };
  } catch {
    console.error(`${op} Failed to parse Haiku JSON`, {
      raw: block.text.slice(0, 200),
      template: input.templateName,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Haiku returned non-JSON: ${block.text.slice(0, 100)}`);
  }

  if (!Array.isArray(parsed.vars)) {
    throw new Error(`${op} Haiku response missing "vars" array`);
  }

  const vars = parsed.vars as unknown[];

  return {
    vars: vars.map((v, i) => {
      if (typeof v !== 'string' || v.trim() === '') {
        throw new Error(`${op} vars[${i}] is not a non-empty string: ${String(v)}`);
      }
      return v.trim();
    }),
    tokens_in,
    tokens_out,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateVars(
  vars: string[],
  expectedCount: number,
  templateName: string,
): void {
  const op = '[validateVars]';

  if (vars.length !== expectedCount) {
    throw new Error(
      `${op} ${templateName}: expected ${expectedCount} vars, got ${vars.length}`,
    );
  }

  for (let i = 0; i < vars.length; i++) {
    const v = vars[i];
    if (!v || v.trim() === '') {
      throw new Error(`${op} ${templateName}: vars[${i}] is empty`);
    }
    if (v.length > MAX_VAR_LENGTH) {
      // Truncate with ellipsis rather than throwing — Meta truncates silently anyway.
      vars[i] = v.slice(0, MAX_VAR_LENGTH - 1) + '…';
      console.warn(`${op} ${templateName}: vars[${i}] truncated to ${MAX_VAR_LENGTH} chars`, {
        original_length: v.length,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * personaliseDripMessage — generate AI-flavoured variable values for a drip template.
 *
 * @param customerOutreachQueueId - The ID of the customer_outreach_queue row to update.
 * @param input - Template name + customer context.
 * @returns ActionResult<PersonalisedVariables> — never throws across the RSC boundary.
 */
export async function personaliseDripMessage(
  customerOutreachQueueId: string,
  input: PersonaliseInput,
): Promise<ActionResult<PersonalisedVariables>> {
  const op = '[personaliseDripMessage]';

  const template = DRIP_TEMPLATES[input.templateName];
  if (!template) {
    return err(`${op} Unknown template: ${input.templateName}`);
  }

  const admin = createAdminClient();

  // Step 1 — fetch customer history for context
  let history: CustomerHistory;
  try {
    history = await fetchCustomerHistory(admin, input.projectNumber);
  } catch (e) {
    // Non-fatal — personalise without history
    console.warn(`${op} Could not fetch customer history, continuing without it`, {
      project: input.projectNumber,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    history = { recent_messages: [], open_ticket_count: 0, total_payments_received: 0 };
  }

  // Step 2 — call Haiku
  let rawVars: string[];
  let tokens_in: number;
  let tokens_out: number;

  try {
    const result = await callHaikuForVars(template, input, history);
    rawVars = result.vars;
    tokens_in = result.tokens_in;
    tokens_out = result.tokens_out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Haiku call failed`, {
      template: input.templateName,
      project: input.projectNumber,
      error: msg,
      timestamp: new Date().toISOString(),
    });
    return err(msg);
  }

  // Step 3 — validate + truncate vars
  try {
    validateVars(rawVars, template.variable_count, input.templateName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Var validation failed`, {
      template: input.templateName,
      vars: rawVars,
      error: msg,
      timestamp: new Date().toISOString(),
    });
    return err(msg);
  }

  const aiModel = HAIKU_MODEL;

  // Step 4 — update customer_outreach_queue with AI audit columns
  const { error: updateError } = await admin
    .from('customer_outreach_queue')
    .update({
      ai_personalisation: {
        template_name: input.templateName,
        vars: rawVars,
        customer_name: input.customerName,
        customer_segment: input.customerSegment,
        project_number: input.projectNumber,
        history_summary: history,
      } as unknown as Json,
      ai_personalised_at: new Date().toISOString(),
      ai_personalisation_model: aiModel,
      ai_personalisation_tokens: tokens_in + tokens_out,
    })
    .eq('id', customerOutreachQueueId);

  if (updateError) {
    // Log but don't fail — vars were generated correctly; audit is secondary.
    console.warn(`${op} Failed to update customer_outreach_queue`, {
      id: customerOutreachQueueId,
      error: updateError.message,
      code: updateError.code,
      timestamp: new Date().toISOString(),
    });
  }

  // Step 5 — return
  return ok({
    vars: rawVars,
    ai_tokens_in: tokens_in,
    ai_tokens_out: tokens_out,
    ai_model: aiModel,
  });
}
