-- supabase/migrations/089_attribution_status_columns.sql
-- ============================================================================
-- Migration 089 — attribution_status + excluded_from_cash columns
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Adds the two state-tracking columns the Orphan Triage UI needs on both
-- invoices and customer_payments. Seeds attribution_status for rows that
-- mig 087 already attributed.

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS excluded_from_cash BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','assigned','excluded','deferred'));

ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS excluded_from_cash BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','assigned','excluded','deferred'));

CREATE INDEX IF NOT EXISTS idx_invoices_attribution_status
  ON invoices(attribution_status) WHERE source = 'zoho_import';
CREATE INDEX IF NOT EXISTS idx_customer_payments_attribution_status
  ON customer_payments(attribution_status) WHERE source = 'zoho_import';

-- Seed: mig 087's already-attributed rows go straight to 'assigned'.
UPDATE invoices
   SET attribution_status = 'assigned'
 WHERE source = 'zoho_import' AND project_id IS NOT NULL;

UPDATE customer_payments
   SET attribution_status = 'assigned'
 WHERE source = 'zoho_import' AND project_id IS NOT NULL;

DO $$
DECLARE
  inv_pending INT;
  inv_assigned INT;
  pay_pending INT;
  pay_assigned INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE attribution_status = 'pending'),
         COUNT(*) FILTER (WHERE attribution_status = 'assigned')
    INTO inv_pending, inv_assigned
    FROM invoices WHERE source = 'zoho_import';
  SELECT COUNT(*) FILTER (WHERE attribution_status = 'pending'),
         COUNT(*) FILTER (WHERE attribution_status = 'assigned')
    INTO pay_pending, pay_assigned
    FROM customer_payments WHERE source = 'zoho_import';
  RAISE NOTICE '=== Migration 089 applied ===';
  RAISE NOTICE 'Invoices: pending=%, assigned=%', inv_pending, inv_assigned;
  RAISE NOTICE 'Payments: pending=%, assigned=%', pay_pending, pay_assigned;
END $$;

COMMIT;
