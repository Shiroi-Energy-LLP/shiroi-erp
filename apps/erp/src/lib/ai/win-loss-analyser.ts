'use server';

/**
 * win-loss-analyser.ts — C2 weekly win/loss pattern analysis.
 *
 * Analyses won/lost leads for a given week + segment and generates:
 *   - ai_narrative: 3 paragraphs (what's winning, what's losing, recommendations)
 *   - ai_pricing_insight: 1 paragraph on pricing patterns
 *   - top_loss_reasons: top 5 disqualification_reason groups with counts
 *   - similar_won_examples: up to 5 RAG-retrieved similar past won deals
 *
 * Inserts into lead_win_loss_patterns. Idempotent: skips if already analysed
 * for the same period_start + period_end + segment combination.
 *
 * Called:
 *   - Weekly Sunday 23:00 IST via n8n cron (workflow 68)
 *   - On demand via POST /api/win-loss/run or the manual "Run analysis now" button
 */

import Decimal from 'decimal.js';
import { createAdminClient } from '@repo/supabase/admin';
import { callAi } from './ai-caller';
import { retrieve } from '@/lib/rag/retrieve';
import { emitErpEvent, type ErpEventName } from '@/lib/n8n/emit';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerSegment = Database['public']['Enums']['customer_segment'];
type LeadRow = Database['public']['Tables']['leads']['Row'];
type ProposalRow = Database['public']['Tables']['proposals']['Row'];

// Only the columns we need for the analysis
type LeadAnalysisRow = Pick<
  LeadRow,
  'id' | 'customer_name' | 'city' | 'segment' | 'status' | 'estimated_size_kwp' | 'disqualification_reason'
>;

type ProposalAnalysisRow = Pick<ProposalRow, 'lead_id' | 'total_after_discount' | 'system_size_kwp'>;

const VALID_SEGMENTS: CustomerSegment[] = ['residential', 'commercial', 'industrial'];

function toSegment(s: string | null | undefined): CustomerSegment | null {
  if (!s) return null;
  return VALID_SEGMENTS.includes(s as CustomerSegment) ? (s as CustomerSegment) : null;
}

export interface WinLossAnalysisParams {
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;   // 'YYYY-MM-DD'
  segment?: string | null; // 'residential' | 'commercial' | 'industrial' | null = all
}

export interface WinLossAnalysisResult {
  id: string;
  period_start: string;
  period_end: string;
  segment: string | null;
  total_leads_won: number;
  total_leads_lost: number;
  total_value_won: number;
  total_value_lost: number;
  skipped: boolean; // true if already analysed (idempotent skip)
}

// ── Loss reason group ─────────────────────────────────────────────────────────

interface LossReason {
  reason: string;
  count: number;
}

// ── Similar won example (from RAG) ───────────────────────────────────────────

interface SimilarWonExample {
  source_path: string;
  source_id: string | null;
  content_excerpt: string; // first 200 chars of the chunk
  similarity: number;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const ANALYSER_SYSTEM_PROMPT = `You are a senior business analyst for Shiroi Energy LLP, a solar EPC company in Chennai, India.
Analyse the week's won and lost solar leads and produce a structured JSON report.

Return STRICT JSON only, no markdown fences:
{
  "ai_narrative": "<3 paragraphs separated by \\n\\n: (1) what is working and driving wins, (2) what is causing losses and the pattern you see, (3) 2-3 actionable recommendations for the next week>",
  "ai_pricing_insight": "<1 paragraph describing pricing patterns: average deal size for wins vs losses, price sensitivity signals, any discount patterns you observe>"
}

Guidelines:
- Be specific and data-driven. Quote segment names, numbers, and loss reasons from the data.
- Use Indian business context: TNEB, net metering, MNRE subsidy, rooftop solar economics.
- ai_narrative must be exactly 3 paragraphs (not bullet points). Each paragraph 60-120 words.
- ai_pricing_insight is 1 paragraph, 50-80 words.
- No markdown, no HTML, plain text only inside the JSON strings.`;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * analyseWinLossWeek — run win/loss analysis for a week + segment and persist.
 *
 * Idempotent: if a row already exists for the same period + segment, returns
 * early with skipped: true.
 */
export async function analyseWinLossWeek(
  params: WinLossAnalysisParams,
): Promise<ActionResult<WinLossAnalysisResult>> {
  const op = '[analyseWinLossWeek]';
  const { periodStart, periodEnd } = params;
  const segment = toSegment(params.segment);

  if (!periodStart || !periodEnd) {
    return err(`${op} periodStart and periodEnd are required`);
  }

  const admin = createAdminClient();

  // ── Step 1: Idempotency check ─────────────────────────────────────────────
  const idempotencyQuery = admin
    .from('lead_win_loss_patterns')
    .select('id, period_start, period_end, segment, total_leads_won, total_leads_lost, total_value_won, total_value_lost')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd);

  if (segment) {
    idempotencyQuery.eq('segment', segment);
  } else {
    idempotencyQuery.is('segment', null);
  }

  const { data: existing, error: existErr } = await idempotencyQuery.maybeSingle();

  if (existErr) {
    console.error(`${op} idempotency check failed`, { error: existErr.message, timestamp: new Date().toISOString() });
    return err(existErr.message, existErr.code);
  }

  if (existing) {
    console.log(`${op} already analysed — skipping`, { id: existing.id, periodStart, periodEnd, segment, timestamp: new Date().toISOString() });
    return ok({
      id: existing.id,
      period_start: existing.period_start,
      period_end: existing.period_end,
      segment: existing.segment,
      total_leads_won: existing.total_leads_won,
      total_leads_lost: existing.total_leads_lost,
      total_value_won: Number(existing.total_value_won),
      total_value_lost: Number(existing.total_value_lost),
      skipped: true,
    });
  }

  // ── Step 2: Load won leads in period ─────────────────────────────────────
  const wonQuery = admin
    .from('leads')
    .select('id, customer_name, city, segment, status, estimated_size_kwp, disqualification_reason')
    .eq('status', 'won')
    .gte('status_updated_at', `${periodStart}T00:00:00Z`)
    .lte('status_updated_at', `${periodEnd}T23:59:59Z`);

  if (segment) wonQuery.eq('segment', segment);

  const { data: wonLeads, error: wonErr } = await wonQuery;

  if (wonErr) {
    console.error(`${op} won leads fetch failed`, { error: wonErr.message, timestamp: new Date().toISOString() });
    return err(wonErr.message, wonErr.code);
  }

  // ── Step 3: Load lost leads in period ────────────────────────────────────
  const lostQuery = admin
    .from('leads')
    .select('id, customer_name, city, segment, status, estimated_size_kwp, disqualification_reason')
    .eq('status', 'lost')
    .gte('status_updated_at', `${periodStart}T00:00:00Z`)
    .lte('status_updated_at', `${periodEnd}T23:59:59Z`);

  if (segment) lostQuery.eq('segment', segment);

  const { data: lostLeads, error: lostErr } = await lostQuery;

  if (lostErr) {
    console.error(`${op} lost leads fetch failed`, { error: lostErr.message, timestamp: new Date().toISOString() });
    return err(lostErr.message, lostErr.code);
  }

  const wonLeadsSafe: LeadAnalysisRow[] = wonLeads ?? [];
  const lostLeadsSafe: LeadAnalysisRow[] = lostLeads ?? [];

  const totalLeadsWon = wonLeadsSafe.length;
  const totalLeadsLost = lostLeadsSafe.length;

  // ── Step 4: Load proposals for won leads to get total value ───────────────
  // Fetch latest proposal per won lead, then aggregate with decimal.js.
  let totalValueWon = new Decimal(0);
  let totalValueLost = new Decimal(0);

  if (wonLeadsSafe.length > 0) {
    const wonIds = wonLeadsSafe.map((l) => l.id);
    const { data: wonProposals, error: wpErr } = await admin
      .from('proposals')
      .select('lead_id, total_after_discount, system_size_kwp')
      .in('lead_id', wonIds)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false });

    if (wpErr) {
      console.error(`${op} won proposals fetch failed (non-fatal)`, { error: wpErr.message, timestamp: new Date().toISOString() });
    }

    if (wonProposals && wonProposals.length > 0) {
      // Take the latest accepted proposal per lead (already ordered desc)
      const seenLeads = new Set<string>();
      for (const p of wonProposals as ProposalAnalysisRow[]) {
        if (!seenLeads.has(p.lead_id)) {
          seenLeads.add(p.lead_id);
          totalValueWon = totalValueWon.plus(new Decimal(p.total_after_discount ?? 0));
        }
      }
    }
  }

  if (lostLeadsSafe.length > 0) {
    const lostIds = lostLeadsSafe.map((l) => l.id);
    const { data: lostProposals, error: lpErr } = await admin
      .from('proposals')
      .select('lead_id, total_after_discount, system_size_kwp')
      .in('lead_id', lostIds)
      .order('created_at', { ascending: false });

    if (lpErr) {
      console.error(`${op} lost proposals fetch failed (non-fatal)`, { error: lpErr.message, timestamp: new Date().toISOString() });
    }

    if (lostProposals && lostProposals.length > 0) {
      // Take latest proposal per lead
      const seenLeads = new Set<string>();
      for (const p of lostProposals as ProposalAnalysisRow[]) {
        if (!seenLeads.has(p.lead_id)) {
          seenLeads.add(p.lead_id);
          totalValueLost = totalValueLost.plus(new Decimal(p.total_after_discount ?? 0));
        }
      }
    }
  }

  // ── Step 5: Top 5 loss reasons ────────────────────────────────────────────
  const reasonCounts = new Map<string, number>();
  for (const lead of lostLeadsSafe) {
    const reason = lead.disqualification_reason?.trim() || 'Unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const topLossReasons: LossReason[] = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // ── Step 6: RAG retrieval for similar won deals ───────────────────────────
  const similarWonExamples: SimilarWonExample[] = [];

  if (wonLeadsSafe.length > 0) {
    // Build RAG query from won leads: take up to 5 won leads, query each,
    // collect unique top results, deduplicate by source_path.
    const seenPaths = new Set<string>();
    const leadsToQuery = wonLeadsSafe.slice(0, 5);

    for (const lead of leadsToQuery) {
      const segLabel = lead.segment ?? segment ?? 'solar';
      const city = lead.city ?? 'Chennai';
      const kwp = lead.estimated_size_kwp ? `${lead.estimated_size_kwp}kWp` : '';
      const query = `${segLabel} ${city} ${kwp} won deal proposal`.trim();

      try {
        const chunks = await retrieve(query, {
          top_k: 3,
          source_types: ['proposal'],
          min_similarity: 0.4,
        });

        for (const chunk of chunks) {
          if (similarWonExamples.length >= 5) break;
          if (!seenPaths.has(chunk.source_path)) {
            seenPaths.add(chunk.source_path);
            similarWonExamples.push({
              source_path: chunk.source_path,
              source_id: chunk.source_id,
              content_excerpt: chunk.content.slice(0, 200),
              similarity: chunk.similarity,
            });
          }
        }
      } catch (ragErr) {
        // RAG retrieval is best-effort; don't fail the whole analysis
        console.error(`${op} RAG retrieve failed (non-fatal)`, {
          query,
          error: ragErr instanceof Error ? ragErr.message : String(ragErr),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // ── Step 7: Build AI prompt ───────────────────────────────────────────────
  const winRate = totalLeadsWon + totalLeadsLost > 0
    ? `${Math.round((totalLeadsWon / (totalLeadsWon + totalLeadsLost)) * 100)}%`
    : 'N/A';

  const wonSummary = wonLeadsSafe.length === 0
    ? 'No leads won this week.'
    : wonLeadsSafe.map((l) =>
        `- ${l.customer_name} | ${l.segment ?? 'unknown'} | ${l.city ?? '?'} | ${l.estimated_size_kwp ?? '?'}kWp`,
      ).join('\n');

  const lostSummary = lostLeadsSafe.length === 0
    ? 'No leads lost this week.'
    : lostLeadsSafe.map((l) =>
        `- ${l.customer_name} | ${l.segment ?? 'unknown'} | ${l.city ?? '?'} | ${l.estimated_size_kwp ?? '?'}kWp | Loss reason: ${l.disqualification_reason ?? 'not recorded'}`,
      ).join('\n');

  const lossReasonsSummary = topLossReasons.length === 0
    ? 'No loss reasons recorded.'
    : topLossReasons.map((r) => `  ${r.count}x "${r.reason}"`).join('\n');

  const totalValueWonFinal = totalValueWon.toNumber();
  const totalValueLostFinal = totalValueLost.toNumber();

  const avgWonSize = totalLeadsWon > 0
    ? `₹${Math.round(totalValueWonFinal / totalLeadsWon).toLocaleString('en-IN')}`
    : 'N/A';
  const avgLostSize = totalLeadsLost > 0
    ? `₹${Math.round(totalValueLostFinal / totalLeadsLost).toLocaleString('en-IN')}`
    : 'N/A';

  const userMessage = [
    `Week: ${periodStart} to ${periodEnd}`,
    segment ? `Segment filter: ${segment}` : 'Segment filter: all (residential + commercial + industrial)',
    ``,
    `PERFORMANCE SUMMARY`,
    `  Leads won:  ${totalLeadsWon} (total value: ₹${totalValueWonFinal.toLocaleString('en-IN')})`,
    `  Leads lost: ${totalLeadsLost} (total value: ₹${totalValueLostFinal.toLocaleString('en-IN')})`,
    `  Win rate:   ${winRate}`,
    `  Avg deal size won:  ${avgWonSize}`,
    `  Avg deal size lost: ${avgLostSize}`,
    ``,
    `WON LEADS`,
    wonSummary,
    ``,
    `LOST LEADS`,
    lostSummary,
    ``,
    `TOP LOSS REASONS (grouped)`,
    lossReasonsSummary,
    ``,
    `Similar past won deals retrieved from knowledge base:`,
    similarWonExamples.length === 0
      ? '  None retrieved (RAG corpus may be empty).'
      : similarWonExamples.map((e, i) => `  ${i + 1}. ${e.source_path} — "${e.content_excerpt.slice(0, 120)}..."`).join('\n'),
    ``,
    `Analyse this week's win/loss pattern and return the JSON report.`,
  ].join('\n');

  const fullPrompt = `${ANALYSER_SYSTEM_PROMPT}\n\n${userMessage}`;

  // ── Step 8: Call AI ───────────────────────────────────────────────────────
  let aiNarrative = 'Analysis unavailable.';
  let aiPricingInsight: string | null = null;
  const aiTokensUsed = 0;

  const aiModel = process.env.AI_MODEL ?? 'claude-haiku-4-5-20250514';

  try {
    const rawText = await callAi(fullPrompt, { maxTokens: 800, model: aiModel });

    try {
      const cleaned = rawText.replace(/```json?|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { ai_narrative?: string; ai_pricing_insight?: string };
      aiNarrative = typeof parsed.ai_narrative === 'string' ? parsed.ai_narrative.trim() : aiNarrative;
      aiPricingInsight = typeof parsed.ai_pricing_insight === 'string' ? parsed.ai_pricing_insight.trim() : null;
    } catch {
      // If parsing fails, use raw text as narrative
      aiNarrative = rawText.slice(0, 1500);
    }
  } catch (aiErr) {
    const msg = aiErr instanceof Error ? aiErr.message : String(aiErr);
    console.error(`${op} AI call failed (non-fatal — inserting with placeholder)`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
    aiNarrative = `AI analysis unavailable for ${periodStart}–${periodEnd}. Wins: ${totalLeadsWon}, Losses: ${totalLeadsLost}.`;
  }

  // ── Step 9: Insert into lead_win_loss_patterns ────────────────────────────
  const insertRow: Database['public']['Tables']['lead_win_loss_patterns']['Insert'] = {
    id: crypto.randomUUID(),
    period_start: periodStart,
    period_end: periodEnd,
    segment: segment ?? null,
    total_leads_won: totalLeadsWon,
    total_leads_lost: totalLeadsLost,
    total_value_won: totalValueWon.toFixed(2) as unknown as number,
    total_value_lost: totalValueLost.toFixed(2) as unknown as number,
    ai_narrative: aiNarrative,
    ai_pricing_insight: aiPricingInsight,
    top_loss_reasons: topLossReasons as unknown as Database['public']['Tables']['lead_win_loss_patterns']['Insert']['top_loss_reasons'],
    similar_won_examples: similarWonExamples as unknown as Database['public']['Tables']['lead_win_loss_patterns']['Insert']['similar_won_examples'],
    ai_tokens_used: aiTokensUsed,
    ai_model: aiModel,
  };

  const { data: inserted, error: insertErr } = await admin
    .from('lead_win_loss_patterns')
    .insert(insertRow)
    .select('id, period_start, period_end, segment, total_leads_won, total_leads_lost, total_value_won, total_value_lost')
    .single();

  if (insertErr) {
    console.error(`${op} insert failed`, { error: insertErr.message, timestamp: new Date().toISOString() });
    return err(insertErr.message, insertErr.code);
  }
  if (!inserted) {
    return err(`${op} insert returned no data`);
  }

  console.log(`${op} completed`, {
    id: inserted.id,
    periodStart,
    periodEnd,
    segment,
    totalLeadsWon,
    totalLeadsLost,
    timestamp: new Date().toISOString(),
  });

  // ── Step 10: Emit event (fire-and-forget) ─────────────────────────────────
  const WIN_LOSS_EVENT: ErpEventName = 'lead.win_loss_analysed';
  void emitErpEvent(WIN_LOSS_EVENT, {
    id: inserted.id,
    period_start: periodStart,
    period_end: periodEnd,
    segment: segment ?? null,
    total_leads_won: totalLeadsWon,
    total_leads_lost: totalLeadsLost,
    analysed_at: new Date().toISOString(),
  });

  return ok({
    id: inserted.id,
    period_start: inserted.period_start,
    period_end: inserted.period_end,
    segment: inserted.segment,
    total_leads_won: inserted.total_leads_won,
    total_leads_lost: inserted.total_leads_lost,
    total_value_won: Number(inserted.total_value_won),
    total_value_lost: Number(inserted.total_value_lost),
    skipped: false,
  });
}
