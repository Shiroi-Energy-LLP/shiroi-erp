/**
 * Cached dashboard queries — wraps the expensive aggregation RPCs in
 * Next.js `unstable_cache` so repeated founder/leads/finance dashboard
 * loads within the TTL window are served from the Next.js data cache
 * instead of hitting Postgres.
 *
 * Why admin client? `unstable_cache` cannot wrap functions that read
 * cookies, and the Supabase server client reads cookies to attach the
 * user's auth. The admin client skips that entirely — safe here because
 * every function in this file calls an aggregation RPC that returns
 * *only* company-level totals, never row-level data that could leak
 * across users. If you add a query that returns row-level data scoped
 * to a user, it MUST NOT live in this file.
 *
 * Cache invalidation: pass `tags: [...]` to unstable_cache so that
 * server actions that mutate the underlying tables can call
 * `revalidateTag(...)` to nuke the cached value. Tags are listed on
 * each wrapper. If you add a new mutation path, invalidate the tag.
 */
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@repo/supabase/admin';

// ═══════════════════════════════════════════════════════════════════════
// Tags — exported so mutation code paths can revalidate.
// ═══════════════════════════════════════════════════════════════════════

export const DASHBOARD_TAGS = {
  pipeline: 'dashboard:pipeline',
  cashSummary: 'dashboard:cash-summary',
  amcMonthly: 'dashboard:amc-monthly',
  missingReports: 'dashboard:missing-reports',
  leadStages: 'dashboard:lead-stages',
} as const;

// ═══════════════════════════════════════════════════════════════════════
// getCachedPipelineSummary
//   TTL 300s (5 min) — proposals move frequently during sales hours.
// ═══════════════════════════════════════════════════════════════════════

export const getCachedPipelineSummary = unstable_cache(
  async (): Promise<{ count: number; totalValue: number }> => {
    const op = '[getCachedPipelineSummary]';
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_pipeline_summary');
    if (error) {
      console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
      return { count: 0, totalValue: 0 };
    }
    const row = data?.[0];
    return {
      count: Number(row?.proposal_count ?? 0),
      totalValue: Number(row?.total_value ?? 0),
    };
  },
  ['get-cached-pipeline-summary'],
  { tags: [DASHBOARD_TAGS.pipeline], revalidate: 300 },
);

// ═══════════════════════════════════════════════════════════════════════
// getCachedCompanyCashSummary
//   TTL 600s (10 min) — cash positions recompute on every payment
//   via trigger but the dashboard card is tolerant of a 10-min lag.
// ═══════════════════════════════════════════════════════════════════════

export const getCachedCompanyCashSummary = unstable_cache(
  async (): Promise<{
    totalInvestedCapital: string;
    totalReceivables: string;
    activePoValue: string;
    projectCount: number;
    investedProjectCount: number;
  }> => {
    const op = '[getCachedCompanyCashSummary]';
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_company_cash_summary');
    if (error) {
      console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
      return {
        totalInvestedCapital: '0',
        totalReceivables: '0',
        activePoValue: '0',
        projectCount: 0,
        investedProjectCount: 0,
      };
    }
    const row = data?.[0];
    return {
      totalInvestedCapital: String(row?.total_invested ?? 0),
      totalReceivables: String(row?.total_receivables ?? 0),
      activePoValue: String(row?.active_po_value ?? 0),
      projectCount: Number(row?.project_count ?? 0),
      investedProjectCount: Number(row?.invested_count ?? 0),
    };
  },
  ['get-cached-company-cash-summary'],
  { tags: [DASHBOARD_TAGS.cashSummary], revalidate: 600 },
);

// ═══════════════════════════════════════════════════════════════════════
// getCachedAmcMonthlySummary
//   TTL 900s (15 min) — AMC visits change a few times a day, not
//   every minute. A bit of staleness is acceptable.
// ═══════════════════════════════════════════════════════════════════════

export const getCachedAmcMonthlySummary = unstable_cache(
  async (): Promise<{ scheduled: number; completed: number }> => {
    const op = '[getCachedAmcMonthlySummary]';
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_amc_monthly_summary');
    if (error) {
      console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
      return { scheduled: 0, completed: 0 };
    }
    const row = data?.[0];
    return {
      scheduled: Number(row?.scheduled_count ?? 0),
      completed: Number(row?.completed_count ?? 0),
    };
  },
  ['get-cached-amc-monthly-summary'],
  { tags: [DASHBOARD_TAGS.amcMonthly], revalidate: 900 },
);

// ═══════════════════════════════════════════════════════════════════════
// getCachedProjectsWithoutTodayReport
//   TTL 180s (3 min) — critical signal, needs to update within a few
//   minutes of a supervisor submitting their first report of the day.
// ═══════════════════════════════════════════════════════════════════════

export interface ProjectMissingReport {
  id: string;
  project_number: string;
  customer_name: string;
  status: string;
}

export const getCachedProjectsWithoutTodayReport = unstable_cache(
  async (): Promise<ProjectMissingReport[]> => {
    const op = '[getCachedProjectsWithoutTodayReport]';
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_projects_without_today_report');
    if (error) {
      console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
      return [];
    }
    return (data ?? []).map((r) => ({
      id: r.project_id,
      project_number: r.project_number,
      customer_name: r.customer_name,
      status: r.status,
    }));
  },
  ['get-cached-projects-without-today-report'],
  { tags: [DASHBOARD_TAGS.missingReports], revalidate: 180 },
);

// ═══════════════════════════════════════════════════════════════════════
// getCachedLeadStageCounts
//   TTL 300s (5 min) — leads pipeline changes throughout sales day.
//   Accepts p_include_archived so the hook can be reused from both
//   the stage-nav (exclude archived) and the "all leads" view.
// ═══════════════════════════════════════════════════════════════════════

type LeadStageRow = {
  status: string;
  lead_count: number;
  total_value: number;
  weighted_value: number;
};

export const getCachedLeadStageCounts = unstable_cache(
  async (includeArchived: boolean): Promise<LeadStageRow[]> => {
    const op = '[getCachedLeadStageCounts]';
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_lead_stage_counts', {
      p_include_archived: includeArchived,
    });
    if (error) {
      console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
      return [];
    }
    return (data ?? []).map((r) => ({
      status: String(r.status),
      lead_count: Number(r.lead_count),
      total_value: Number(r.total_value),
      weighted_value: Number(r.weighted_value),
    }));
  },
  ['get-cached-lead-stage-counts'],
  { tags: [DASHBOARD_TAGS.leadStages], revalidate: 300 },
);
