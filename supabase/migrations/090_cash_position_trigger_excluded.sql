-- supabase/migrations/090_cash_position_trigger_excluded.sql
-- ============================================================================
-- Migration 090 — Cash position trigger filters excluded_from_cash rows
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- The trigger function from mig 080 (`refresh_project_cash_position`) sums
-- invoices and customer_payments per project. After mig 089 added
-- excluded_from_cash, the trigger needs to skip rows where that flag is TRUE
-- so MEGAGRID-style "no ERP match" decisions don't pollute any project's
-- cash position.
--
-- This migration:
--   1. Replaces refresh_project_cash_position() with the same body PLUS
--      `excluded_from_cash IS NOT TRUE` filters on the 3 invoice / payment
--      subqueries (purchase_orders don't have the column — left untouched).
--   2. Runs a one-shot bulk recompute of `project_cash_positions` for every
--      project so the new filter logic is reflected immediately. Behaviour
--      should be identical to pre-migration (no rows excluded yet) — counts
--      should match the post-mig-087 baseline.

BEGIN;

-- 1. Trigger function — same as mig 080 + excluded_from_cash filter on
--    invoice and customer_payments aggregations.
CREATE OR REPLACE FUNCTION public.refresh_project_cash_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_project_id          UUID;
  v_total_contracted    NUMERIC(14,2) := 0;
  v_total_invoiced      NUMERIC(14,2) := 0;
  v_total_received      NUMERIC(14,2) := 0;
  v_invoice_paid_cache  NUMERIC(14,2) := 0;
  v_total_outstanding   NUMERIC(14,2) := 0;
  v_total_po_value      NUMERIC(14,2) := 0;
  v_total_paid_vendors  NUMERIC(14,2) := 0;
  v_total_vendor_out    NUMERIC(14,2) := 0;
  v_net_position        NUMERIC(14,2) := 0;
BEGIN
  IF TG_TABLE_NAME IN ('customer_payments','purchase_orders','invoices','vendor_payments') THEN
    v_project_id := NEW.project_id;
  END IF;

  IF v_project_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(contracted_value, 0)
  INTO v_total_contracted
  FROM projects WHERE id = v_project_id;

  SELECT COALESCE(SUM(total_amount), 0)
  INTO v_total_invoiced
  FROM invoices
  WHERE project_id = v_project_id
    AND (status IS NULL OR status <> 'cancelled')
    AND excluded_from_cash IS NOT TRUE;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_received
  FROM customer_payments
  WHERE project_id = v_project_id
    AND excluded_from_cash IS NOT TRUE;

  IF v_total_received = 0 THEN
    SELECT COALESCE(SUM(amount_paid), 0)
    INTO v_invoice_paid_cache
    FROM invoices
    WHERE project_id = v_project_id
      AND (status IS NULL OR status <> 'cancelled')
      AND excluded_from_cash IS NOT TRUE;
    v_total_received := v_invoice_paid_cache;
  END IF;

  v_total_outstanding := GREATEST(v_total_invoiced - v_total_received, 0);

  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(amount_paid), 0)
  INTO v_total_po_value, v_total_paid_vendors
  FROM purchase_orders
  WHERE project_id = v_project_id
    AND status NOT IN ('cancelled');

  v_total_vendor_out := GREATEST(v_total_po_value - v_total_paid_vendors, 0);
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
    total_vendor_outstanding= EXCLUDED.total_vendor_outstanding,
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
$function$;

-- 2. Bulk recompute project_cash_positions for every project, so the new
--    filter is reflected. Mirrors mig 087 §2 with the excluded_from_cash
--    filter added on the invoice / customer_payments subqueries.
WITH computed AS (
  SELECT
    p.id AS project_id,
    COALESCE(p.contracted_value, 0) AS total_contracted,
    COALESCE((SELECT SUM(total_amount) FROM invoices
               WHERE project_id = p.id
                 AND (status IS NULL OR status <> 'cancelled')
                 AND excluded_from_cash IS NOT TRUE), 0) AS total_invoiced,
    COALESCE(
      NULLIF((SELECT COALESCE(SUM(amount), 0) FROM customer_payments
                WHERE project_id = p.id
                  AND excluded_from_cash IS NOT TRUE), 0),
      (SELECT COALESCE(SUM(amount_paid), 0) FROM invoices
         WHERE project_id = p.id
           AND (status IS NULL OR status <> 'cancelled')
           AND excluded_from_cash IS NOT TRUE)
    ) AS total_received,
    COALESCE((SELECT SUM(total_amount) FROM purchase_orders
               WHERE project_id = p.id AND status NOT IN ('cancelled')), 0) AS total_po_value,
    COALESCE((SELECT SUM(amount_paid) FROM purchase_orders
               WHERE project_id = p.id AND status NOT IN ('cancelled')), 0) AS total_paid_to_vendors
  FROM projects p
)
INSERT INTO project_cash_positions (
  project_id, total_contracted,
  total_invoiced, total_received, total_outstanding,
  total_po_value, total_paid_to_vendors, total_vendor_outstanding,
  net_cash_position, is_invested, invested_since, last_computed_at
)
SELECT
  c.project_id, c.total_contracted,
  c.total_invoiced, c.total_received,
  GREATEST(c.total_invoiced - c.total_received, 0),
  c.total_po_value, c.total_paid_to_vendors,
  GREATEST(c.total_po_value - c.total_paid_to_vendors, 0),
  c.total_received - c.total_paid_to_vendors,
  (c.total_received - c.total_paid_to_vendors) < 0,
  CASE WHEN (c.total_received - c.total_paid_to_vendors) < 0 THEN CURRENT_DATE ELSE NULL END,
  NOW()
FROM computed c
ON CONFLICT (project_id)
DO UPDATE SET
  total_contracted        = EXCLUDED.total_contracted,
  total_invoiced          = EXCLUDED.total_invoiced,
  total_received          = EXCLUDED.total_received,
  total_outstanding       = EXCLUDED.total_outstanding,
  total_po_value          = EXCLUDED.total_po_value,
  total_paid_to_vendors   = EXCLUDED.total_paid_to_vendors,
  total_vendor_outstanding= EXCLUDED.total_vendor_outstanding,
  net_cash_position       = EXCLUDED.net_cash_position,
  is_invested             = EXCLUDED.is_invested,
  invested_since          = CASE
    WHEN EXCLUDED.is_invested THEN
      COALESCE(project_cash_positions.invested_since, CURRENT_DATE)
    ELSE NULL
  END,
  last_computed_at        = NOW(),
  updated_at              = NOW();

-- 3. Verification
DO $$
DECLARE
  total_proj INT; neg INT; pos INT; zero_ INT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE net_cash_position < 0),
         COUNT(*) FILTER (WHERE net_cash_position > 0),
         COUNT(*) FILTER (WHERE net_cash_position = 0)
    INTO total_proj, neg, pos, zero_
    FROM project_cash_positions;
  RAISE NOTICE '=== Migration 090 applied ===';
  RAISE NOTICE 'Total: %, negative: %, positive: %, zero: %',
    total_proj, neg, pos, zero_;
END $$;

COMMIT;
