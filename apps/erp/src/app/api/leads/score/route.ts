/**
 * POST /api/leads/score
 *
 * C1 — AI lead scoring endpoint. Called fire-and-forget from:
 *   - lead-form.tsx  (on INSERT, after the Supabase insert succeeds)
 *   - status-change.tsx (on status update)
 *
 * Auth: x-webhook-secret header (same pattern as all other internal cron/trigger routes).
 *
 * Body: { lead_id: string }
 * Response: { lead_id, score, reason }
 */

import { NextResponse, type NextRequest } from 'next/server';
import { scoreLeadAi } from '@/lib/ai/lead-scorer';

export async function POST(request: NextRequest) {
  const op = '[POST /api/leads/score]';

  // ── Auth ──────────────────────────────────────────────────────────────────
  const incomingSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    console.error(`${op} unauthorized`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let leadId: string | undefined;
  try {
    const body = await request.json();
    leadId = typeof body?.lead_id === 'string' ? body.lead_id : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!leadId) {
    return NextResponse.json({ error: 'lead_id is required' }, { status: 400 });
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  try {
    const result = await scoreLeadAi(leadId);
    return NextResponse.json({
      lead_id: leadId,
      score: result.score,
      reason: result.reason,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} scoring failed`, { leadId, error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
