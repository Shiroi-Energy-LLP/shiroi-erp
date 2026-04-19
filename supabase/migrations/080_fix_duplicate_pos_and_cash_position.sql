-- ============================================================================
-- Migration 080 — Fix duplicate POs (Drive-BOM vs Zoho) + refresh_project_cash_position bug
-- ============================================================================
--
-- User (Vivek): "the numbers are still wrong. VAF still shows -3 cr, whereas
-- it should be profitable. same with a lot of other projects. you have not
-- found the root cause for the cash position numbers."
--
-- Root cause — TWO bugs stacked on top of each other.
--
-- Bug A. Duplicate POs from `scripts/migrate-google-drive.ts`:
--
--   Before the Zoho Books backfill (migrations 067–072), a separate Drive-BOM
--   migration pre-populated 869 `purchase_orders` rows from each project's BOM
--   (source='erp'). It auto-set them to status='fully_delivered',
--   amount_paid=total_amount, and po_date='2025-01-01' as a fallback — without
--   any real vendor_payment or vendor_bill evidence.
--
--   Then Zoho Phase 07 added 106 real POs with `ZHI/SE/*` prefixes. The Zoho
--   import was written to treat the two PO sets as separate universes ("Numbers
--   prefixed with ZHI/ to avoid collision with ERP-issued PO numbers") — but
--   for 8 projects that Zoho's project-matcher did identify, BOTH sets ended
--   up linked. Example: VAF has 30 ERP-source POs (₹1.54Cr, all fake-paid) +
--   29 Zoho-source POs (₹1.59Cr, real) — project_cash_positions sums them
--   both → total_po_value = ₹3Cr, double the truth.
--
-- Bug B. Broken `refresh_project_cash_position` function:
--
--   The trigger function computes total_invoiced via:
--       FROM customer_payments cp
--       LEFT JOIN invoices inv ON inv.id = cp.invoice_id
--       WHERE cp.project_id = v_project_id
--   This LEFT JOIN is backwards — if a project has 0 customer_payments, the
--   inner join yields 0 rows and total_invoiced = 0 even when invoices exist.
--   For VAF (3 invoices totaling ₹1.63Cr, 0 customer_payments yet imported),
--   cash_position showed total_invoiced=0. Same bug affects 10+ projects.
--
-- Combined effect on VAF:
--   - total_invoiced: 0 (Bug B)  vs real: ₹1.63Cr
--   - total_po_value: ₹3Cr (Bug A) vs real: ₹1.59Cr (Zoho POs only)
--   - net_cash_position: -₹3Cr vs real: roughly +₹1L (profitable)
--
-- Fix:
--
--   A. Delete 75 ERP-source duplicate POs on the 8 projects where Zoho has
--      authoritative data (purchase_order_items CASCADE; purge 9 artifact
--      vendor_payments first since they have no valid re-link target).
--
--   B. Rewrite refresh_project_cash_position to compute invoiced/received
--      from invoices + customer_payments independently (no LEFT JOIN trick).
--      Also prefer invoices.amount_paid over customer_payments.amount when
--      the former is populated but the latter missing (Zoho invoices carry
--      paid status without always producing customer_payment rows).
--
--   C. Force-refresh all project_cash_positions after A + B.
--
-- Out of scope (follow-ups):
--   - The 869-75=794 BOM-projection POs on 118 non-dup projects remain as
--     fake-paid projections. They don't cause immediate user-visible damage
--     (no dup sum), but their amount_paid=total is a lie. A future migration
--     should either (i) fire update_po_amount_paid for each to reset
--     amount_paid to real(=0) and show vendor outstanding, or (ii) mark
--     these POs as 'draft' status so they don't affect cash rollups.
--   - `scripts/migrate-google-drive.ts` should be retired or updated to not
--     set fully_delivered + amount_paid=total without evidence.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Pre-flight counts
-- ------------------------------------------------------------------
DO $$
DECLARE
  v_dup_projects  INT;
  v_erp_pos       INT;
  v_erp_value     NUMERIC;
  v_artifact_vps  INT;
  v_poi_rows      INT;
BEGIN
  SELECT COUNT(*) INTO v_dup_projects FROM (
    SELECT project_id FROM purchase_orders WHERE project_id IS NOT NULL
    GROUP BY project_id
    HAVING COUNT(*) FILTER (WHERE source='erp') > 0
       AND COUNT(*) FILTER (WHERE source='zoho_import') > 0
  ) x;

  SELECT COUNT(*), COALESCE(SUM(total_amount),0) INTO v_erp_pos, v_erp_value
  FROM purchase_orders po
  WHERE po.source='erp' AND po.project_id IN (
    SELECT project_id FROM purchase_orders WHERE project_id IS NOT NULL
    GROUP BY project_id
    HAVING COUNT(*) FILTER (WHERE source='erp') > 0
       AND COUNT(*) FILTER (WHERE source='zoho_import') > 0);

  SELECT COUNT(*) INTO v_artifact_vps
  FROM vendor_payments vp
  WHERE vp.purchase_order_id IN (
    SELECT id FROM purchase_orders WHERE source='erp' AND project_id IN (
      SELECT project_id FROM purchase_orders WHERE project_id IS NOT NULL
      GROUP BY project_id
      HAVING COUNT(*) FILTER (WHERE source='erp') > 0
         AND COUNT(*) FILTER (WHERE source='zoho_import') > 0));

  SELECT COUNT(*) INTO v_poi_rows
  FROM purchase_order_items poi
  WHERE poi.purchase_order_id IN (
    SELECT id FROM purchase_orders WHERE source='erp' AND project_id IN (
      SELECT project_id FROM purchase_orders WHERE project_id IS NOT NULL
      GROUP BY project_id
      HAVING COUNT(*) FILTER (WHERE source='erp') > 0
         AND COUNT(*) FILTER (WHERE source='zoho_import') > 0));

  RAISE NOTICE 'Dup projects: %, ERP POs to delete: % (₹%), artifact vendor_payments: %, POI rows: %',
    v_dup_projects, v_erp_pos, ROUND(v_erp_value, 0), v_artifact_vps, v_poi_rows;
END $$;

-- ------------------------------------------------------------------
-- 2. Delete 9 artifact vendor_payments on ERP-source dup POs
--    These were mis-linked by phase-11 fallback heuristic (see mig 079 notes)
--    to ERP-origin POs whose vendors have no matching Zoho PO on the same
--    project — no valid re-link target exists.
-- ------------------------------------------------------------------
DELETE FROM vendor_payments
WHERE purchase_order_id IN (
  SELECT id FROM purchase_orders WHERE source='erp' AND project_id IN (
    SELECT project_id FROM purchase_orders WHERE project_id IS NOT NULL
    GROUP BY project_id
    HAVING COUNT(*) FILTER (WHERE source='erp') > 0
       AND COUNT(*) FILTER (WHERE source='zoho_import') > 0));

-- ------------------------------------------------------------------
-- 3. Delete 75 ERP-source duplicate POs on dup projects
--    purchase_order_items cascades via FK.
-- ------------------------------------------------------------------
DELETE FROM purchase_orders
WHERE source='erp' AND project_id IN (
  SELECT project_id FROM purchase_orders WHERE project_id IS NOT NULL
  GROUP BY project_id
  HAVING COUNT(*) FILTER (WHERE source='erp') > 0
     AND COUNT(*) FILTER (WHERE source='zoho_import') > 0);

-- ------------------------------------------------------------------
-- 4. Fix refresh_project_cash_position — compute invoiced/received
--    independently from invoices + customer_payments.
-- ------------------------------------------------------------------
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

  -- Contracted value
  SELECT COALESCE(contracted_value, 0)
  INTO v_total_contracted
  FROM projects WHERE id = v_project_id;

  -- Invoiced: sum of invoices.total_amount for non-cancelled invoices
  SELECT COALESCE(SUM(total_amount), 0)
  INTO v_total_invoiced
  FROM invoices
  WHERE project_id = v_project_id
    AND (status IS NULL OR status <> 'cancelled');

  -- Received (preferred): sum of customer_payments for this project.
  -- Fallback: if customer_payments is empty but invoices.amount_paid carries
  -- the Zoho-side paid status, use that. This handles Zoho-imported invoices
  -- where per-payment records weren't created but the paid status is known.
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_received
  FROM customer_payments WHERE project_id = v_project_id;

  IF v_total_received = 0 THEN
    SELECT COALESCE(SUM(amount_paid), 0)
    INTO v_invoice_paid_cache
    FROM invoices
    WHERE project_id = v_project_id
      AND (status IS NULL OR status <> 'cancelled');
    v_total_received := v_invoice_paid_cache;
  END IF;

  v_total_outstanding := GREATEST(v_total_invoiced - v_total_received, 0);

  -- Vendor outflows: POs excluding cancelled
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

-- ------------------------------------------------------------------
-- 5. Force-refresh project_cash_positions for every project
--    Direct INSERT...SELECT using the same logic as the fixed function,
--    so no-op projects without a recent PO edit also get refreshed.
-- ------------------------------------------------------------------
WITH computed AS (
  SELECT
    p.id AS project_id,
    COALESCE(p.contracted_value, 0) AS total_contracted,
    COALESCE((SELECT SUM(total_amount) FROM invoices
               WHERE project_id = p.id
                 AND (status IS NULL OR status <> 'cancelled')), 0) AS total_invoiced,
    COALESCE(
      NULLIF((SELECT COALESCE(SUM(amount),0) FROM customer_payments WHERE project_id = p.id), 0),
      (SELECT COALESCE(SUM(amount_paid),0) FROM invoices
         WHERE project_id = p.id
           AND (status IS NULL OR status <> 'cancelled'))
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
  GREATEST(c.total_invoiced - c.total_received, 0) as total_outstanding,
  c.total_po_value, c.total_paid_to_vendors,
  GREATEST(c.total_po_value - c.total_paid_to_vendors, 0) as total_vendor_outstanding,
  c.total_received - c.total_paid_to_vendors as net_cash_position,
  (c.total_received - c.total_paid_to_vendors) < 0 as is_invested,
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

-- ------------------------------------------------------------------
-- 6. Verification
-- ------------------------------------------------------------------
DO $$
DECLARE
  r_vaf       RECORD;
  r_summary   RECORD;
BEGIN
  SELECT p.project_number, pcp.total_contracted, pcp.total_invoiced, pcp.total_received,
         pcp.total_po_value, pcp.total_paid_to_vendors, pcp.net_cash_position
  INTO r_vaf
  FROM project_cash_positions pcp
  JOIN projects p ON p.id = pcp.project_id
  WHERE p.project_number = 'SHIROI/PROJ/2025-26/0113';

  RAISE NOTICE '=== VAF cash_position AFTER migration 080 ===';
  RAISE NOTICE 'contracted=%, invoiced=%, received=%, po_value=%, paid_vendors=%, net=%',
    r_vaf.total_contracted, r_vaf.total_invoiced, r_vaf.total_received,
    r_vaf.total_po_value, r_vaf.total_paid_to_vendors, r_vaf.net_cash_position;

  SELECT * INTO r_summary FROM get_company_cash_summary_v2();
  RAISE NOTICE '=== Company cash summary AFTER migration 080 ===';
  RAISE NOTICE 'receivables=%, ap_bills=%, ap_pos=%, project_expenses=%, open_recon=%',
    ROUND(r_summary.total_receivables, 0),
    ROUND(r_summary.total_ap_bills, 0),
    ROUND(r_summary.total_ap_pos, 0),
    ROUND(r_summary.total_project_expenses_paid, 0),
    r_summary.open_reconciliation_count;
END $$;

COMMIT;
