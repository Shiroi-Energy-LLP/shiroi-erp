// =============================================================================
// Purchase Flow (BOI Manager) — PO PDF assembly + render (server-only)
// =============================================================================
// Spec: docs/superpowers/specs/2026-07-20-purchase-flow-boi-manager-spec.md §6.2
// Plan: docs/superpowers/plans/2026-07-20-purchase-flow-boi-manager.md (Task 4)
//
// Shared by BOTH writers of the BOI quick-PO PDF:
//   - the createBoiPo server action (renders once at creation → Storage upload)
//   - GET /api/purchase/[poId]/pdf (regenerates on every download)
// Because the data source is ALWAYS the frozen purchase_order_items rows +
// the PO header totals computed in SQL at creation, the document is immutable
// by construction (spec §6.3) — later BOI edits never touch it.
//
// Server-only: never import from a 'use client' component. The client param is
// typed as the server OR admin factory client (same duck type) so callers pick
// the right privilege level; only `import type` is used here, so this module's
// runtime deps are just react / decimal.js / @react-pdf/renderer.
// =============================================================================

import React from 'react';
import Decimal from 'decimal.js';
import { renderToBuffer } from '@react-pdf/renderer';
import type { createClient } from '@repo/supabase/server';
import type { createAdminClient } from '@repo/supabase/admin';
import { BoiPoPdf, type BoiPoPdfData, type BoiPoPdfItem } from './pdf/boi-po-pdf';

export type { BoiPoPdfData };

type DbClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>;

// Single template literal (no interpolation) so postgrest-js keeps the literal
// type for result inference (same convention as purchase-flow-queries.ts).
const PO_PDF_SELECT = `
  id, po_number, project_id, vendor_name, expected_delivery_date, payment_terms,
  transport, delivery_place, subtotal, gst_amount, total_amount, source,
  project:projects!purchase_orders_project_id_fkey(project_name, customer_name),
  items:purchase_order_items(line_number, item_description, brand,
    quantity_ordered, unit, unit_price, gst_rate, gst_amount, total_price)
`;

/** Trailing-zero-free qty with en-IN grouping (e.g. "1,200" / "9.9"). */
function fmtQty(qty: number): string {
  return Number(qty).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * Assembles the typed props for BoiPoPdf from the frozen PO record.
 * Returns null when the PO doesn't exist or is not a boi_quick PO (the
 * download route 404s on null; v2 POs keep their own letterhead PDF).
 */
export async function getBoiPoPdfData(
  client: DbClient,
  poId: string,
): Promise<BoiPoPdfData | null> {
  const op = '[getBoiPoPdfData]';

  const { data, error } = await client
    .from('purchase_orders')
    .select(PO_PDF_SELECT)
    .eq('id', poId)
    .eq('source', 'boi_quick')
    .maybeSingle();

  if (error) {
    console.error(`${op} PO read failed:`, { poId, code: error.code, message: error.message });
    return null;
  }
  if (!data) return null;

  const items: BoiPoPdfItem[] = [...data.items]
    .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
    .map((it, idx) => ({
      slNo: idx + 1,
      description: it.brand?.trim()
        ? `${it.item_description} — ${it.brand.trim()}`
        : it.item_description,
      qtyWithUnit: `${fmtQty(it.quantity_ordered)} ${it.unit}`.trim(),
      unitPrice: it.unit_price,
      // Frozen total_price is GST-INCLUSIVE (mig-151 CHECK); the PDF table
      // shows the exclusive line total (qty × rate) — GST lives in the totals
      // box. Single-row subtraction with decimal.js (not aggregation).
      total: new Decimal(it.total_price).minus(it.gst_amount ?? 0).toNumber(),
    }));

  // "GST (18%)" when every line shares one rate, else "GST" (spec §6.2.2).
  const rates = [...new Set(data.items.map((it) => Number(it.gst_rate ?? 0)))];
  const gstLabel = rates.length === 1 ? `GST (${rates[0]}%)` : 'GST';

  return {
    poNumber: data.po_number,
    projectName:
      data.project?.project_name?.trim() || data.project?.customer_name || null,
    vendorName: data.vendor_name,
    deliveryDate: data.expected_delivery_date,
    paymentTerms: data.payment_terms,
    transport: data.transport,
    deliveryPlace: data.delivery_place,
    items,
    // Header money was computed in SQL at creation (create_boi_po) and is
    // frozen — no JS aggregation here (NEVER-DO #12).
    subtotal: data.subtotal,
    gstLabel,
    gstAmount: data.gst_amount,
    netAmount: data.total_amount,
  };
}

/** Renders the minimal BOI PO document to a PDF buffer. */
export async function renderBoiPoPdfBuffer(data: BoiPoPdfData): Promise<Buffer> {
  return renderToBuffer(<BoiPoPdf data={data} />);
}
