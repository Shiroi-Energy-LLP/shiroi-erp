-- ============================================================
-- Migration 007e — Trigger Fixes
-- File: supabase/migrations/007e_trigger_fixes.sql
-- Description: Fix CEIG block trigger (wrong column reference).
--              Fix cash position trigger (missing total_contracted).
--              Add om_visit_corrections table (Tier 2 undo for O&M).
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS om_visit_corrections CASCADE;
--   -- Then recreate original trigger functions.
-- Dependencies: 005d_om.sql, 006c_audit_triggers.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Fix CEIG block trigger
-- Original used ceig_cleared which doesn't exist on the table.
-- Correct column is ceig_status.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_ceig_block()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ceig_required = TRUE
    AND NEW.ceig_status != 'approved'
    AND NEW.discom_status NOT IN ('pending', 'not_started')
    AND OLD.discom_status = 'pending'
  THEN
    RAISE EXCEPTION
      'CEIG clearance required before TNEB submission. '
      'ceig_status must be approved before discom_status can advance. '
      'Project: %', NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- 2. Fix refresh_project_cash_position trigger
-- Original missed total_contracted — snapshot showed ₹0 contracted.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_project_cash_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id          UUID;
  v_total_contracted    NUMERIC(14,2) := 0;
  v_total_received      NUMERIC(14,2) := 0;
  v_total_invoiced      NUMERIC(14,2) := 0;
  v_total_outstanding   NUMERIC(14,2) := 0;
  v_total_po_value      NUMERIC(14,2) := 0;
  v_total_paid_vendors  NUMERIC(14,2) := 0;
  v_total_vendor_out    NUMERIC(14,2) := 0;
  v_net_position        NUMERIC(14,2) := 0;
BEGIN
  IF TG_TABLE_NAME = 'customer_payments' THEN
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'vendor_payments' THEN
    v_project_id := NEW.project_id;
  END IF;

  -- Contracted value from project
  SELECT COALESCE(contracted_value, 0)
  INTO v_total_contracted
  FROM projects WHERE id = v_project_id;

  -- Inflows from customer
  SELECT
    COALESCE(SUM(cp.amount), 0),
    COALESCE(SUM(inv.total_amount), 0)
  INTO v_total_received, v_total_invoiced
  FROM customer_payments cp
  LEFT JOIN invoices inv ON inv.id = cp.invoice_id
  WHERE cp.project_id = v_project_id;

  v_total_outstanding := v_total_invoiced - v_total_received;

  -- Outflows to vendors
  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(amount_paid), 0)
  INTO v_total_po_value, v_total_paid_vendors
  FROM purchase_orders
  WHERE project_id = v_project_id
    AND status NOT IN ('cancelled');

  v_total_vendor_out := v_total_po_value - v_total_paid_vendors;
  v_net_position     := v_total_received - v_total_paid_vendors;

  INSERT INTO project_cash_positions (
    project_id,
    total_contracted,
    total_invoiced, total_received, total_outstanding,
    total_po_value, total_paid_to_vendors, total_vendor_outstanding,
    net_cash_position, is_invested,
    invested_since,
    last_computed_at
  )
  VALUES (
    v_project_id,
    v_total_contracted,
    v_total_invoiced, v_total_received, v_total_outstanding,
    v_total_po_value, v_total_paid_vendors, v_total_vendor_out,
    v_net_position,
    v_net_position < 0,
    CASE WHEN v_net_position < 0 THEN CURRENT_DATE ELSE NULL END,
    NOW()
  )
  ON CONFLICT (project_id)
  DO UPDATE SET
    total_contracted        = EXCLUDED.total_contracted,
    total_invoiced          = EXCLUDED.total_invoiced,
    total_received          = EXCLUDED.total_received,
    total_outstanding       = EXCLUDED.total_outstanding,
    total_po_value          = EXCLUDED.total_po_value,
    total_paid_to_vendors   = EXCLUDED.total_paid_to_vendors,
    total_vendor_outstanding = EXCLUDED.total_vendor_outstanding,
    net_cash_position       = EXCLUDED.net_cash_position,
    is_invested             = EXCLUDED.is_invested,
    invested_since          = CASE
      WHEN EXCLUDED.is_invested = TRUE
        AND project_cash_positions.invested_since IS NULL
      THEN CURRENT_DATE
      WHEN EXCLUDED.is_invested = FALSE
      THEN NULL
      ELSE project_cash_positions.invested_since
    END,
    last_computed_at        = NOW(),
    updated_at              = NOW();

  RETURN NEW;
END;
$$;

-- Add vendor_payments to the cash position trigger set
CREATE TRIGGER trigger_refresh_cash_position_vendor
  AFTER INSERT ON vendor_payments
  FOR EACH ROW EXECUTE FUNCTION refresh_project_cash_position();


-- ------------------------------------------------------------
-- 3. om_visit_corrections
-- Tier 2 correction model for locked O&M visit reports.
-- Mirrors site_report_corrections exactly.
-- Created when >48h has passed and a correction is needed.
-- Manager must approve. Original flagged has_correction = TRUE.
-- ------------------------------------------------------------
CREATE TABLE om_visit_corrections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_report_id    UUID NOT NULL REFERENCES om_visit_reports(id) ON DELETE RESTRICT,
  project_id            UUID NOT NULL REFERENCES projects(id),
  contract_id           UUID REFERENCES om_contracts(id),
  requested_by          UUID NOT NULL REFERENCES employees(id),
  approved_by           UUID REFERENCES employees(id),

  field_corrected       TEXT NOT NULL,
  -- Which field was wrong. e.g. 'ir_test_result_mohm', 'system_condition'
  original_value        TEXT NOT NULL,
  corrected_value       TEXT NOT NULL,
  correction_reason     TEXT NOT NULL,
  -- Mandatory. Cannot be blank.

  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected'
  )),
  approved_at           TIMESTAMPTZ,
  rejected_reason       TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER om_visit_corrections_updated_at
  BEFORE UPDATE ON om_visit_corrections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_om_corrections_report   ON om_visit_corrections(original_report_id);
CREATE INDEX idx_om_corrections_project  ON om_visit_corrections(project_id);
CREATE INDEX idx_om_corrections_pending  ON om_visit_corrections(status)
  WHERE status = 'pending';

ALTER TABLE om_visit_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "om_corrections_read"
  ON om_visit_corrections FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
    OR requested_by = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "om_corrections_insert"
  ON om_visit_corrections FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

CREATE POLICY "om_corrections_update"
  ON om_visit_corrections FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

COMMIT;