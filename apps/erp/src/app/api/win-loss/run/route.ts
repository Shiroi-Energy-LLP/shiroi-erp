/**
 * POST /api/win-loss/run
 *
 * C2 — weekly win/loss pattern analysis endpoint.
 *
 * Called from:
 *   - n8n workflow 68 (Sunday 23:00 IST cron) — 4x per week-end: overall + each segment
 *   - Manual "Run analysis now" button is handled via server action (win-loss-actions.ts)
 *
 * Auth: x-webhook-secret header (same pattern as /api/leads/score).
 *
 * Body: { period_start?: string, period_end?: string, segment?: string | null }
 * Defaults: previous Monday–Sunday if period not given; segment null = all.
 *
 * Response: { id, period_start, period_end, segment, total_leads_won, total_leads_lost, skipped }
 */

import { NextResponse, type NextRequest } from 'next/server';
import { analyseWinLossWeek } from '@/lib/ai/win-loss-analyser';

export async function POST(request: NextRequest) {
  const op = '[POST /api/win-loss/run]';

  // ── Auth ──────────────────────────────────────────────────────────────────
  const incomingSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    console.error(`${op} unauthorized`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let periodStart: string | undefined;
  let periodEnd: string | undefined;
  let segment: string | null = null;

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    periodStart = typeof body?.period_start === 'string' ? body.period_start : undefined;
    periodEnd = typeof body?.period_end === 'string' ? body.period_end : undefined;
    segment = typeof body?.segment === 'string' ? body.segment : null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Default: previous Monday–Sunday ──────────────────────────────────────
  if (!periodStart || !periodEnd) {
    const now = new Date();
    // Get last Sunday (day 0). If today is Sunday, go back 7 days.
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - daysToLastSunday);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);

    periodStart = lastMonday.toISOString().split('T')[0]!;
    periodEnd = lastSunday.toISOString().split('T')[0]!;
  }

  // ── Run analysis ──────────────────────────────────────────────────────────
  const result = await analyseWinLossWeek({ periodStart, periodEnd, segment });

  if (!result.success) {
    console.error(`${op} analysis failed`, { error: result.error, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.data);
}

export const dynamic = 'force-dynamic';
