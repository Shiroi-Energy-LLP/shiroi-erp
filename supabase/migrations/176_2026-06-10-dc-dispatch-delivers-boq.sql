-- =============================================================================
-- Migration 176 — DC dispatch auto-advances linked BOQ items to 'delivered'
-- Spec: docs/superpowers/specs/2026-06-10-project-module-enhancements-design.md
-- Guarded: only items currently 'ready_to_dispatch' advance; any other status
-- is left untouched. Called from submitDeliveryChallan after the DC status
-- flips draft → dispatched. Partial-qty semantics: first dispatch of a line
-- delivers it (cumulative-qty refinement deliberately deferred — see spec).
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_dc_boq_items_delivered(p_dc_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE project_boq_items b
  SET procurement_status = 'delivered'
  FROM delivery_challan_items dci
  WHERE dci.challan_id = p_dc_id
    AND dci.boq_item_id = b.id
    AND b.procurement_status = 'ready_to_dispatch';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION mark_dc_boq_items_delivered(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_dc_boq_items_delivered(UUID) TO authenticated;
