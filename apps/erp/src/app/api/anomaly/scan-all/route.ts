/**
 * POST /api/anomaly/scan-all
 *
 * S15 — B3 Plant Performance Anomaly Alerts
 *
 * Triggers the full anomaly detection + narration run across all active
 * commissioned projects. Called daily at 06:00 IST by n8n workflow 69.
 *
 * Auth: x-webhook-secret header (same pattern as all other cron routes).
 *
 * Body: none (no parameters needed)
 * Response 200: OrchestratorResult summary
 * Response 401: missing / wrong secret
 * Response 500: orchestrator threw unexpectedly
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runAnomalyDetectionForAllActiveProjects } from '@/lib/ai/anomaly-orchestrator';

export async function POST(request: NextRequest) {
  const op = '[POST /api/anomaly/scan-all]';

  // ── Auth ──────────────────────────────────────────────────────────────────
  const incomingSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    console.error(`${op} unauthorized`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  console.log(`${op} starting anomaly scan`, { timestamp: new Date().toISOString() });

  try {
    const summary = await runAnomalyDetectionForAllActiveProjects();

    console.log(`${op} done`, {
      ...summary,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(summary, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} orchestrator threw`, { error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
