-- supabase/migrations/096_zoho_invoice_line_items.sql
-- ============================================================================
-- Migration 096 — Zoho invoice line items table
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Phase 08 of the Zoho import only stored invoice header totals. The Orphan
-- Triage UI needs line-item detail to disambiguate parent-company invoices
-- (e.g., "RAMANIYAM REAL ESTATES" → which of 8 sub-projects). This migration
-- creates the table; population happens via scripts/backfill-zoho-invoice-line-items.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS zoho_invoice_line_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  zoho_invoice_id  TEXT NOT NULL,
  line_number      INT NOT NULL,
  item_name        TEXT,
  item_description TEXT,
  quantity         NUMERIC,
  rate             NUMERIC(14,2),
  amount           NUMERIC(14,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zoho_invoice_line_items_invoice_id
  ON zoho_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_zoho_invoice_line_items_zoho_invoice_id
  ON zoho_invoice_line_items(zoho_invoice_id);

DO $$
BEGIN
  RAISE NOTICE '=== Migration 096 applied ===';
  RAISE NOTICE 'zoho_invoice_line_items table created. Backfill pending.';
END $$;

COMMIT;
