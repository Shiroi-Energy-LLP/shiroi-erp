import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import type { Database } from '@repo/types/database';
import { getMonthlyPerfCohort, getMonthlyPerfKpis } from '@/lib/ai/monthly-perf-kpis';
import { narrateMonthlyPerf } from '@/lib/ai/monthly-perf-narrator';
import { emitErpEvent } from '@/lib/n8n/emit';
import { getAiConfig } from '@/lib/ai/ai-config';

// ── Types ─────────────────────────────────────────────────────────────────────

type MonthlyPerfInsert =
  Database['public']['Tables']['monthly_performance_reports']['Insert'];

interface RunBody {
  year?: number;
  month?: number;
  offset?: number;  // pagination offset — number of projects to skip
}

interface RunResult {
  year: number;
  month: number;
  cohort_size: number;
  processed: number;
  skipped: number;   // already upserted (idempotent) + errors
  errors: number;
  reports: Array<{
    project_id: string;
    project_number: string;
    actual_kwh: number;
    estimated_savings_inr: number;
    status: 'upserted' | 'error';
  }>;
}

/** Max projects per run — prevents runaway Haiku spend + Vercel timeout. */
const BATCH_SIZE = 50;

// ── IST helpers ───────────────────────────────────────────────────────────────

/** Returns { year, month } for the last completed calendar month in IST. */
function lastCompletedMonthIst(): { year: number; month: number } {
  const now = new Date();
  // Shift to IST (+5:30 = 330 min)
  now.setMinutes(now.getMinutes() + 330);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-indexed; subtract 1 from current month
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return { year, month };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const op = '[POST /api/monthly-perf/run]';

  // ── Auth: validate x-webhook-secret ─────────────────────────────────────
  const secret = req.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret || !secret || secret !== expectedSecret) {
    console.warn(`${op} unauthorized — secret mismatch`, {
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: RunBody = {};
  try {
    body = await req.json() as RunBody;
  } catch {
    // Body is optional — treat as empty
  }

  const { year, month } = body.year && body.month
    ? { year: body.year, month: body.month }
    : lastCompletedMonthIst();

  const offset = typeof body.offset === 'number' && body.offset >= 0
    ? body.offset
    : 0;

  // Validate
  if (month < 1 || month > 12 || year < 2020) {
    return NextResponse.json(
      { error: `invalid year/month: ${year}/${month}` },
      { status: 400 },
    );
  }

  console.log(`${op} starting`, { year, month, offset, timestamp: new Date().toISOString() });

  const admin = createAdminClient();
  const config = getAiConfig({ model: 'claude-haiku-4-5-20250514', maxTokens: 200 });

  const result: RunResult = {
    year,
    month,
    cohort_size: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    reports: [],
  };

  // ── Step 1: Get cohort ───────────────────────────────────────────────────
  let cohort: Awaited<ReturnType<typeof getMonthlyPerfCohort>>;
  try {
    cohort = await getMonthlyPerfCohort(year, month);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} cohort fetch failed`, { error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'cohort fetch failed', detail: msg }, { status: 500 });
  }

  result.cohort_size = cohort.length;
  console.log(`${op} cohort size`, { count: cohort.length, timestamp: new Date().toISOString() });

  if (cohort.length === 0) {
    return NextResponse.json({ ...result }, { status: 200 });
  }

  // Apply pagination offset + batch limit
  const batch = cohort.slice(offset, offset + BATCH_SIZE);

  // ── Step 2: Loop — gather KPIs → narrate → upsert → emit ─────────────────
  for (const project of batch) {
    const projectOp = `${op}[${project.project_number}]`;

    // ── KPIs ────────────────────────────────────────────────────────────────
    let kpis: Awaited<ReturnType<typeof getMonthlyPerfKpis>>;
    try {
      kpis = await getMonthlyPerfKpis(project.project_id, year, month);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${projectOp} KPI gather failed`, {
        error: msg,
        timestamp: new Date().toISOString(),
      });
      result.errors++;
      result.skipped++;
      result.reports.push({
        project_id: project.project_id,
        project_number: project.project_number,
        actual_kwh: 0,
        estimated_savings_inr: 0,
        status: 'error',
      });
      continue;
    }

    // ── Narration ────────────────────────────────────────────────────────────
    let narration: Awaited<ReturnType<typeof narrateMonthlyPerf>>;
    try {
      narration = await narrateMonthlyPerf(project, kpis, year, month);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${projectOp} narration failed`, {
        error: msg,
        timestamp: new Date().toISOString(),
      });
      // Non-fatal — upsert without narrative
      narration = { narrative: '', tokens_in: 0, tokens_out: 0 };
    }

    // ── Upsert to monthly_performance_reports ────────────────────────────────
    // UNIQUE (project_id, report_year, report_month) makes this idempotent.
    const upsertRow: MonthlyPerfInsert = {
      id: crypto.randomUUID(),
      project_id: project.project_id,
      report_year: year,
      report_month: month,
      actual_kwh_generated: kpis.actual_kwh,
      expected_kwh_pvlib: kpis.expected_kwh ?? null,
      variance_pct: kpis.variance_pct ?? null,
      top_generation_date: kpis.top_date ?? null,
      top_generation_kwh: kpis.top_kwh ?? null,
      estimated_savings_inr: kpis.estimated_savings_inr,
      ai_narrative: narration.narrative || null,
      ai_tokens_in: narration.tokens_in || null,
      ai_tokens_out: narration.tokens_out || null,
      ai_model: config.model,
      whatsapp_template: 'monthly_performance',
    };

    const { data: upserted, error: upsertErr } = await admin
      .from('monthly_performance_reports')
      .upsert(upsertRow, {
        onConflict: 'project_id,report_year,report_month',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();

    if (upsertErr) {
      console.error(`${projectOp} upsert failed`, {
        error: upsertErr.message,
        code: upsertErr.code,
        timestamp: new Date().toISOString(),
      });
      result.errors++;
      result.skipped++;
      result.reports.push({
        project_id: project.project_id,
        project_number: project.project_number,
        actual_kwh: kpis.actual_kwh,
        estimated_savings_inr: kpis.estimated_savings_inr,
        status: 'error',
      });
      continue;
    }

    // ── Emit event ───────────────────────────────────────────────────────────
    // Fire-and-forget — emit.ts has 3s timeout, never throws.
    await emitErpEvent('customer.monthly_performance_generated', {
      report_id: upserted?.id ?? null,
      project_id: project.project_id,
      project_number: project.project_number,
      customer_name: project.customer_name,
      customer_phone: project.customer_phone,
      system_size_kwp: project.system_size_kwp,
      site_city: project.site_city,
      year,
      month,
      actual_kwh: kpis.actual_kwh,
      expected_kwh: kpis.expected_kwh,
      variance_pct: kpis.variance_pct,
      top_date: kpis.top_date,
      top_kwh: kpis.top_kwh,
      estimated_savings_inr: kpis.estimated_savings_inr,
      ai_narrative: narration.narrative || null,
    });

    console.log(`${projectOp} done`, {
      report_id: upserted?.id,
      actual_kwh: kpis.actual_kwh,
      timestamp: new Date().toISOString(),
    });

    result.processed++;
    result.reports.push({
      project_id: project.project_id,
      project_number: project.project_number,
      actual_kwh: kpis.actual_kwh,
      estimated_savings_inr: kpis.estimated_savings_inr,
      status: 'upserted',
    });
  }

  console.log(`${op} complete`, {
    year,
    month,
    processed: result.processed,
    errors: result.errors,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ ...result }, { status: 200 });
}

export const dynamic = 'force-dynamic';
