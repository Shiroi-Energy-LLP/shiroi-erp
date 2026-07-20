// =============================================================================
// Purchase Flow (BOI Manager) — server read layer
// =============================================================================
// Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md
// Plan: docs/superpowers/plans/2026-07-20-purchase-flow-boi-manager.md (Task 2)
//
// Reads only (mutations live in purchase-flow-actions.ts). Server-side only —
// client components may `import type` from this file but NEVER runtime values
// (NEVER-DO #21). All money aggregation happens in SQL (RPCs from mig 210 or
// PostgREST aggregates) — never a JS reduce over monetary rows (NEVER-DO #12).
// =============================================================================

import Decimal from 'decimal.js';
import { createClient } from '@repo/supabase/server';
import { sanitizeForIlike } from './helpers/sanitize-or-filter';
import {
  BOI_STATUSES,
  isBoiStatus,
  type BoiLineRow,
  type BoiPoRow,
  type BoiStatus,
  type BoiStatusTotalsResult,
  type PriceBookSearchItem,
  type ProjectOption,
  type PurchaseProjectRollupRow,
} from './purchase-flow-constants';

// Re-export the shared types so consumers can `import type` from one place.
export type {
  BoiLineRow,
  BoiPoRow,
  BoiStatusTotalsResult,
  PriceBookSearchItem,
  ProjectOption,
  PurchaseProjectRollupRow,
};

/** Batch size for the fetch-all loops (BOI scale is ~1–5k rows). */
const FETCH_PAGE_SIZE = 1000;
/** Hard safety cap on fetch-all loops (20k rows). */
const MAX_FETCH_PAGES = 20;

// ---------------------------------------------------------------------------
// BOI lines (full fetch — the workspace filters client-side, spec §12)
// ---------------------------------------------------------------------------

// NOTE: single template literal (no concatenation/interpolation) so the
// select string keeps its literal type — postgrest-js result inference
// degrades to an error type when it receives a plain `string`.
const BOI_LINE_SELECT = `
  id, project_id, price_book_id, item_category, item_description, brand, model,
  quantity, unit, procurement_status, unit_price, gst_rate, total_price,
  vendor_name, purchase_order_id, created_at, updated_at,
  project:projects!project_boq_items_project_id_fkey(project_name, customer_name),
  po:purchase_orders!project_boq_items_purchase_order_id_fkey(po_number)
`;

interface RawBoiLine {
  id: string;
  project_id: string;
  price_book_id: string | null;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unit: string;
  procurement_status: string;
  unit_price: number;
  gst_rate: number;
  total_price: number;
  vendor_name: string | null;
  purchase_order_id: string | null;
  created_at: string;
  updated_at: string;
  project: { project_name: string | null; customer_name: string } | null;
  po: { po_number: string } | null;
}

function mapBoiLine(r: RawBoiLine): BoiLineRow {
  return {
    id: r.id,
    project_id: r.project_id,
    project_display_name:
      (r.project?.project_name?.trim() || r.project?.customer_name) ?? '—',
    price_book_id: r.price_book_id,
    item_category: r.item_category,
    item_description: r.item_description,
    brand: r.brand,
    model: r.model,
    quantity: r.quantity,
    unit: r.unit,
    procurement_status: r.procurement_status,
    unit_price: r.unit_price,
    gst_rate: r.gst_rate,
    total_price: r.total_price,
    vendor_name: r.vendor_name,
    purchase_order_id: r.purchase_order_id,
    po_number: r.po?.po_number ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Fetches ALL BOI lines (batched .range loop until a short page — no bare
 * .limit, NEVER-DO #25). Rows come back in insertion order (spec §12: no
 * sorting UI). Returns [] on any page error rather than a partial list.
 */
export async function getBoiLines(): Promise<BoiLineRow[]> {
  const op = '[getBoiLines]';
  const supabase = await createClient();
  const all: BoiLineRow[] = [];

  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const from = page * FETCH_PAGE_SIZE;
    const { data, error } = await supabase
      .from('project_boq_items')
      .select(BOI_LINE_SELECT)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE_SIZE - 1);

    if (error) {
      console.error(`${op} page ${page} failed:`, { code: error.code, message: error.message });
      return [];
    }
    if (!data) {
      console.error(`${op} page ${page} returned null data`);
      return [];
    }

    for (const row of data) all.push(mapBoiLine(row));
    if (data.length < FETCH_PAGE_SIZE) break;
  }

  return all;
}

/** Single BOI line with the same shape as getBoiLines() rows (used by actions
 *  to return the fresh recalculated row after a mutation, spec §12). */
export async function getBoiLineById(id: string): Promise<BoiLineRow | null> {
  const op = '[getBoiLineById]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_boq_items')
    .select(BOI_LINE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} failed:`, { id, code: error.code, message: error.message });
    return null;
  }
  if (!data) return null;
  return mapBoiLine(data);
}

// ---------------------------------------------------------------------------
// Status-wise money KPIs (spec §5.2) — thin wrapper over get_boi_status_totals
// ---------------------------------------------------------------------------

export interface BoiKpiFilters {
  projectId?: string;
  category?: string;
  vendor?: string;
  search?: string;
}

/**
 * KPI row of record: per-status line counts + GST-inclusive totals with every
 * non-status filter applied (the RPC folds ready_to_dispatch into received).
 * Grand totals are sums of the 5 RPC aggregates (Decimal, not float drift).
 */
export async function getBoiStatusTotals(
  filters: BoiKpiFilters = {},
): Promise<BoiStatusTotalsResult> {
  const op = '[getBoiStatusTotals]';
  const supabase = await createClient();

  const empty = (): BoiStatusTotalsResult => ({
    byStatus: Object.fromEntries(
      BOI_STATUSES.map((s) => [s, { lineCount: 0, totalAmount: 0 }]),
    ) as BoiStatusTotalsResult['byStatus'],
    grandCount: 0,
    grandTotal: 0,
  });

  const { data, error } = await supabase.rpc('get_boi_status_totals', {
    p_project_id: filters.projectId || undefined,
    p_category: filters.category || undefined,
    p_vendor: filters.vendor || undefined,
    p_search: filters.search?.trim() || undefined,
  });

  if (error) {
    console.error(`${op} RPC failed:`, { filters, code: error.code, message: error.message });
    return empty();
  }
  if (!data) {
    console.error(`${op} RPC returned null data`, { filters });
    return empty();
  }

  const result = empty();
  let grandTotal = new Decimal(0);
  for (const row of data) {
    if (!isBoiStatus(row.status)) continue; // RPC already folds ready_to_dispatch
    result.byStatus[row.status] = {
      lineCount: Number(row.line_count),
      totalAmount: Number(row.total_amount ?? 0),
    };
    result.grandCount += Number(row.line_count);
    grandTotal = grandTotal.plus(row.total_amount ?? 0);
  }
  result.grandTotal = grandTotal.toDecimalPlaces(2).toNumber();
  return result;
}

// ---------------------------------------------------------------------------
// PO log (spec §7) — paginated, newest first, source='boi_quick' only
// ---------------------------------------------------------------------------

const BOI_PO_SELECT = `
  id, po_number, project_id, vendor_id, vendor_name, expected_delivery_date,
  payment_terms, transport, delivery_place, subtotal, gst_amount, total_amount,
  pdf_storage_path, prepared_by, created_at,
  project:projects!purchase_orders_project_id_fkey(project_name, customer_name),
  preparer:employees!purchase_orders_prepared_by_fkey(full_name)
`;

interface RawBoiPo {
  id: string;
  po_number: string;
  project_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  payment_terms: string | null;
  transport: string | null;
  delivery_place: string | null;
  subtotal: number;
  gst_amount: number;
  total_amount: number;
  pdf_storage_path: string | null;
  prepared_by: string;
  created_at: string;
  project: { project_name: string | null; customer_name: string } | null;
  preparer: { full_name: string } | null;
}

function mapBoiPo(r: RawBoiPo): BoiPoRow {
  return {
    id: r.id,
    po_number: r.po_number,
    project_id: r.project_id,
    project_display_name:
      (r.project?.project_name?.trim() || r.project?.customer_name) ?? null,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    expected_delivery_date: r.expected_delivery_date,
    payment_terms: r.payment_terms,
    transport: r.transport,
    delivery_place: r.delivery_place,
    subtotal: r.subtotal,
    gst_amount: r.gst_amount,
    total_amount: r.total_amount,
    pdf_storage_path: r.pdf_storage_path,
    prepared_by: r.prepared_by,
    created_by_name: r.preparer?.full_name ?? null,
    created_at: r.created_at,
  };
}

export interface GetBoiPosOptions {
  /** Matches PO number, vendor, project name/number and creator name. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface BoiPosResult {
  rows: BoiPoRow[];
  /** Filtered PO count (count: 'estimated'). */
  total: number;
  /** Filtered Σ total_amount, computed in SQL (PostgREST sum aggregate). */
  totalValue: number;
}

/**
 * The search box spans columns on purchase_orders (po_number, vendor_name) AND
 * joined tables (project name, creator name). PostgREST .or() cannot span
 * tables, so matching project/employee ids are resolved first (capped at 50
 * each) and folded into the .or() as id-IN clauses.
 */
async function buildPoSearchOrFilter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  search: string,
): Promise<string> {
  const op = '[buildPoSearchOrFilter]';
  const s = sanitizeForIlike(search);
  const clauses = [`po_number.ilike.${s}`, `vendor_name.ilike.${s}`];

  const { data: projects, error: projError } = await supabase
    .from('projects')
    .select('id')
    .or(`project_name.ilike.${s},customer_name.ilike.${s},project_number.ilike.${s}`)
    .limit(50);
  if (projError) {
    console.error(`${op} project lookup failed:`, { code: projError.code, message: projError.message });
  } else if (projects && projects.length > 0) {
    clauses.push(`project_id.in.(${projects.map((p) => p.id).join(',')})`);
  }

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id')
    .ilike('full_name', s)
    .limit(50);
  if (empError) {
    console.error(`${op} employee lookup failed:`, { code: empError.code, message: empError.message });
  } else if (employees && employees.length > 0) {
    clauses.push(`prepared_by.in.(${employees.map((e) => e.id).join(',')})`);
  }

  return clauses.join(',');
}

export async function getBoiPos(options: GetBoiPosOptions = {}): Promise<BoiPosResult> {
  const op = '[getBoiPos]';
  const supabase = await createClient();
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * pageSize;

  const searchTerm = options.search?.trim();
  const orFilter = searchTerm
    ? await buildPoSearchOrFilter(supabase, searchTerm)
    : null;

  let query = supabase
    .from('purchase_orders')
    .select(BOI_PO_SELECT, { count: 'estimated' })
    .eq('source', 'boi_quick')
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (orFilter) query = query.or(orFilter);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} failed:`, { options, code: error.code, message: error.message });
    return { rows: [], total: 0, totalValue: 0 };
  }
  if (!data) {
    console.error(`${op} returned null data`, { options });
    return { rows: [], total: 0, totalValue: 0 };
  }

  // KPI money of record: Σ total_amount over the WHOLE filtered set, computed
  // in SQL via the PostgREST sum() aggregate — never a JS reduce (NEVER-DO #12).
  let totalValue = 0;
  let aggQuery = supabase
    .from('purchase_orders')
    .select('total_amount.sum()')
    .eq('source', 'boi_quick');
  if (orFilter) aggQuery = aggQuery.or(orFilter);
  const { data: aggData, error: aggError } = await aggQuery.returns<
    Array<{ sum: number | null }>
  >();
  if (aggError) {
    console.error(`${op} sum aggregate failed:`, { code: aggError.code, message: aggError.message });
  } else {
    totalValue = Number(aggData?.[0]?.sum ?? 0);
  }

  return { rows: data.map(mapBoiPo), total: count ?? data.length, totalValue };
}

/** Single PO with the same shape as getBoiPos() rows (used by updateBoiPoMeta
 *  to return the fresh record for client cache patching). */
export async function getBoiPoById(id: string): Promise<BoiPoRow | null> {
  const op = '[getBoiPoById]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(BOI_PO_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`${op} failed:`, { id, code: error.code, message: error.message });
    return null;
  }
  if (!data) return null;
  return mapBoiPo(data);
}

// ---------------------------------------------------------------------------
// Project rollup (spec §3) — thin wrapper over get_purchase_project_rollup
// ---------------------------------------------------------------------------

export async function getPurchaseProjectRollup(): Promise<PurchaseProjectRollupRow[]> {
  const op = '[getPurchaseProjectRollup]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_purchase_project_rollup');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return [];
  }
  if (!data) {
    console.error(`${op} RPC returned null data`);
    return [];
  }
  return data;
}

// ---------------------------------------------------------------------------
// Price Book search (spec §5.3 / §5.4 / §11)
// ---------------------------------------------------------------------------

export interface PriceBookSearchResult {
  /** At most 50 rows (spec: "first 50 matches; +N more — refine your search"). */
  rows: PriceBookSearchItem[];
  /** Total matches (count: 'estimated') so the UI can render "+N more". */
  total: number;
}

/**
 * Searches active price-book items across item/make/category/vendor.
 *
 * SPEC §1 — server-side price stripping: when includePrices=false the select
 * string EXCLUDES base_price/gst_rate entirely, so price data never leaves
 * the database query. Callers serving site_supervisor MUST pass false (the
 * searchPriceBookAction wrapper derives the flag from the viewer's role).
 *
 * The two branches carry their select strings as separate template literals
 * (a ternary select would widen to `string` and break result inference).
 */
export async function searchPriceBookItems(
  term: string,
  opts: { includePrices: boolean },
): Promise<PriceBookSearchResult> {
  const op = '[searchPriceBookItems]';
  const trimmed = term.trim();
  if (!trimmed) return { rows: [], total: 0 };

  const supabase = await createClient();
  const s = sanitizeForIlike(trimmed);
  const orFilter = `item_description.ilike.${s},brand.ilike.${s},item_category.ilike.${s},vendor_name.ilike.${s}`;

  if (opts.includePrices) {
    const { data, error, count } = await supabase
      .from('price_book')
      .select(
        'id, item_category, item_description, brand, model, unit, vendor_name, default_qty, base_price, gst_rate',
        { count: 'estimated' },
      )
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(orFilter)
      .order('item_description', { ascending: true })
      .range(0, 49);

    if (error) {
      console.error(`${op} (priced) failed:`, { term: trimmed, code: error.code, message: error.message });
      return { rows: [], total: 0 };
    }
    if (!data) {
      console.error(`${op} (priced) returned null data`, { term: trimmed });
      return { rows: [], total: 0 };
    }
    return { rows: data, total: count ?? data.length };
  }

  const { data, error, count } = await supabase
    .from('price_book')
    .select(
      'id, item_category, item_description, brand, model, unit, vendor_name, default_qty',
      { count: 'estimated' },
    )
    .eq('is_active', true)
    .is('deleted_at', null)
    .or(orFilter)
    .order('item_description', { ascending: true })
    .range(0, 49);

  if (error) {
    console.error(`${op} failed:`, { term: trimmed, code: error.code, message: error.message });
    return { rows: [], total: 0 };
  }
  if (!data) {
    console.error(`${op} returned null data`, { term: trimmed });
    return { rows: [], total: 0 };
  }
  return { rows: data, total: count ?? data.length };
}

// ---------------------------------------------------------------------------
// Project options for the combobox (real projects only — locked decision)
// ---------------------------------------------------------------------------

/** Non-deleted projects, newest first (batched fetch-all). The projects
 *  status union has no 'cancelled' value — soft delete (deleted_at) is the
 *  only exclusion needed. */
export async function getProjectOptions(): Promise<ProjectOption[]> {
  const op = '[getProjectOptions]';
  const supabase = await createClient();
  const all: ProjectOption[] = [];

  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const from = page * FETCH_PAGE_SIZE;
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_name, customer_name, project_number')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE_SIZE - 1);

    if (error) {
      console.error(`${op} page ${page} failed:`, { code: error.code, message: error.message });
      return [];
    }
    if (!data) {
      console.error(`${op} page ${page} returned null data`);
      return [];
    }

    for (const p of data) {
      all.push({
        id: p.id,
        name: p.project_name?.trim() || p.customer_name,
        project_number: p.project_number,
      });
    }
    if (data.length < FETCH_PAGE_SIZE) break;
  }

  return all;
}
