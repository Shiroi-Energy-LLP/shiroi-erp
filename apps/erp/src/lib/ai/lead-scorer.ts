'use server';

/**
 * lead-scorer.ts — C1 AI lead scoring.
 *
 * Scores a lead 0-100 using Claude Haiku and stores the result in
 * leads.ai_score + ai_score_reason + ai_scored_at + ai_scored_model.
 *
 * Called:
 *   - On lead INSERT (fire-and-forget from lead-form.tsx via POST /api/leads/score)
 *   - On status change (fire-and-forget from status-change.tsx via same route)
 *   - On demand (founder / marketing_manager) via the same API route
 *
 * Score bands:
 *   0-30   cold / low-fit
 *   31-60  warm / qualifiable
 *   61-85  hot / should-prioritise
 *   86-100 hot + urgent / founder-attention ("HOT")
 */

import { createAdminClient } from '@repo/supabase/admin';
import { callAi } from './ai-caller';
import { emitErpEvent } from '@/lib/n8n/emit';
import type { Database } from '@repo/types/database';

type LeadRow = Database['public']['Tables']['leads']['Row'];
type LeadActivityRow = Database['public']['Tables']['lead_activities']['Row'];
type ProposalRow = Database['public']['Tables']['proposals']['Row'];

export interface LeadScoreResult {
  score: number;
  reason: string;
  tokens: number;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SCORER_SYSTEM_PROMPT = `You score solar EPC leads at Shiroi Energy on a 0-100 scale.

Score bands:
  0-30   = cold / low-fit (no urgency, wrong segment, far location, unresponsive)
  31-60  = warm / qualifiable (some signals, needs nurturing)
  61-85  = hot / should-prioritise (clear intent, good segment, responsive)
  86-100 = hot + urgent / founder-attention needed immediately

Scoring criteria (in descending weight):
1. Budget capacity hints — larger kWp estimate, commercial/industrial segment, references budget in notes → higher
2. Urgency keywords — "urgent", "TNEB deadline", "EMI", "subsidy ending", "ready to sign" → +10-20
3. Segment fit — industrial > commercial > residential (higher commercial willingness to pay)
4. Location proximity — Chennai → 85+ base; rest of Tamil Nadu → 65+; other states → 50 base
5. Engagement history — multiple activities, call-backs, site visit → +10-15 each signal
6. Source quality — referral > builder_tie_up > channel_partner > website > cold_call > social_media
7. Red flags — "just enquiring", very small system (<3 kWp residential), multiple follow-up ignores → penalty

Return STRICT JSON only, no markdown:
{ "score": <integer 0-100>, "reason": "<string of ≤100 chars>" }`;

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * scoreLeadAi — score a single lead and persist to the DB.
 *
 * @param leadId - The UUID of the lead to score.
 * @returns LeadScoreResult or throws on unrecoverable error.
 */
export async function scoreLeadAi(leadId: string): Promise<LeadScoreResult> {
  const op = '[scoreLeadAi]';

  if (!leadId) throw new Error(`${op} leadId is required`);

  const admin = createAdminClient();

  // ── Step 1: Load the lead ──────────────────────────────────────────────────
  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, customer_name, city, state, segment, source, estimated_size_kwp, notes, status, created_at, last_contacted_at, next_followup_date')
    .eq('id', leadId)
    .maybeSingle();

  if (leadErr) {
    console.error(`${op} lead fetch failed`, { leadId, error: leadErr.message, timestamp: new Date().toISOString() });
    throw new Error(leadErr.message);
  }
  if (!lead) throw new Error(`${op} lead not found: ${leadId}`);

  // ── Step 2: Load recent activities (last 10) ──────────────────────────────
  const { data: activities, error: actErr } = await admin
    .from('lead_activities')
    .select('activity_type, summary, outcome, next_action, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (actErr) {
    console.error(`${op} activities fetch failed (non-fatal)`, { leadId, error: actErr.message, timestamp: new Date().toISOString() });
  }

  // ── Step 3: Load latest proposal (if any) ────────────────────────────────
  const { data: proposals, error: propErr } = await admin
    .from('proposals')
    .select('system_size_kwp, total_after_discount, status, is_budgetary')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (propErr) {
    console.error(`${op} proposal fetch failed (non-fatal)`, { leadId, error: propErr.message, timestamp: new Date().toISOString() });
  }

  const proposal = proposals?.[0] ?? null;

  // ── Step 4: Build user message ────────────────────────────────────────────
  const activitySummary = (activities ?? []).length === 0
    ? 'No activities recorded yet.'
    : (activities ?? []).map((a: Pick<LeadActivityRow, 'activity_type' | 'summary' | 'outcome' | 'next_action' | 'created_at'>) =>
        `- [${a.activity_type}] ${a.summary}${a.outcome ? ` | Outcome: ${a.outcome}` : ''}${a.next_action ? ` | Next: ${a.next_action}` : ''}`,
      ).join('\n');

  const proposalSummary = proposal
    ? `Proposal: ${proposal.is_budgetary ? 'Budgetary' : 'Detailed'}, status=${proposal.status}, size=${proposal.system_size_kwp ?? '?'}kWp, value=₹${proposal.total_after_discount ?? '?'}`
    : 'No proposal created yet.';

  const userMessage = [
    `Lead: ${lead.customer_name}`,
    `City: ${lead.city ?? 'Unknown'}${lead.state ? `, ${lead.state}` : ''}`,
    `Segment: ${lead.segment ?? 'unknown'} | Source: ${lead.source ?? 'unknown'}`,
    `Estimated system size: ${lead.estimated_size_kwp ?? 'not specified'} kWp`,
    `Current status: ${lead.status}`,
    `Notes: ${lead.notes?.trim() || 'None'}`,
    ``,
    `Activity history (most recent first):`,
    activitySummary,
    ``,
    proposalSummary,
    ``,
    `Score this lead.`,
  ].join('\n');

  // ── Step 5: Call AI (Haiku is sufficient for scoring) ─────────────────────
  const fullPrompt = `${SCORER_SYSTEM_PROMPT}\n\n${userMessage}`;

  let rawText: string;
  try {
    rawText = await callAi(fullPrompt, { maxTokens: 150 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} AI call failed`, { leadId, error: msg, timestamp: new Date().toISOString() });
    throw new Error(`AI scoring failed: ${msg}`);
  }

  // ── Step 6: Parse + clamp ─────────────────────────────────────────────────
  let score: number;
  let reason: string;

  try {
    // Strip any markdown code fences the model may add despite instructions
    const cleaned = rawText.replace(/```json?|```/g, '').trim();
    const parsed: { score: number; reason: string } = JSON.parse(cleaned);
    score = Math.min(100, Math.max(0, Math.round(parsed.score)));
    reason = String(parsed.reason ?? '').slice(0, 100);
  } catch (e) {
    console.error(`${op} JSON parse failed`, { leadId, rawText: rawText.slice(0, 200), timestamp: new Date().toISOString() });
    // Fallback: extract first number from text as score, use raw text as reason
    const numMatch = rawText.match(/\d+/);
    score = numMatch ? Math.min(100, Math.max(0, parseInt(numMatch[0], 10))) : 50;
    reason = rawText.slice(0, 100);
  }

  // ── Step 7: Persist to leads row ──────────────────────────────────────────
  const { error: updateErr } = await admin
    .from('leads')
    .update({
      ai_score: score,
      ai_score_reason: reason,
      ai_scored_at: new Date().toISOString(),
      ai_scored_model: process.env.AI_MODEL ?? 'claude-sonnet-4-20250514',
    })
    .eq('id', leadId);

  if (updateErr) {
    console.error(`${op} leads update failed`, { leadId, error: updateErr.message, timestamp: new Date().toISOString() });
    throw new Error(updateErr.message);
  }

  console.log(`${op} scored`, { leadId, score, reason, timestamp: new Date().toISOString() });

  // ── Step 8: Emit event (fire-and-forget) ──────────────────────────────────
  void emitErpEvent('lead.scored', {
    lead_id: leadId,
    score,
    reason,
    scored_at: new Date().toISOString(),
  });

  // Token tracking: callAi doesn't expose token counts, return 0 as placeholder.
  // If needed, switch to the raw Anthropic SDK call to get usage.tokens.
  return { score, reason, tokens: 0 };
}
