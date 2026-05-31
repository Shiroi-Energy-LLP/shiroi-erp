-- ============================================================
-- Migration 148 — compute_po_totals() RPC
-- Date: 2026-05-30
-- Why:
--   apps/erp/src/lib/po-actions.ts updatePoLineItemRate previously did two
--   .reduce() loops over purchase_order_items in JavaScript to recompute
--   subtotal + total_gst + total_amount. NEVER-DO #12 (money math in JS).
--
--   Subtotal is computed from quantity_ordered * unit_price (NOT total_price)
--   to be robust against a separate pre-existing convention bug where some
--   callers stored total_price ex-GST instead of inc-GST. The CHECK
--   constraint added in mig 151 (po-items-total-price-check) enforces the
--   convention going forward; this RPC is defensive against historical rows.
--
--   Reconstructed from dev DB state (Batch-A workflow agent applied via
--   execute_sql but didn't persist the local file).
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_po_totals(p_po_id uuid)
RETURNS TABLE(
  subtotal      numeric,
  total_gst     numeric,
  total_amount  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    COALESCE(SUM(quantity_ordered * unit_price), 0)::NUMERIC(14,2)        AS subtotal,
    COALESCE(SUM(gst_amount), 0)::NUMERIC(14,2)                           AS total_gst,
    COALESCE(SUM(quantity_ordered * unit_price) + SUM(gst_amount), 0)
      ::NUMERIC(14,2)                                                     AS total_amount
  FROM purchase_order_items
  WHERE purchase_order_id = p_po_id;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_po_totals(uuid) TO authenticated;
