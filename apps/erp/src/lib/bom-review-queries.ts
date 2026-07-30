// =============================================================================
// BOM Review reads — /bom-review
// =============================================================================
// Extracted from bom-review/page.tsx, which called createClient() inline in the
// page body (NEVER-DO #15). Reads only; there are no mutations here — inline
// cell edits go through inline-edit-actions.ts.
//
// NEVER-DO #21: this file imports the server Supabase client, so client
// components must use `import type` only. Display constants live in
// bom-review-constants.ts.
// =============================================================================

import { createClient } from '@repo/supabase/server';

export interface BomReviewSummary {
  total: number;
  with_rate: number;
  no_rate: number;
  flagged: number;
  category_counts: Record<string, number>;
}

export interface BomReviewLine {
  id: string;
  item_description: string;
  item_category: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  gst_rate: number;
  brand: string | null;
  proposals: { proposal_number: string; lead_id: string | null } | null;
}

/**
 * Four counts + the per-category breakdown in a single pass (mig 194),
 * replacing 3 count:'exact' scans over ~24.7k rows plus an unbounded
 * item_category scan that pulled every row into Node.
 */
export async function getBomReviewSummary(): Promise<BomReviewSummary> {
  const op = '[getBomReviewSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_bom_review_summary');

  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code, message: error.message, timestamp: new Date().toISOString(),
    });
    return { total: 0, with_rate: 0, no_rate: 0, flagged: 0, category_counts: {} };
  }

  const summary = (data ?? {}) as unknown as Partial<BomReviewSummary>;
  return {
    total: summary.total ?? 0,
    with_rate: summary.with_rate ?? 0,
    no_rate: summary.no_rate ?? 0,
    flagged: summary.flagged ?? 0,
    category_counts: summary.category_counts ?? {},
  };
}

export async function getBomReviewLines(filters: {
  category?: string;
  proposalId?: string;
  page: number;
  perPage: number;
}): Promise<{ lines: BomReviewLine[]; filteredCount: number }> {
  const op = '[getBomReviewLines]';
  const supabase = await createClient();

  const { page, perPage } = filters;
  let query = supabase
    .from('proposal_bom_lines')
    // count:'estimated' — the table is far past the 1,000-row exact-count
    // threshold (NEVER-DO #13).
    .select('id, item_description, item_category, quantity, unit, unit_price, total_price, gst_rate, brand, proposals!inner(proposal_number, lead_id)', { count: 'estimated' })
    .order('item_category', { ascending: true })
    .order('line_number', { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1);

  if (filters.category) query = query.eq('item_category', filters.category);
  if (filters.proposalId) query = query.eq('proposal_id', filters.proposalId);

  const { data, error, count } = await query.returns<BomReviewLine[]>();

  if (error) {
    console.error(`${op} Failed:`, {
      ...filters, code: error.code, message: error.message, timestamp: new Date().toISOString(),
    });
    return { lines: [], filteredCount: 0 };
  }

  return { lines: data ?? [], filteredCount: count ?? 0 };
}
