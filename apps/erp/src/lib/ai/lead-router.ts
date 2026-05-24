'use server';

/**
 * S12 — F5 AI lead routing.
 *
 * When a new lead arrives (any source), this module:
 *  1. Loads the lead's context (city, segment, notes, source).
 *  2. Loads all active sales_territories.
 *  3. Calls Claude Haiku to pick the best territory match + assess urgency.
 *  4. Sets leads.assigned_to (via the territory's default_assignee_employee_id)
 *     and optionally bumps close_probability for high-urgency leads.
 *  5. Emits `lead.routed` event.
 *
 * Fire-and-forget usage (from lead creation paths):
 *   void routeLeadAndAssign(leadId);
 *
 * The function never throws. Failures are logged and surfaced via ActionResult.
 */

import { createAdminClient } from '@repo/supabase/admin';
import { emitErpEvent } from '@/lib/n8n/emit';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { getAiConfig } from './ai-config';
import type { Database } from '@repo/types/database';

// Claude Haiku 4.5 — fast, cheap, appropriate for routing decisions
const HAIKU_MODEL = 'claude-haiku-4-5-20251001' as const;
const MAX_TOKENS = 512;

type SalesTerritory = Database['public']['Tables']['sales_territories']['Row'];
type LeadRow = Database['public']['Tables']['leads']['Row'];

export interface RoutingDecision {
  assigned_employee_id: string | null;
  territory_name: string | null;
  matched_segment: string | null;
  urgency: 'low' | 'medium' | 'high';
  reasoning: string;
  ai_tokens_used: number;
}

// ── AI response shape ─────────────────────────────────────────────────────────

interface AiRoutingResponse {
  matched_territory_id: string | null;
  matched_segment: string | null;
  urgency: 'low' | 'medium' | 'high';
  reasoning: string;
}

function isAiRoutingResponse(obj: unknown): obj is AiRoutingResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    'urgency' in o &&
    (o['urgency'] === 'low' || o['urgency'] === 'medium' || o['urgency'] === 'high') &&
    'reasoning' in o &&
    typeof o['reasoning'] === 'string'
  );
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

function buildLeadContext(lead: LeadRow): string {
  const parts: string[] = [
    `Customer name: ${lead.customer_name}`,
    `City: ${lead.city || 'unknown'}`,
    `State: ${lead.state || 'Tamil Nadu'}`,
    `Segment: ${lead.segment || 'not specified'}`,
    `Source: ${lead.source}`,
  ];
  if (lead.estimated_size_kwp) parts.push(`System size: ${lead.estimated_size_kwp} kWp`);
  if (lead.notes) parts.push(`Notes: ${lead.notes.slice(0, 500)}`);
  if (lead.system_type) parts.push(`System type: ${lead.system_type}`);
  return parts.join('\n');
}

function buildTerritoriesContext(territories: SalesTerritory[]): string {
  return JSON.stringify(
    territories.map((t) => ({
      id: t.id,
      territory_name: t.territory_name,
      cities: t.cities,
      segment: t.segment ?? null,
      has_assignee: t.default_assignee_employee_id !== null,
    })),
    null,
    2,
  );
}

// ── Core AI call ──────────────────────────────────────────────────────────────

async function callHaikuRouter(
  leadContext: string,
  territoriesJson: string,
): Promise<{ response: AiRoutingResponse; tokensUsed: number }> {
  const op = '[callHaikuRouter]';

  const systemPrompt = `You route inbound solar leads at Shiroi Energy to the right sales engineer based on city and segment.

Return STRICT JSON only — no markdown, no explanation outside the JSON:
{
  "matched_territory_id": "<UUID or null>",
  "matched_segment": "<residential|commercial|industrial or null>",
  "urgency": "<low|medium|high>",
  "reasoning": "<one sentence>"
}

Urgency rules:
- high: message mentions deadline, specific timeline, already comparing quotes, or wants to sign quickly
- medium: normal enquiry with some specifics (size, segment, timeline)
- low: vague enquiry, no specifics, just asking prices

Territory matching rules:
- Match the lead's city against the territory's cities array (case-insensitive).
- If a territory has a segment filter, only match leads with that segment.
- If multiple territories match, prefer the one with has_assignee=true and a segment match.
- If no territory city matches, return matched_territory_id=null.`;

  const userMessage = `Lead context:\n${leadContext}\n\nAvailable territories:\n${territoriesJson}\n\nReturn routing JSON.`;

  const config = getAiConfig({ model: HAIKU_MODEL, maxTokens: MAX_TOKENS });

  if (config.provider === 'openrouter') {
    // OpenRouter path — use fetch with system+user messages
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error(`${op} OPENROUTER_API_KEY not set`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': config.openRouterSiteUrl ?? 'https://erp.shiroienergy.com',
        'X-Title': config.openRouterSiteName ?? 'Shiroi Energy ERP',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${op} OpenRouter error ${response.status}: ${body}`);
    }
    const result = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens?: number };
    };
    const text = result.choices?.[0]?.message?.content ?? '';
    const tokensUsed = result.usage?.total_tokens ?? 0;
    const parsed = JSON.parse(text) as unknown;
    if (!isAiRoutingResponse(parsed)) {
      throw new Error(`${op} Unexpected AI response shape: ${text}`);
    }
    return { response: parsed, tokensUsed };
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
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${op} Anthropic error ${response.status}: ${body}`);
  }

  const result = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (result.content?.[0]?.text ?? '').trim();
  const tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);

  // Strip markdown fences if the model wraps in ```json ... ```
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(stripped) as unknown;
  if (!isAiRoutingResponse(parsed)) {
    throw new Error(`${op} Unexpected AI response shape: ${text}`);
  }
  return { response: parsed, tokensUsed };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Route a lead to the best sales territory + assignee via AI.
 *
 * Safe to call fire-and-forget (void routeLeadAndAssign(id)).
 * Errors are caught and returned as ActionResult — they never propagate.
 */
export async function routeLeadAndAssign(
  leadId: string,
): Promise<ActionResult<RoutingDecision>> {
  const op = '[routeLeadAndAssign]';

  try {
    const admin = createAdminClient();

    // 1. Load the lead
    const { data: lead, error: leadError } = await admin
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .is('deleted_at', null)
      .maybeSingle();

    if (leadError) {
      console.error(`${op} Failed to load lead`, { leadId, error: leadError, timestamp: new Date().toISOString() });
      return err(leadError.message, leadError.code);
    }
    if (!lead) {
      console.error(`${op} Lead not found`, { leadId, timestamp: new Date().toISOString() });
      return err('Lead not found');
    }

    // 2. Load all active territories
    const { data: territories, error: terrError } = await admin
      .from('sales_territories')
      .select('*')
      .eq('active', true)
      .order('territory_name');

    if (terrError) {
      console.error(`${op} Failed to load territories`, { error: terrError, timestamp: new Date().toISOString() });
      return err(terrError.message, terrError.code);
    }

    if (!territories || territories.length === 0) {
      // No territories configured — emit event with no assignment, return early
      const decision: RoutingDecision = {
        assigned_employee_id: null,
        territory_name: null,
        matched_segment: null,
        urgency: 'medium',
        reasoning: 'No sales territories configured yet.',
        ai_tokens_used: 0,
      };
      void emitErpEvent('lead.routed', {
        lead_id: leadId,
        employee_id: null,
        territory_name: null,
        urgency: 'medium',
        reasoning: decision.reasoning,
      });
      return ok(decision);
    }

    // 3. Call Haiku to pick territory + urgency
    const leadContext = buildLeadContext(lead);
    const territoriesJson = buildTerritoriesContext(territories);

    let aiResponse: AiRoutingResponse;
    let aiTokensUsed: number;

    try {
      const result = await callHaikuRouter(leadContext, territoriesJson);
      aiResponse = result.response;
      aiTokensUsed = result.tokensUsed;
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      console.error(`${op} AI call failed`, { leadId, error: msg, timestamp: new Date().toISOString() });
      return err(`AI call failed: ${msg}`);
    }

    // 4. Look up the matched territory's assignee
    let matchedTerritory: SalesTerritory | null = null;
    let assignedEmployeeId: string | null = null;

    if (aiResponse.matched_territory_id) {
      matchedTerritory = territories.find((t) => t.id === aiResponse.matched_territory_id) ?? null;
      if (matchedTerritory) {
        assignedEmployeeId = matchedTerritory.default_assignee_employee_id;
      }
    }

    // 5. Update lead: assigned_to + optionally bump close_probability
    const updates: Database['public']['Tables']['leads']['Update'] = {
      updated_at: new Date().toISOString(),
    };

    if (assignedEmployeeId) {
      // Only set assigned_to if the lead is currently unassigned
      if (!lead.assigned_to) {
        updates.assigned_to = assignedEmployeeId;
      }
    }

    // Bump close_probability by +10 for high-urgency leads (cap at 100)
    if (aiResponse.urgency === 'high' && lead.close_probability !== null) {
      updates.close_probability = Math.min((lead.close_probability ?? 0) + 10, 100);
    } else if (aiResponse.urgency === 'high' && lead.close_probability === null) {
      updates.close_probability = 10;
    }

    if (Object.keys(updates).length > 1) {
      const { error: updateError } = await admin
        .from('leads')
        .update(updates)
        .eq('id', leadId);

      if (updateError) {
        console.error(`${op} Failed to update lead`, { leadId, error: updateError, timestamp: new Date().toISOString() });
        // Non-fatal — we still emit the event and return the decision
      }
    }

    // 6. Emit event
    void emitErpEvent('lead.routed', {
      lead_id: leadId,
      employee_id: assignedEmployeeId,
      territory_name: matchedTerritory?.territory_name ?? null,
      urgency: aiResponse.urgency,
      reasoning: aiResponse.reasoning,
    });

    // Audit trail lives in the n8n event bus via 'lead.routed' above.
    // A dedicated lead_routing_log table can be added later if granular replay is needed.

    const decision: RoutingDecision = {
      assigned_employee_id: assignedEmployeeId,
      territory_name: matchedTerritory?.territory_name ?? null,
      matched_segment: aiResponse.matched_segment,
      urgency: aiResponse.urgency,
      reasoning: aiResponse.reasoning,
      ai_tokens_used: aiTokensUsed,
    };

    console.log(`${op} Routed lead successfully`, {
      leadId,
      territory: decision.territory_name,
      urgency: decision.urgency,
      assigned: !!assignedEmployeeId,
      timestamp: new Date().toISOString(),
    });

    return ok(decision);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Unexpected error`, { leadId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
