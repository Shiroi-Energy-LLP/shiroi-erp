-- =============================================================================
-- Migration 065 — Purchase v2 feedback pass
-- =============================================================================
-- Context: Post-ship feedback on v2 (migration 060 + 061 hotfix).
-- See docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md.
-- Change summary:
--   1. Add sent_to_vendor_at + sent_via_channels columns to purchase_orders.
--   2. Add generated dispatch_stage column (derived from timestamps).
--   3. Back-fill sent_to_vendor_at for already-dispatched POs.
--   4. Add fn_cascade_po_approval_to_boq + fn_cascade_po_receipt_to_boq SQL
--      helpers so approval/receipt transitions are re-usable from both server
--      actions and the existing GRN trigger.
-- =============================================================================

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS sent_to_vendor_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sent_via_channels TEXT[] NOT NULL DEFAULT '{}';

-- ─── 2. Generated dispatch_stage ─────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS dispatch_stage TEXT GENERATED ALWAYS AS (
    CASE
      WHEN acknowledged_at IS NOT NULL THEN 'received'
      WHEN vendor_tracking_number IS NOT NULL THEN 'in_transit'
      WHEN vendor_dispatch_date IS NOT NULL THEN 'shipped'
      WHEN sent_to_vendor_at IS NOT NULL THEN 'draft'
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_po_dispatch_stage
  ON purchase_orders (dispatch_stage)
  WHERE dispatch_stage IS NOT NULL;

-- ─── 3. Back-fill ────────────────────────────────────────────────────────────
UPDATE purchase_orders
   SET sent_to_vendor_at = COALESCE(dispatched_at, updated_at)
 WHERE status IN ('dispatched', 'acknowledged')
   AND sent_to_vendor_at IS NULL;

-- ─── 4. Cascade helpers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_cascade_po_approval_to_boq(p_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Competitive path: via rfq_awards → rfq_items → project_boq_items
  UPDATE project_boq_items
     SET procurement_status = 'order_placed'
   WHERE procurement_status = 'yet_to_place'
     AND id IN (
       SELECT ri.boq_item_id FROM rfq_awards a
         JOIN rfq_items ri ON ri.id = a.rfq_item_id
        WHERE a.purchase_order_id = p_po_id
     );

  -- Quick-PO path: direct purchase_order_id on project_boq_items
  UPDATE project_boq_items
     SET procurement_status = 'order_placed'
   WHERE procurement_status = 'yet_to_place'
     AND purchase_order_id = p_po_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_cascade_po_receipt_to_boq(p_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_unfinished INTEGER;
BEGIN
  SELECT project_id INTO v_project_id FROM purchase_orders WHERE id = p_po_id;
  IF v_project_id IS NULL THEN RETURN; END IF;

  -- Competitive path
  UPDATE project_boq_items
     SET procurement_status = 'received'
   WHERE procurement_status = 'order_placed'
     AND id IN (
       SELECT ri.boq_item_id FROM rfq_awards a
         JOIN rfq_items ri ON ri.id = a.rfq_item_id
        WHERE a.purchase_order_id = p_po_id
     );

  -- Quick-PO path
  UPDATE project_boq_items
     SET procurement_status = 'received'
   WHERE procurement_status = 'order_placed'
     AND purchase_order_id = p_po_id;

  -- Project-level rollup
  SELECT COUNT(*) INTO v_unfinished
    FROM project_boq_items
   WHERE project_id = v_project_id
     AND procurement_status IN ('yet_to_place', 'order_placed');

  IF v_unfinished = 0 THEN
    UPDATE projects
       SET procurement_status = 'ready_to_dispatch'
     WHERE id = v_project_id;
    UPDATE project_boq_items
       SET procurement_status = 'ready_to_dispatch'
     WHERE project_id = v_project_id
       AND procurement_status = 'received';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cascade_po_approval_to_boq(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_cascade_po_receipt_to_boq(UUID) TO authenticated;

-- =============================================================================
-- Verification
-- =============================================================================
-- After apply, run:
--   SELECT dispatch_stage, COUNT(*) FROM purchase_orders GROUP BY 1;
--   SELECT COUNT(*) FROM purchase_orders
--     WHERE sent_to_vendor_at IS NULL AND status IN ('dispatched','acknowledged');
--   -- should be 0
-- =============================================================================
