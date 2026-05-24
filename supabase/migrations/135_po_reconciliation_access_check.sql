-- Migration 135: Add access check to fn_get_po_bill_reconciliation
-- See docs/reviews/2026-05-24-comprehensive-review.md (Phase C-purchase finding #4).
--
-- The RPC is SECURITY DEFINER and bypasses RLS — without an explicit role check
-- in the function body, any authenticated user can read any project's PO/bill/
-- payment totals by URL-guessing the project id.

CREATE OR REPLACE FUNCTION fn_get_po_bill_reconciliation(p_project_id UUID)
RETURNS TABLE (
  po_id            UUID,
  po_number        TEXT,
  vendor_name      TEXT,
  vendor_is_msme   BOOLEAN,
  po_date          DATE,
  po_total         NUMERIC(14,2),
  approval_status  TEXT,
  po_status        TEXT,
  billed_amount    NUMERIC(14,2),
  paid_amount      NUMERIC(14,2),
  balance          NUMERIC(14,2),
  bill_count       BIGINT,
  bill_status      TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Role gate: finance + founder + project_manager + purchase_officer.
  -- Other roles cannot see project-level vendor financials.
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL
     OR v_role NOT IN ('founder', 'finance', 'project_manager', 'purchase_officer') THEN
    RAISE EXCEPTION 'Not authorised to read PO/bill reconciliation';
  END IF;

  RETURN QUERY
  SELECT
    po.id                       AS po_id,
    po.po_number                AS po_number,
    v.company_name              AS vendor_name,
    v.is_msme                   AS vendor_is_msme,
    po.po_date                  AS po_date,
    po.total_amount             AS po_total,
    po.approval_status::TEXT    AS approval_status,
    po.status::TEXT             AS po_status,
    COALESCE(SUM(vb.total_amount), 0)::NUMERIC(14,2)  AS billed_amount,
    COALESCE(SUM(vb.amount_paid), 0)::NUMERIC(14,2)   AS paid_amount,
    (po.total_amount - COALESCE(SUM(vb.amount_paid), 0))::NUMERIC(14,2) AS balance,
    COUNT(vb.id)                                       AS bill_count,
    CASE
      WHEN COUNT(vb.id) = 0 THEN 'unbilled'
      WHEN COALESCE(SUM(vb.amount_paid), 0) >= COALESCE(SUM(vb.total_amount), 0) THEN 'paid'
      WHEN COALESCE(SUM(vb.amount_paid), 0) > 0 THEN 'partial'
      ELSE 'pending'
    END AS bill_status
  FROM purchase_orders po
  LEFT JOIN vendors v ON v.id = po.vendor_id
  LEFT JOIN vendor_bills vb ON vb.purchase_order_id = po.id
  WHERE po.project_id = p_project_id
  GROUP BY po.id, po.po_number, v.company_name, v.is_msme, po.po_date,
           po.total_amount, po.approval_status, po.status
  ORDER BY po.po_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_po_bill_reconciliation(UUID) TO authenticated;
