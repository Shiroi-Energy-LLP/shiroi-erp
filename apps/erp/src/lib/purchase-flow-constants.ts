// =============================================================================
// Purchase Flow (BOI Manager) — shared constants + types
// =============================================================================
// Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md
// Plan: docs/superpowers/plans/2026-07-20-purchase-flow-boi-manager.md (Task 2)
//
// CLIENT-SAFE (NEVER-DO #21): this file must have ZERO runtime imports from
// server modules. Only type-only imports from @repo/types are allowed. It is
// the single source of truth for BOI status literals, role gates, GST options
// and the shared row/input types consumed by purchase-flow-queries.ts,
// purchase-flow-actions.ts and every /purchase client component.
//
// Item categories are NOT defined here — the existing master lives in
// apps/erp/src/lib/boi-constants.ts (Manivel 15) and is already client-safe.
// =============================================================================

import type { Database } from '@repo/types/database';

type AppRole = Database['public']['Enums']['app_role'];

// ---------------------------------------------------------------------------
// BOI status ladder (project_boq_items.procurement_status, mig 024 CHECK)
// ---------------------------------------------------------------------------
// The DB CHECK also allows 'ready_to_dispatch' (v2 dispatch flow); the BOI UI
// folds it into the Received bucket for display/KPIs and never offers it in a
// status dropdown (locked design decision). Use displayBoiStatus() to fold.

export const BOI_STATUSES = [
  'yet_to_finalize',
  'yet_to_place',
  'order_placed',
  'received',
  'delivered',
] as const;

export type BoiStatus = (typeof BOI_STATUSES)[number];

export const BOI_STATUS_LABELS: Record<BoiStatus, string> = {
  yet_to_finalize: 'Yet to Finalize',
  yet_to_place: 'Yet to Place',
  order_placed: 'Order Placed',
  received: 'Received',
  delivered: 'Delivered',
};

/** Badge classes per spec §2: orange / amber / blue / violet / green. */
export const BOI_STATUS_COLORS: Record<BoiStatus, string> = {
  yet_to_finalize: 'bg-orange-100 text-orange-800 border-orange-200',
  yet_to_place: 'bg-amber-100 text-amber-800 border-amber-200',
  order_placed: 'bg-blue-100 text-blue-800 border-blue-200',
  received: 'bg-violet-100 text-violet-800 border-violet-200',
  delivered: 'bg-green-100 text-green-800 border-green-200',
};

export function isBoiStatus(value: string): value is BoiStatus {
  return (BOI_STATUSES as readonly string[]).includes(value);
}

/**
 * Folds the raw DB procurement_status into the 5 canonical BOI statuses:
 * 'ready_to_dispatch' (v2 dispatch flow) displays/counts under Received.
 * Unknown values fall back to 'yet_to_finalize' (defensive; CHECK prevents it).
 */
export function displayBoiStatus(raw: string): BoiStatus {
  if (raw === 'ready_to_dispatch') return 'received';
  return isBoiStatus(raw) ? raw : 'yet_to_finalize';
}

// ---------------------------------------------------------------------------
// GST + PO defaults (spec §5.1 / §6.1)
// ---------------------------------------------------------------------------

export const GST_OPTIONS = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_OPTIONS)[number];

export const PO_DEFAULTS = {
  paymentTerms: 'Credit',
  transport: 'At Actual',
} as const;

// ---------------------------------------------------------------------------
// Role gates (spec §1, adjusted to ERP RLS — see mig 210 header note)
// ---------------------------------------------------------------------------
// PRICE_VISIBLE_ROLES: may VIEW money (BOI rates/amounts, PO values, budgets).
// PURCHASE_WRITE_ROLES: may MUTATE (RLS po_write / project_boq_items write is
//   founder/project_manager/purchase_officer — finance reads but cannot write).
// INTAKE_ROLES: may submit intake lines (site_supervisor's ONLY write path;
//   prices are resolved server-side and never sent to the client).

export const PRICE_VISIBLE_ROLES = [
  'founder',
  'project_manager',
  'purchase_officer',
  'finance',
] as const satisfies readonly AppRole[];

export const PURCHASE_WRITE_ROLES = [
  'founder',
  'project_manager',
  'purchase_officer',
] as const satisfies readonly AppRole[];

export const INTAKE_ROLES = [
  'founder',
  'project_manager',
  'purchase_officer',
  'site_supervisor',
] as const satisfies readonly AppRole[];

// ---------------------------------------------------------------------------
// Inline-edit whitelist (spec §12 single-field commits)
// ---------------------------------------------------------------------------

export const BOI_EDITABLE_FIELDS = [
  'quantity',
  'unit_price',
  'gst_rate',
  'vendor_name',
  'procurement_status',
] as const;

export type BoiEditableField = (typeof BOI_EDITABLE_FIELDS)[number];

// ---------------------------------------------------------------------------
// Shared row types (what the queries/actions layer returns to the UI)
// ---------------------------------------------------------------------------

/** One BOI line as rendered in the /purchase workspace table. */
export interface BoiLineRow {
  id: string;
  project_id: string;
  /** COALESCE(NULLIF(project_name,''), customer_name) */
  project_display_name: string;
  price_book_id: string | null;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unit: string;
  /** Raw DB value — may be 'ready_to_dispatch'; fold with displayBoiStatus(). */
  procurement_status: string;
  unit_price: number;
  gst_rate: number;
  /** GST-INCLUSIVE: quantity × unit_price × (1 + gst_rate/100), 2dp. */
  total_price: number;
  vendor_name: string | null;
  purchase_order_id: string | null;
  po_number: string | null;
  created_at: string;
  updated_at: string;
}

/** One PO as rendered in the /purchase/orders log. */
export interface BoiPoRow {
  id: string;
  po_number: string;
  project_id: string | null;
  project_display_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  payment_terms: string | null;
  transport: string | null;
  delivery_place: string | null;
  subtotal: number;
  gst_amount: number;
  /** Net Amount = subtotal + gst_amount. */
  total_amount: number;
  pdf_storage_path: string | null;
  prepared_by: string;
  created_by_name: string | null;
  created_at: string;
}

/** One row of get_purchase_project_rollup() (spec §3). */
export type PurchaseProjectRollupRow =
  Database['public']['Functions']['get_purchase_project_rollup']['Returns'][number];

/** Raw row of get_boi_status_totals() (spec §5.2). */
export type BoiStatusTotalsRpcRow =
  Database['public']['Functions']['get_boi_status_totals']['Returns'][number];

/** Zero-filled, status-keyed KPI shape derived from the RPC result. */
export interface BoiStatusTotalsResult {
  byStatus: Record<BoiStatus, { lineCount: number; totalAmount: number }>;
  grandCount: number;
  grandTotal: number;
}

/**
 * Price Book search hit. base_price/gst_rate are ABSENT (not just undefined at
 * runtime) when the query was made with includePrices=false — the select string
 * never touches the price columns (spec §1 server-side stripping).
 */
export interface PriceBookSearchItem {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  unit: string;
  vendor_name: string | null;
  default_qty: number | null;
  base_price?: number;
  gst_rate?: number;
}

/** Return shape of the role-aware searchPriceBookAction server action. */
export interface PriceBookSearchResultForAction {
  rows: PriceBookSearchItem[];
  total: number;
  /** Derived server-side from the viewer's role — never client-controlled. */
  pricesIncluded: boolean;
}

/** Project option for the workspace/intake combobox. */
export interface ProjectOption {
  id: string;
  /** COALESCE(NULLIF(project_name,''), customer_name) */
  name: string;
  project_number: string;
}

// ---------------------------------------------------------------------------
// Shared input types (client → server action payloads)
// ---------------------------------------------------------------------------

/** Full-row payload for the Add/Edit Item modal (spec §5.3). */
export interface BoiLineInput {
  projectId: string;
  itemCategory: string;
  itemDescription: string;
  brand?: string | null;
  model?: string | null;
  quantity: number;
  unit: string;
  procurementStatus: BoiStatus;
  unitPrice: number;
  gstRate: number;
  vendorName?: string | null;
  priceBookId?: string | null;
}

/** One line of the "Add Multiple from Price Book" modal (spec §5.4). */
export interface BulkAddPriceBookItem {
  priceBookId: string;
  quantity: number;
  /** Editable in the modal; omitted → PB base_price. */
  unitPrice?: number;
  /** Editable in the modal; omitted → PB gst_rate. */
  gstRate?: number;
}

export interface BulkAddFromPriceBookInput {
  projectId: string;
  status: BoiStatus;
  items: BulkAddPriceBookItem[];
}

/** Create-PO modal payload (spec §6.1). Item prices are NEVER sent — the RPC
 *  re-reads the lines by id server-side (spec §6.2.1). */
export interface CreateBoiPoInput {
  itemIds: string[];
  projectId: string;
  vendorName: string;
  /** 'YYYY-MM-DD' or empty/omitted. */
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  transport?: string | null;
  deliveryPlace?: string | null;
}

/** Result of createBoiPo. pdfWarning is set when the PO was created but the
 *  PDF render/upload step failed (spec §6.2.5 — PDF failure never fails the
 *  PO; the download route regenerates from the frozen rows anyway). */
export interface CreateBoiPoResult {
  poId: string;
  poNumber: string;
  pdfWarning?: string;
}

/** PO edit modal payload — metadata only, items/amounts frozen (spec §6.3/§7).
 *  undefined = leave unchanged; null = clear. */
export interface BoiPoMetaInput {
  projectId?: string | null;
  vendorName?: string;
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  transport?: string | null;
  deliveryPlace?: string | null;
}

/** Site-engineer intake line (spec §11) — id + qty only, never prices. */
export interface IntakeItemInput {
  priceBookId: string;
  quantity: number;
}
