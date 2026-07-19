import { createClient } from '@repo/supabase/server';
import type { ParsedBomLine } from './bom-sheet-parser';

// ── Types (serializable shapes handed to client components) ──

export interface BomImportCandidate {
  project_id: string;
  customer_name: string;
  project_number: string;
  score: number;
}

export interface BomImportRow {
  id: string;
  source_file_name: string;
  sheet_name: string;
  project_name: string;
  matched_project_id: string | null;
  match_confidence: 'exact' | 'fuzzy' | 'none';
  match_score: number;
  match_candidates: BomImportCandidate[];
  line_count: number;
  status_review: string;
  lines: ParsedBomLine[];
  summary: Record<string, number>;
  imported_project_id: string | null;
  import_error: string | null;
  created_at: string;
}

export interface BomImportFilters {
  status_review?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export interface BomImportStats {
  pending: number;
  imported: number;
  rejected: number;
  error: number;
  exact_pending: number;
  fuzzy_pending: number;
  none_pending: number;
}

export interface PickerProject {
  id: string;
  customer_name: string;
  project_number: string | null;
}

// ── Reads ──

function mapRow(r: Record<string, unknown>): BomImportRow {
  return {
    id: String(r.id),
    source_file_name: String(r.source_file_name ?? ''),
    sheet_name: String(r.sheet_name ?? ''),
    project_name: String(r.project_name ?? ''),
    matched_project_id: (r.matched_project_id as string | null) ?? null,
    match_confidence: (r.match_confidence as BomImportRow['match_confidence']) ?? 'none',
    match_score: Number(r.match_score ?? 0),
    match_candidates: (r.match_candidates as BomImportCandidate[] | null) ?? [],
    line_count: Number(r.line_count ?? 0),
    status_review: String(r.status_review ?? 'pending'),
    lines: (r.parsed_lines as ParsedBomLine[] | null) ?? [],
    summary: (r.summary as Record<string, number> | null) ?? {},
    imported_project_id: (r.imported_project_id as string | null) ?? null,
    import_error: (r.import_error as string | null) ?? null,
    created_at: String(r.created_at ?? ''),
  };
}

export async function getBomImports(filters: BomImportFilters): Promise<{ items: BomImportRow[]; total: number }> {
  const op = '[getBomImports]';
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const perPage = filters.per_page ?? 50;

  let query = supabase
    .from('pending_bom_imports')
    .select('*', { count: 'estimated' })
    // 'exact' < 'fuzzy' < 'none' alphabetically — exact matches surface first.
    .order('match_confidence', { ascending: true })
    .order('project_name', { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1);

  if (filters.status_review) query = query.eq('status_review', filters.status_review);
  if (filters.search) query = query.ilike('project_name', `%${filters.search}%`);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return { items: [], total: 0 };
  }
  return { items: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), total: count ?? 0 };
}

export async function getBomImportStats(): Promise<BomImportStats> {
  const op = '[getBomImportStats]';
  const empty: BomImportStats = { pending: 0, imported: 0, rejected: 0, error: 0, exact_pending: 0, fuzzy_pending: 0, none_pending: 0 };
  const supabase = await createClient();
  // pending_bom_imports is a tiny staging table (tens–low hundreds of rows);
  // selecting the two status columns and tallying in JS is cheap and avoids
  // five separate head-count round trips.
  const { data, error } = await supabase.from('pending_bom_imports').select('status_review, match_confidence');
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return empty;
  }
  const stats = { ...empty };
  for (const row of data ?? []) {
    const s = (row as { status_review: string }).status_review;
    if (s === 'pending') stats.pending++;
    else if (s === 'imported') stats.imported++;
    else if (s === 'rejected') stats.rejected++;
    else if (s === 'error') stats.error++;
    if (s === 'pending') {
      const m = (row as { match_confidence: string }).match_confidence;
      if (m === 'exact') stats.exact_pending++;
      else if (m === 'fuzzy') stats.fuzzy_pending++;
      else stats.none_pending++;
    }
  }
  return stats;
}

/** All projects for the match picker (mostly completed/historical, not just active). */
export async function getProjectsForPicker(): Promise<PickerProject[]> {
  const op = '[getProjectsForPicker]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, customer_name, project_number')
    .order('customer_name', { ascending: true });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    customer_name: p.customer_name ?? '(no name)',
    project_number: p.project_number ?? null,
  }));
}
