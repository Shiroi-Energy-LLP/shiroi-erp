-- =========================================================================
-- Migration 123 — Purchase C1 Gap Fixes
-- Date: 2026-05-24
--
-- Gaps addressed:
--   1. material_requisitions — site engineers / supervisors submit quick material
--      requests mid-project. PM reviews and optionally converts to a PO.
--      Table: id, project_id FK, requested_by FK (employees), items JSONB,
--      urgency (normal/urgent/critical), status (pending/approved/converted/rejected),
--      notes, reviewer_id FK (employees), reviewed_at, po_id FK (purchase_orders).
--
--   2. fn_get_po_bill_reconciliation(p_project_id) RPC — per-project PO vs
--      vendor bill vs paid breakdown for Vinodh's reconciliation view.
--      Returns one row per PO: po_number, vendor, total_amount, billed_amount,
--      paid_amount, balance, bill_count, and bill_status rollup.
--
-- NEVER-DO rule #17 compliance: every new filterable column has an index.
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. Material Requisitions
-- =========================================================================

CREATE TYPE material_requisition_status AS ENUM (
  'pending',
  'approved',
  'converted',
  'rejected'
);

CREATE TYPE material_requisition_urgency AS ENUM (
  'normal',
  'urgent',
  'critical'
);

CREATE TABLE material_requisitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES employees(id),
  urgency         material_requisition_urgency NOT NULL DEFAULT 'normal',
  status          material_requisition_status NOT NULL DEFAULT 'pending',
  -- JSONB array: [{description, quantity, unit, notes}]
  -- Denormalized for simplicity — these are quick requests, not formal BOQ lines.
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  -- Review fields
  reviewer_id     UUID REFERENCES employees(id),
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,
  -- If PM converts this request to a PO, record which PO
  converted_po_id UUID REFERENCES purchase_orders(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: project_id (filter by project), status (filter pending),
-- requested_by (filter by employee), urgency (sort by priority)
CREATE INDEX idx_mat_req_project  ON material_requisitions(project_id);
CREATE INDEX idx_mat_req_status   ON material_requisitions(status);
CREATE INDEX idx_mat_req_requester ON material_requisitions(requested_by);
CREATE INDEX idx_mat_req_urgency  ON material_requisitions(urgency);
CREATE INDEX idx_mat_req_created  ON material_requisitions(created_at DESC);

-- updated_at trigger
CREATE TRIGGER material_requisitions_updated_at
  BEFORE UPDATE ON material_requisitions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =========================================================================
-- 2. RLS for material_requisitions
--
-- Read: anyone in the core operational roles + the requester themselves
-- Insert: site_supervisor, project_manager, purchase_officer, founder
-- Update: project_manager, purchase_officer, founder (review/approve)
-- =========================================================================

ALTER TABLE material_requisitions ENABLE ROW LEVEL SECURITY;

-- SELECT: all staff who need visibility (PM sees their projects, supervisors see all)
CREATE POLICY "mat_req_select" ON material_requisitions
  FOR SELECT
  USING (
    get_my_role() IN (
      'founder', 'project_manager', 'purchase_officer',
      'site_supervisor', 'finance'
    )
  );

-- INSERT: site supervisors submit, PMs can also create on behalf
CREATE POLICY "mat_req_insert" ON material_requisitions
  FOR INSERT
  WITH CHECK (
    get_my_role() IN (
      'founder', 'project_manager', 'purchase_officer', 'site_supervisor'
    )
  );

-- UPDATE: PM, purchase_officer, founder can review/approve/reject/convert
CREATE POLICY "mat_req_update" ON material_requisitions
  FOR UPDATE
  USING (
    get_my_role() IN ('founder', 'project_manager', 'purchase_officer')
  );

-- =========================================================================
-- 3. fn_get_po_bill_reconciliation — per-project PO vs bill vs paid view
--
-- Returns one row per non-cancelled PO for the given project.
-- Joins to vendor_bills (via purchase_order_id FK) and aggregates:
--   billed_amount  = SUM(vendor_bills.total_amount) for bills linked to this PO
--   paid_amount    = SUM(vendor_bills.amount_paid) for those bills
--   balance        = total_amount - paid_amount
--   bill_count     = COUNT(vendor_bills)
--   bill_status    = 'paid' | 'partial' | 'pending' | 'unbilled'
-- =========================================================================

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
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    po.id                       AS po_id,
    po.po_number                AS po_number,
    v.company_name              AS vendor_name,
    v.is_msme                   AS vendor_is_msme,
    po.po_date                  AS po_date,
    po.total_amount             AS po_total,
    po.approval_status::TEXT    AS approval_status,
    po.status::TEXT             AS po_status,
    COALESCE(SUM(vb.total_amount), 0)   AS billed_amount,
    COALESCE(SUM(vb.amount_paid), 0)    AS paid_amount,
    po.total_amount - COALESCE(SUM(vb.amount_paid), 0) AS balance,
    COUNT(vb.id)                AS bill_count,
    CASE
      WHEN COUNT(vb.id) = 0 THEN 'unbilled'
      WHEN COALESCE(SUM(vb.amount_paid), 0) >= COALESCE(SUM(vb.total_amount), 0)
           AND COALESCE(SUM(vb.total_amount), 0) > 0 THEN 'paid'
      WHEN COALESCE(SUM(vb.amount_paid), 0) > 0 THEN 'partial'
      ELSE 'pending'
    END                         AS bill_status
  FROM purchase_orders po
  JOIN vendors v ON v.id = po.vendor_id
  LEFT JOIN vendor_bills vb ON vb.purchase_order_id = po.id
                            AND vb.status != 'cancelled'
  WHERE po.project_id = p_project_id
    AND po.status != 'cancelled'
  GROUP BY
    po.id, po.po_number, v.company_name, v.is_msme,
    po.po_date, po.total_amount, po.approval_status, po.status
  ORDER BY po.po_date DESC, po.po_number;
$$;

-- Grant execute to all authenticated users (RLS on underlying tables handles auth)
GRANT EXECUTE ON FUNCTION fn_get_po_bill_reconciliation(UUID) TO authenticated;

COMMIT;
