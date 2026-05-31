-- ============================================================
-- Migration 151 — purchase_order_items.total_price CHECK constraint
-- File: supabase/migrations/151_2026-05-31-po-items-total-price-check.sql
-- Date: 2026-05-31
--
-- Why:
--   The canonical convention (used by procurement-actions.ts
--   createPurchaseOrder + createPOsFromAssignedItems, and by rfq-actions.ts
--   when converting an award to a PO) is:
--
--     total_price = quantity_ordered * unit_price + gst_amount
--                 (i.e. INCLUDES GST)
--
--   po-actions.ts updatePoLineItemRate was storing
--   `quantity_ordered * unit_price` (WITHOUT GST), which drifts the row
--   below its newly-created siblings. The app fix lands in the same commit
--   (po-actions.ts:51-58). This migration:
--
--     1. Backfills any pre-existing drift to the canonical formula.
--     2. Adds a CHECK constraint with 0.01 tolerance so future writers
--        physically cannot break the convention again.
--
--   0.01 tolerance accommodates NUMERIC(14,2) rounding when a caller
--   computed gst_amount via floating-point math before persisting.
--
-- Verification (run after applying):
--   SELECT COUNT(*) FROM purchase_order_items
--   WHERE ABS(total_price - (quantity_ordered * unit_price + gst_amount)) > 0.01;
--   -- expected: 0
-- ============================================================

-- 1) Backfill drifted rows. We trust gst_amount as recorded; total_price
--    is the derived column so we recompute it. Bounded by the same
--    tolerance the constraint will enforce so rounding-only deltas are
--    left alone.
UPDATE purchase_order_items
SET total_price = ROUND(quantity_ordered * unit_price + gst_amount, 2)
WHERE ABS(total_price - (quantity_ordered * unit_price + gst_amount)) > 0.01;

-- 2) Enforce the convention going forward.
ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_total_price_consistent
  CHECK (
    ABS(total_price - (quantity_ordered * unit_price + gst_amount)) <= 0.01
  );

COMMENT ON CONSTRAINT purchase_order_items_total_price_consistent
  ON purchase_order_items IS
  'total_price stores quantity_ordered * unit_price + gst_amount (i.e., INCLUDES GST). Convention set by procurement-actions.ts createPurchaseOrder; enforced here after po-actions.ts updatePoLineItemRate was caught drifting rows. 0.01 tolerance covers NUMERIC(14,2) rounding from upstream JS math.';
