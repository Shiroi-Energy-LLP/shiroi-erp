import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import { gatherBriefingKpis } from '@/lib/ai/briefing-kpis';
import { narrateBriefing } from '@/lib/ai/briefing-narrator';
import { getAiConfig } from '@/lib/ai/ai-config';
import { buildActionBlock } from '@/lib/ai/briefing-action-block';

// ── Types ─────────────────────────────────────────────────────────────────────

type RecipientRole = 'founder' | 'marketing_manager' | 'project_manager';

interface BriefingRunBody {
  recipient_role: RecipientRole;
  date?: string; // YYYY-MM-DD; defaults to yesterday IST
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns yesterday's YYYY-MM-DD in IST. */
function yesterdayIstDateString(): string {
  const now = new Date();
  // Shift to IST (+5:30 = 330 min), then subtract one day
  now.setMinutes(now.getMinutes() + 330 - 1440);
  return now.toISOString().slice(0, 10);
}

const VALID_ROLES: RecipientRole[] = ['founder', 'marketing_manager', 'project_manager'];

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const op = '[POST /api/briefing/run]';

  // ── Auth: webhook secret ─────────────────────────────────────────────────
  const secret = req.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret || !secret || secret !== expectedSecret) {
    console.warn(`${op} unauthorized — secret mismatch`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: BriefingRunBody;
  try {
    body = await req.json() as BriefingRunBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.recipient_role || !VALID_ROLES.includes(body.recipient_role)) {
    return NextResponse.json(
      { error: `recipient_role must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 },
    );
  }

  const role = body.recipient_role;
  const date = body.date ?? yesterdayIstDateString();
  const briefingOp = `${op}/${role}`;

  console.log(`${briefingOp} starting`, { date, timestamp: new Date().toISOString() });

  const admin = createAdminClient();

  // Deterministic action block (overdue deals, today's follow-ups, won MTD).
  // Computed fresh every call ("today" data); appended below the AI narrative by n8n.
  const actionBlock = await buildActionBlock();

  // ── Step 1: Check cache (idempotent) ─────────────────────────────────────
  const { data: existing, error: cacheError } = await admin
    .from('executive_briefing_log')
    .select('id, ai_narrative, kpi_snapshot, ai_tokens_in, ai_tokens_out, created_at')
    .eq('briefing_date', date)
    .eq('recipient_role', role)
    .maybeSingle();

  if (cacheError) {
    // Log but continue — don't fail on cache check error
    console.warn(`${briefingOp} cache check failed`, {
      error: cacheError.message,
      timestamp: new Date().toISOString(),
    });
  }

  if (existing && !cacheError) {
    console.log(`${briefingOp} returning cached briefing`, {
      id: existing.id,
      timestamp: new Date().toISOString(),
    });
    const snapshot = existing.kpi_snapshot as Record<string, unknown>;
    return NextResponse.json({
      cached: true,
      narrative: existing.ai_narrative,
      whatsapp_short: (snapshot?.whatsapp_short as string | undefined) ?? existing.ai_narrative.slice(0, 497) + '…',
      kpi_snapshot: snapshot,
      action_block: actionBlock.text,
    });
  }

  // ── Step 2: Gather KPIs ─────────────────────────────────────────────────
  let kpis: Awaited<ReturnType<typeof gatherBriefingKpis>>;
  try {
    kpis = await gatherBriefingKpis(date, role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${briefingOp} gatherBriefingKpis failed`, { error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'KPI gathering failed', detail: msg }, { status: 500 });
  }

  // ── Step 3: Generate narrative ──────────────────────────────────────────
  let briefing: Awaited<ReturnType<typeof narrateBriefing>>;
  try {
    briefing = await narrateBriefing(kpis);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${briefingOp} narrateBriefing failed`, { error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'AI narration failed', detail: msg }, { status: 500 });
  }

  // ── Step 4: Insert into executive_briefing_log ─────────────────────────
  const config = getAiConfig({ maxTokens: 1200 });
  const kpiSnapshot = {
    ...kpis,
    whatsapp_short: briefing.whatsapp_short,
  };

  const { data: inserted, error: insertError } = await admin
    .from('executive_briefing_log')
    .insert({
      id: crypto.randomUUID(),
      briefing_date: date,
      recipient_role: role,
      ai_narrative: briefing.narrative,
      ai_model: config.model,
      ai_tokens_in: briefing.tokens_in,
      ai_tokens_out: briefing.tokens_out,
      kpi_snapshot: kpiSnapshot,
    })
    .select('id')
    .single();

  if (insertError) {
    // Log but don't fail the response — the briefing was generated successfully
    console.error(`${briefingOp} failed to insert into executive_briefing_log`, {
      error: insertError.message,
      code: insertError.code,
      timestamp: new Date().toISOString(),
    });
  } else {
    console.log(`${briefingOp} inserted briefing log`, {
      id: inserted?.id,
      tokens_in: briefing.tokens_in,
      tokens_out: briefing.tokens_out,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Step 5: Return ─────────────────────────────────────────────────────
  return NextResponse.json({
    cached: false,
    narrative: briefing.narrative,
    whatsapp_short: briefing.whatsapp_short,
    kpi_snapshot: kpiSnapshot,
    action_block: actionBlock.text,
  });
}

export const dynamic = 'force-dynamic';
