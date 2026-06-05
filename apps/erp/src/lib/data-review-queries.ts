// apps/erp/src/lib/data-review-queries.ts
// Read-only helpers for the /data-review/projects triage UI.
// All mutations live in data-review-actions.ts.

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type ProjectRow = Database['public']['Tables']['projects']['Row'];

export interface ReviewProjectRow {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  contracted_value: number;
  review_status: ProjectRow['review_status'];
  created_at: string;
  // Joined from proposal
  proposal_id: string | null;
  financials_invalidated: boolean;
  system_size_uncertain: boolean;
  proposal_notes: string | null;
  // Source signals (derived from notes)
  hubspot_deal_id: string | null;
  pv_ref_in_notes: string | null;
  drive_link: string | null;
  is_likely_duplicate: boolean;
}

export type ReviewTab = 'needs_review' | 'all' | 'confirmed' | 'duplicates' | 'audit';

export interface ProjectReviewCounts {
  needs_review: number;
  all_projects: number;
  confirmed: number;
  duplicate: number;
}

// ── Counts (for banner + tab headers) ───────────────────────────────────────

export async function getProjectReviewCounts(): Promise<ProjectReviewCounts> {
  const op = '[getProjectReviewCounts]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_project_review_counts').single();
  if (error) {
    console.error(op, { error, timestamp: new Date().toISOString() });
    return { needs_review: 0, all_projects: 0, confirmed: 0, duplicate: 0 };
  }
  return {
    needs_review: Number((data as Record<string, unknown>)?.needs_review ?? 0),
    all_projects: Number((data as Record<string, unknown>)?.all_projects ?? 0),
    confirmed: Number((data as Record<string, unknown>)?.confirmed ?? 0),
    duplicate: Number((data as Record<string, unknown>)?.duplicate ?? 0),
  };
}

// ── Project listing (paginated) ───────────────────────────────────────────────

export async function listProjectsForReview(opts: {
  tab: Exclude<ReviewTab, 'audit'>;
  page: number;
  pageSize: number;
  search?: string;
}): Promise<{ rows: ReviewProjectRow[]; totalRows: number }> {
  const op = '[listProjectsForReview]';
  const supabase = await createClient();
  const pageSize = opts.pageSize ?? 50;
  const from = opts.page * pageSize;

  // Item 2b: typed search RPC replaces .or() interpolation. The RPC returns
  // the joined proposal + lead fields inline and a total_count column on
  // every row (same value), so pagination needs no second round-trip.
  // Cast bridge: `search_projects_for_review` lands in database.ts only
  // after the parent agent regens types at end-of-batch.
  const { data, error } = await supabase.rpc('search_projects_for_review', {
    p_tab: opts.tab,
    p_query: opts.search?.trim() || undefined,
    p_limit: pageSize,
    p_offset: from,
  });
  if (error) {
    console.error(op, { tab: opts.tab, error, timestamp: new Date().toISOString() });
    return { rows: [], totalRows: 0 };
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const totalRows = rows.length > 0 ? Number(rows[0]!.total_count ?? 0) : 0;
  return { rows: rows.map(rowToReview), totalRows };
}

function rowToReview(row: Record<string, unknown>): ReviewProjectRow {
  const projectNotes = String(row.notes ?? '');
  const proposalNotes = String((row.proposal_notes as string | null) ?? '');
  const allNotes = `${projectNotes} ${proposalNotes}`;

  const pvMatch = allNotes.match(/PV\s*\d+\s*\/\s*\d{2}(?:-\d{2})?/i);
  const driveMatch = allNotes.match(/https?:\/\/drive\.google\.com[^\s)"']*/);

  return {
    id: String(row.id),
    project_number: String(row.project_number ?? ''),
    customer_name: String(row.customer_name ?? ''),
    system_size_kwp: Number(row.system_size_kwp ?? 0),
    contracted_value: Number(row.contracted_value ?? 0),
    review_status: (row.review_status as ProjectRow['review_status']) ?? 'pending',
    created_at: String(row.created_at ?? ''),
    proposal_id: (row.proposal_id as string | null) ?? null,
    financials_invalidated: Boolean(row.proposal_financials_invalidated ?? false),
    system_size_uncertain: Boolean(row.proposal_system_size_uncertain ?? false),
    proposal_notes: proposalNotes || null,
    hubspot_deal_id: (row.hubspot_deal_id as string | null) ?? null,
    pv_ref_in_notes: pvMatch?.[0] ?? null,
    drive_link: driveMatch?.[0] ?? null,
    is_likely_duplicate: allNotes.includes('[Likely-Duplicate-Reconcile]'),
  };
}

// ── Typeahead search for "duplicate of" ───────────────────────────────────────

export async function searchProjectsForDuplicate(
  query: string,
  excludeId: string,
): Promise<Array<{ id: string; project_number: string; customer_name: string; system_size_kwp: number }>> {
  if (!query || query.trim().length < 2) return [];
  const op = '[searchProjectsForDuplicate]';
  const supabase = await createClient();
  // Item 2b: typed search RPC replaces .or() interpolation. Cast bridge
  // until parent regens database.ts at end-of-batch.
  const { data, error } = await supabase.rpc('search_projects_for_duplicate_pick', {
    p_query: query.trim(),
    p_exclude_id: excludeId,
    p_limit: 15,
  });
  if (error) {
    console.error(op, { query, error, timestamp: new Date().toISOString() });
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id),
    project_number: String(p.project_number ?? ''),
    customer_name: String(p.customer_name ?? ''),
    system_size_kwp: Number(p.system_size_kwp ?? 0),
  }));
}

// ── Audit log (paginated) ─────────────────────────────────────────────────────

export async function getProjectReviewAudit(opts: {
  page: number;
  pageSize: number;
}): Promise<{ rows: ProjectReviewAuditRow[]; totalRows: number }> {
  const op = '[getProjectReviewAudit]';
  const supabase = await createClient();
  const from = opts.page * opts.pageSize;
  const to = from + opts.pageSize - 1;
  const { data, error, count } = await supabase
    .from('project_review_audit')
    .select(
      `id, project_id, decision, prev_size_kwp, new_size_kwp,
       prev_contracted_value, new_contracted_value, duplicate_of_project_id,
       losing_score, winning_score, notes, made_by, made_at,
       projects!project_review_audit_project_id_fkey(project_number, customer_name)`,
      { count: 'estimated' },
    )
    .order('made_at', { ascending: false })
    .range(from, to);
  if (error) {
    console.error(op, { error, timestamp: new Date().toISOString() });
    return { rows: [], totalRows: 0 };
  }
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      project_id: r.project_id,
      decision: r.decision as 'confirmed' | 'duplicate' | 'undo',
      prev_size_kwp: r.prev_size_kwp != null ? Number(r.prev_size_kwp) : null,
      new_size_kwp: r.new_size_kwp != null ? Number(r.new_size_kwp) : null,
      prev_contracted_value: r.prev_contracted_value != null ? Number(r.prev_contracted_value) : null,
      new_contracted_value: r.new_contracted_value != null ? Number(r.new_contracted_value) : null,
      duplicate_of_project_id: r.duplicate_of_project_id ?? null,
      losing_score: r.losing_score ?? null,
      winning_score: r.winning_score ?? null,
      notes: r.notes ?? null,
      made_by: r.made_by,
      made_at: r.made_at,
      project_number: (r.projects as Record<string, unknown> | null)?.project_number as string ?? '',
      customer_name: (r.projects as Record<string, unknown> | null)?.customer_name as string ?? '',
    })),
    totalRows: count ?? 0,
  };
}

export interface ProjectReviewAuditRow {
  id: string;
  project_id: string;
  decision: 'confirmed' | 'duplicate' | 'undo';
  prev_size_kwp: number | null;
  new_size_kwp: number | null;
  prev_contracted_value: number | null;
  new_contracted_value: number | null;
  duplicate_of_project_id: string | null;
  losing_score: number | null;
  winning_score: number | null;
  notes: string | null;
  made_by: string;
  made_at: string;
  // Joined from projects
  project_number: string;
  customer_name: string;
}

// ── Score for duplicate comparison ───────────────────────────────────────────

export async function getProjectScoreForDuplicateConfirm(projectId: string): Promise<number> {
  const op = '[getProjectScoreForDuplicateConfirm]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('score_project_data_richness', {
    p_project_id: projectId,
  });
  if (error) {
    console.error(op, { projectId, error, timestamp: new Date().toISOString() });
    return 0;
  }
  return Number(data ?? 0);
}
