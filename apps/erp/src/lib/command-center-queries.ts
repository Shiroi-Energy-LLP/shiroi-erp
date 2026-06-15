import { createClient } from '@repo/supabase/server';

/**
 * Reads for the /command-center (year-wise project overview). Year + money
 * aggregation comes from the get_dashboard_year_summary() SQL RPC (NEVER-DO #12).
 */

export interface YearSummaryRow {
  yearBucket: string;
  projectCount: number;
  completedCount: number;
  totalContracted: number;
  totalCostErp: number;
  avgMarginPct: number | null;
}

export interface CommandCenterData {
  years: YearSummaryRow[];
  total: YearSummaryRow | null;
  needsReview: number;
}

const YEAR_ORDER = ['<=2021', '2022', '2023', '2024', '2025', '2026', '2027', 'unknown'];

function sortKey(bucket: string): number {
  const i = YEAR_ORDER.indexOf(bucket);
  return i === -1 ? 999 : i;
}

export async function getCommandCenterData(): Promise<CommandCenterData> {
  const op = '[getCommandCenterData]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_dashboard_year_summary');
  if (error) {
    console.error(`${op} rpc failed:`, { code: error.code, message: error.message });
    return { years: [], total: null, needsReview: 0 };
  }

  const rows: YearSummaryRow[] = (data ?? []).map((r) => ({
    yearBucket: r.year_bucket ?? 'unknown',
    projectCount: Number(r.project_count ?? 0),
    completedCount: Number(r.completed_count ?? 0),
    totalContracted: Number(r.total_contracted ?? 0),
    totalCostErp: Number(r.total_cost_erp ?? 0),
    avgMarginPct: r.avg_margin_pct == null ? null : Number(r.avg_margin_pct),
  }));

  const total = rows.find((r) => r.yearBucket === 'TOTAL') ?? null;
  const years = rows
    .filter((r) => r.yearBucket !== 'TOTAL')
    .sort((a, b) => sortKey(a.yearBucket) - sortKey(b.yearBucket));

  const { count } = await supabase
    .from('project_reconciliation')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'proposed')
    .in('match_method', ['ambiguous', 'likely']);

  return { years, total, needsReview: count ?? 0 };
}
