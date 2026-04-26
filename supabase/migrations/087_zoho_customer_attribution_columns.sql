-- ============================================================================
-- Migration 087 — Zoho customer attribution columns + project_cash_positions refresh
-- ============================================================================
--
-- Vivek (Apr 26 2026): "The net position is negative in a lot of projects.
-- This is not right."
--
-- Root cause: 324 of 481 zoho_import invoices (₹64.3 Cr) and 715 of 1078
-- zoho_import customer_payments (₹59.1 Cr) had NULL project_id. Phase 08
-- attributes only via Zoho Project ID/Name (not customer); Phase 09 inherits
-- from invoice. So when a Zoho invoice lacks a project tag (common for older
-- invoices and any invoice issued at the parent-customer level rather than
-- per-project), the entire customer cash trail goes orphaned. Per-project
-- cash positions then show only the vendor-payment side, surfacing artificial
-- negatives — primarily on completed deals.
--
-- Fix (multi-part):
--
-- 1. SCHEMA (this migration §1):
--    Add zoho_customer_id and zoho_customer_name columns to invoices and
--    customer_payments. Phase 08/09 import scripts now populate these so
--    future re-imports retain customer identity even when project tagging
--    is missing in Zoho. Indexed for lookup.
--
-- 2. DATA (one-time TS script — `scripts/backfill-zoho-customer-attribution.ts`):
--    Reads Invoice.xls and Customer_Payment.xls, then attributes invoices/
--    payments to ERP projects via:
--      a. Exact normalized customer-name match
--      b. Subset match — ERP customer's meaningful tokens ⊆ Zoho customer's
--         tokens (catches "VAF" ⊂ "VAF DEF-AERO SYSTEMS PVT LTD")
--    Conservative 1:1 rule: never attributes when multiple ERP projects could
--    fit (e.g., parent companies like "RAMANIYAM REAL ESTATES PVT LTD" with
--    8+ Ramaniyam sub-projects in ERP). Generic ERP customer names (those
--    whose meaningful tokens are a strict subset of another ERP customer's)
--    are excluded from subset matches to prevent false attribution to a
--    parent-style placeholder project.
--
--    Also populates the new zoho_customer_id/zoho_customer_name columns on
--    every existing zoho_import row from the XLS, so the disambiguation data
--    survives without re-reading the XLS.
--
--    Run on prod with:
--      pnpm tsx scripts/backfill-zoho-customer-attribution.ts --apply
--    Idempotent: only touches rows with project_id IS NULL AND
--    source='zoho_import'.
--
-- 3. REFRESH (this migration §2):
--    Force-refresh `project_cash_positions` for every project, since the
--    trigger only fires on insert/update events and several projects had
--    stale rows from before the backfill.
--
-- Result on dev (after script + this migration):
--   - 21 invoices attributed (₹0.74 Cr)
--   - 50 payments cascaded via invoice (₹0.72 Cr)
--   - 6 advance/orphan payments attributed via direct customer name (₹0.05 Cr)
--   - 16 projects' cash positions changed
--   - Worst-case example: VAF Aero went from −₹3 Cr (mig 080 era) to +₹47 L
--     once 4 of its parent-named invoices (₹31 L total) attributed correctly
--   - Sheela Green flipped from −₹15K to +₹1.3L
--
-- Remaining un-attributed: 303 invoices / ~₹63 Cr — these are parent-company
-- invoices ("LANCOR HOLDINGS LIMITED" → 12+ Lancor projects in ERP, etc.)
-- where attribution is fundamentally ambiguous without manual disambiguation.
-- Tracked as a follow-up; would benefit from a UI for Vivek to map orphan
-- invoices to specific projects (or a Customer ID column on Zoho projects).
--
-- Side-effect: the bulk refresh exposed previously-stale "completed" projects
-- where vendors were paid but no customer invoice exists in Zoho (cash deals,
-- bundled-into-parent invoices, or written-off projects). Negative-project
-- count went from 16 → 41 on dev — the new 25 are a more accurate picture
-- of cash holes that were hidden by stale data, not new bugs introduced.

BEGIN;

-- 1. Schema columns for forward-compat
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS zoho_customer_id   TEXT,
  ADD COLUMN IF NOT EXISTS zoho_customer_name TEXT;

ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS zoho_customer_id   TEXT,
  ADD COLUMN IF NOT EXISTS zoho_customer_name TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_zoho_customer_id
  ON invoices(zoho_customer_id) WHERE zoho_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_zoho_customer_name
  ON invoices(zoho_customer_name) WHERE zoho_customer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_zoho_customer_id
  ON customer_payments(zoho_customer_id) WHERE zoho_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_zoho_customer_name
  ON customer_payments(zoho_customer_name) WHERE zoho_customer_name IS NOT NULL;

-- 2. Force-refresh project_cash_positions for every project, since the
--    backfill script's UPDATEs only fire the trigger for the affected rows
--    and several projects need a fresh recompute regardless.
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

-- 3. Verification
DO $$
DECLARE
  r_total INT;
  r_neg   INT;
  r_pos   INT;
  r_zero  INT;
  r_summed_neg NUMERIC;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE net_cash_position < 0),
         COUNT(*) FILTER (WHERE net_cash_position = 0),
         COUNT(*) FILTER (WHERE net_cash_position > 0),
         COALESCE(SUM(CASE WHEN net_cash_position < 0 THEN net_cash_position END), 0)
  INTO r_total, r_neg, r_zero, r_pos, r_summed_neg
  FROM project_cash_positions;

  RAISE NOTICE '=== AFTER migration 087 ===';
  RAISE NOTICE 'Total projects: %, negative: %, zero: %, positive: %',
    r_total, r_neg, r_zero, r_pos;
  RAISE NOTICE 'Total invested capital (sum of negatives): ₹%',
    ROUND(r_summed_neg, 0);
END $$;

COMMIT;
