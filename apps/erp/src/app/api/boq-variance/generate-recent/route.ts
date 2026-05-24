// apps/erp/src/app/api/boq-variance/generate-recent/route.ts
/**
 * S5 — F7 BOQ Variance Narrative — Nightly cron endpoint
 *
 * Called by n8n workflow 67-boq-variance-narrative-cron.json at 03:00 IST.
 * Processes up to 10 completed projects per run that:
 *   - have status = 'completed'
 *   - actual_end_date within the last 30 days
 *   - boq_variance_narrative IS NULL
 *
 * Auth: validated via x-webhook-secret header.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import { generateBoqVarianceNarrative } from '@/lib/ai/boq-variance-narrative';

const BATCH_LIMIT = 10;
const LOOKBACK_DAYS = 30;

export async function POST(request: NextRequest) {
  const op = '[POST /api/boq-variance/generate-recent]';

  // 1. Validate webhook secret
  const incomingSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    console.error(`${op} unauthorized — invalid webhook secret`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2. Find eligible projects
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
  const lookbackISO = lookbackDate.toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: projects, error: fetchErr } = await admin
    .from('projects')
    .select('id, project_number')
    .eq('status', 'completed')
    .gte('actual_end_date', lookbackISO)
    .is('boq_variance_narrative', null)
    .is('deleted_at', null)
    .limit(BATCH_LIMIT);

  if (fetchErr) {
    console.error(`${op} project fetch failed`, { error: fetchErr.message, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!projects || projects.length === 0) {
    console.log(`${op} no eligible projects found`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  }

  // 3. Process each project
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const results: Array<{ projectId: string; projectNumber: string; status: 'ok' | 'skipped' | 'error'; reason?: string }> = [];

  for (const project of projects) {
    const result = await generateBoqVarianceNarrative(project.id);

    if (!result.success) {
      // "No variance data" is a skip, not a failure
      if (result.error.includes('No variance data')) {
        skipped++;
        results.push({ projectId: project.id, projectNumber: project.project_number, status: 'skipped', reason: result.error });
      } else {
        failed++;
        results.push({ projectId: project.id, projectNumber: project.project_number, status: 'error', reason: result.error });
      }
    } else {
      succeeded++;
      results.push({ projectId: project.id, projectNumber: project.project_number, status: 'ok' });
    }
  }

  console.log(`${op} batch complete`, {
    processed: projects.length,
    succeeded,
    failed,
    skipped,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    processed: projects.length,
    succeeded,
    failed,
    skipped,
    results,
  });
}
