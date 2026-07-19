import { createClient } from '@repo/supabase/server';

/**
 * Reads for the /reconciliation workspace. Joins project_reconciliation to its
 * ERP project + matched sheet row in JS by id (three plain typed selects — avoids
 * PostgREST embed-inference friction). Counts only here; money totals come from
 * SQL RPCs elsewhere (NEVER-DO #12).
 */

export type ReconMethod = 'auto' | 'likely' | 'ambiguous' | 'manual' | 'erp_only' | 'sheet_only';

export interface ReconViewRow {
  projectId: string;
  matchedSheetId: string | null;
  erpNumber: string | null;
  erpName: string;
  erpSize: number | null;
  erpStatus: string | null;
  erpOrderYear: number | null;
  matchMethod: ReconMethod | null;
  matchScore: number | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  resolvedYear: number | null;
  preferredSource: 'erp' | 'sheet';
  sheetName: string | null;
  sheetSize: number | null;
  sheetYear: number | null;
  sheetProjectCost: number | null;
  sheetActualCost: number | null;
  revenueErp: number | null;
  costErp: number | null;
  reviewedAt: string | null;
  valueFlag: boolean;
  yearFlag: boolean;
}

export interface ReconSummary {
  total: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  needsReview: number;
  confirmed: number;
  valueFlags: number;
  yearFlags: number;
  sheetOnly: number;
}

export interface ReconciliationData {
  rows: ReconViewRow[];
  summary: ReconSummary;
}

const VALUE_FLAG_PCT = 0.1; // >10% gap between sheet Project Cost and ERP contracted value

export async function getReconciliationData(): Promise<ReconciliationData> {
  const op = '[getReconciliationData]';
  const supabase = await createClient();

  const [reconRes, projRes, sheetRes] = await Promise.all([
    supabase
      .from('project_reconciliation')
      .select(
        'project_id, matched_sheet_id, match_method, match_score, status, resolved_year, sheet_project_cost, sheet_actual_cost, revenue_erp, cost_erp, preferred_source, reviewed_at',
      ),
    supabase
      .from('projects')
      .select('id, project_number, customer_name, project_name, system_size_kwp, status, order_date')
      .is('deleted_at', null),
    supabase
      .from('recon_sheet_projects')
      .select('id, name, size_kwp, sheet_year, project_cost, actual_cost'),
  ]);

  if (reconRes.error) {
    console.error(`${op} recon query failed:`, { code: reconRes.error.code, message: reconRes.error.message });
    return emptyData();
  }
  if (projRes.error || sheetRes.error) {
    console.error(`${op} join source query failed:`, {
      proj: projRes.error?.message,
      sheet: sheetRes.error?.message,
    });
    return emptyData();
  }

  const projById = new Map((projRes.data ?? []).map((p) => [p.id, p]));
  const sheetById = new Map((sheetRes.data ?? []).map((s) => [s.id, s]));

  const rows: ReconViewRow[] = (reconRes.data ?? []).map((r) => {
    const proj = projById.get(r.project_id);
    const sheet = r.matched_sheet_id ? sheetById.get(r.matched_sheet_id) : undefined;
    const erpOrderYear = proj?.order_date ? new Date(proj.order_date).getFullYear() : null;

    const sheetCost = r.sheet_project_cost;
    const revenue = r.revenue_erp;
    const valueFlag =
      sheetCost != null && revenue != null && revenue > 0
        ? Math.abs(sheetCost - revenue) / Math.max(sheetCost, revenue) > VALUE_FLAG_PCT
        : false;
    const yearFlag = sheet?.sheet_year != null && erpOrderYear != null && sheet.sheet_year !== erpOrderYear;

    return {
      projectId: r.project_id,
      matchedSheetId: r.matched_sheet_id,
      erpNumber: proj?.project_number ?? null,
      erpName: proj?.project_name || proj?.customer_name || proj?.project_number || '(unknown)',
      erpSize: proj?.system_size_kwp ?? null,
      erpStatus: proj?.status ?? null,
      erpOrderYear,
      matchMethod: (r.match_method as ReconMethod) ?? null,
      matchScore: r.match_score,
      status: (r.status as ReconViewRow['status']) ?? 'proposed',
      resolvedYear: r.resolved_year,
      preferredSource: (r.preferred_source as 'erp' | 'sheet') ?? 'erp',
      sheetName: sheet?.name ?? null,
      sheetSize: sheet?.size_kwp ?? null,
      sheetYear: sheet?.sheet_year ?? null,
      sheetProjectCost: r.sheet_project_cost,
      sheetActualCost: r.sheet_actual_cost,
      revenueErp: r.revenue_erp,
      costErp: r.cost_erp,
      reviewedAt: r.reviewed_at,
      valueFlag,
      yearFlag,
    };
  });

  const byMethod: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byMethod[row.matchMethod ?? 'unknown'] = (byMethod[row.matchMethod ?? 'unknown'] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  const summary: ReconSummary = {
    total: rows.length,
    byMethod,
    byStatus,
    needsReview: rows.filter((r) => r.status === 'proposed' && (r.matchMethod === 'ambiguous' || r.matchMethod === 'likely')).length,
    confirmed: byStatus['confirmed'] ?? 0,
    valueFlags: rows.filter((r) => r.valueFlag).length,
    yearFlags: rows.filter((r) => r.yearFlag).length,
    sheetOnly: byMethod['sheet_only'] ?? 0,
  };

  return { rows, summary };
}

function emptyData(): ReconciliationData {
  return {
    rows: [],
    summary: { total: 0, byMethod: {}, byStatus: {}, needsReview: 0, confirmed: 0, valueFlags: 0, yearFlags: 0, sheetOnly: 0 },
  };
}
