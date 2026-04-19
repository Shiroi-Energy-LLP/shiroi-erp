-- ============================================================================
-- Migration 081 — Cancel fabricated Drive-BOM POs (follow-up to 080)
-- ============================================================================
--
-- Context: Migration 080 only removed 75 Drive-BOM POs on 8 projects where
-- they overlapped with Zoho-imported POs. On the remaining 115 projects,
-- 775 Drive-BOM POs still exist and each has `amount_paid = total_amount`
-- (fabricated by `scripts/migrate-google-drive.ts` — no real payment evidence).
-- Example damage after mig 080: Radiance Flourish -₹75L, Hindu School -₹54L,
-- Prestige Hill Crest -₹31L — all driven by fake "fully paid" POs hiding as
-- real vendor outflows in `project_cash_positions`.
--
-- Root cause in the migration script (`scripts/migrate-google-drive.ts` line
-- 1384-1442): it created POs from BOM data with `status='fully_delivered'`
-- and `amount_paid=total_amount` as a stopgap to get *some* vendor data into
-- the ERP before the Zoho Books backfill shipped. Vivek's Apr-18 review
-- ("the numbers are still wrong — VAF shows -3cr whereas it should be
-- profitable, same with a lot of other projects") is the pushback on that
-- stopgap: the fake-paid rows inflate vendor outflow on every project that
-- has BOM data but no real Zoho PO match.
--
-- 775 Drive-BOM POs x `amount_paid=total` = ₹5.41Cr of pretend vendor
-- payments sitting on top of real Zoho data.
--
-- Approach — SOFT CANCEL, don't delete:
--
-- 1. UPDATE 775 POs: status='cancelled', amount_paid=0,
--    amount_outstanding=total_amount.
--    - `refresh_project_cash_position` filters `status NOT IN ('cancelled')`,
--      so these stop contributing to total_po_value / total_paid_to_vendors.
--    - FKs preserved; 2167 purchase_order_items stay intact (BOM history
--      retained for reference); 57 mis-linked Zoho vendor_payments
--      (₹98.49L total) keep their purchase_order_id pointing to these
--      cancelled POs, which satisfies the `vendor_payments_has_link` CHECK.
--    - These 57 payments are real money paid out per Zoho, but with no
--      valid project/vendor_bill target on this side. Preserving them
--      lets us re-attribute later from Zoho's per-bill allocation export
--      (see follow-up note in mig 079).
--
-- 2. Force-refresh `project_cash_positions` for every project using the
--    (now fixed, per mig 080) logic.
--
-- 3. Verification — print VAF + 3 previously-broken projects + company
--    summary.
--
-- Follow-ups (still not in this migration):
--   - `scripts/migrate-google-drive.ts` should be retired or its auto-PO
--     logic removed; keeping it as-is risks re-introducing fake-paid POs
--     on the next run.
--   - Re-import Zoho vendor_payments with per-bill allocation so the 57
--     cancelled-PO-linked payments can be reattached to real bills.

BEGIN;

-- 1. Pre-flight counts
DO $$
DECLARE
  v_drive_pos       INT;
  v_drive_value     NUMERIC;
  v_poi             INT;
  v_orphan_vps      INT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(total_amount),0)
  INTO v_drive_pos, v_drive_value
  FROM purchase_orders
  WHERE notes LIKE 'Migrated from Google Drive:%';

  SELECT COUNT(*) INTO v_poi
  FROM purchase_order_items
  WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE notes LIKE 'Migrated from Google Drive:%');

  SELECT COUNT(*) INTO v_orphan_vps
  FROM vendor_payments
  WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE notes LIKE 'Migrated from Google Drive:%');

  RAISE NOTICE 'Drive-BOM POs: %, value %, POI rows kept: %, mis-linked vendor_payments retained: %',
    v_drive_pos, ROUND(v_drive_value,0), v_poi, v_orphan_vps;
END $$;

-- 2. Soft-cancel Drive-BOM POs
UPDATE purchase_orders
SET
  status             = 'cancelled',
  amount_paid        = 0,
  amount_outstanding = total_amount,
  updated_at         = NOW()
WHERE notes LIKE 'Migrated from Google Drive:%';

-- 3. Force-refresh project_cash_positions using the same logic as mig 080 §5
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

-- 4. Verification
DO $$
DECLARE
  r_vaf        RECORD;
  r_radiance   RECORD;
  r_prestige   RECORD;
  r_summary    RECORD;
  v_neg_count  INT;
BEGIN
  SELECT p.project_number, pcp.total_invoiced, pcp.total_received,
         pcp.total_po_value, pcp.total_paid_to_vendors, pcp.net_cash_position
  INTO r_vaf
  FROM project_cash_positions pcp
  JOIN projects p ON p.id = pcp.project_id
  WHERE p.project_number = 'SHIROI/PROJ/2025-26/0113';

  SELECT p.project_number, pcp.total_invoiced, pcp.total_po_value,
         pcp.total_paid_to_vendors, pcp.net_cash_position
  INTO r_radiance
  FROM project_cash_positions pcp
  JOIN projects p ON p.id = pcp.project_id
  WHERE p.project_number = 'SHIROI/PROJ/2024-25/0028';

  SELECT p.project_number, pcp.total_invoiced, pcp.total_po_value,
         pcp.total_paid_to_vendors, pcp.net_cash_position
  INTO r_prestige
  FROM project_cash_positions pcp
  JOIN projects p ON p.id = pcp.project_id
  WHERE p.project_number = 'SHIROI/PROJ/2025-26/0086';

  SELECT * INTO r_summary FROM get_company_cash_summary_v2();

  SELECT COUNT(*) INTO v_neg_count
  FROM project_cash_positions WHERE net_cash_position < -100000;

  RAISE NOTICE '=== AFTER migration 081 ===';
  RAISE NOTICE 'VAF:       invoiced=%, received=%, po=%, paid_vendors=%, NET=%',
    r_vaf.total_invoiced, r_vaf.total_received, r_vaf.total_po_value,
    r_vaf.total_paid_to_vendors, r_vaf.net_cash_position;
  RAISE NOTICE 'Radiance:  invoiced=%, po=%, paid_vendors=%, NET=%',
    r_radiance.total_invoiced, r_radiance.total_po_value,
    r_radiance.total_paid_to_vendors, r_radiance.net_cash_position;
  RAISE NOTICE 'Prestige:  invoiced=%, po=%, paid_vendors=%, NET=%',
    r_prestige.total_invoiced, r_prestige.total_po_value,
    r_prestige.total_paid_to_vendors, r_prestige.net_cash_position;
  RAISE NOTICE 'Company:   receivables=%, ap_bills=%, ap_pos=%',
    ROUND(r_summary.total_receivables,0),
    ROUND(r_summary.total_ap_bills,0),
    ROUND(r_summary.total_ap_pos,0);
  RAISE NOTICE 'Projects remaining with net < -1L: %', v_neg_count;
END $$;

COMMIT;
