-- ============================================================
-- Migration 088 — Proposal data quality flags
-- File: supabase/migrations/088_proposal_data_quality_flags.sql
-- Description: Adds two boolean flags + audit metadata for the
--              one-time financial-corruption cleanup, and for any
--              future regression detection.
-- Date: 2026-04-30
-- Rollback:
--   ALTER TABLE proposals
--     DROP COLUMN IF EXISTS financials_invalidated,
--     DROP COLUMN IF EXISTS financials_invalidated_at,
--     DROP COLUMN IF EXISTS financials_invalidated_reason,
--     DROP COLUMN IF EXISTS system_size_uncertain;
--   DROP INDEX IF EXISTS idx_proposals_financials_invalidated;
--   DROP INDEX IF EXISTS idx_proposals_system_size_uncertain;
-- Dependencies: 003a_proposals_core.sql
-- ============================================================

BEGIN;

ALTER TABLE proposals
  ADD COLUMN financials_invalidated         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN financials_invalidated_at      TIMESTAMPTZ,
  ADD COLUMN financials_invalidated_reason  TEXT,
  ADD COLUMN system_size_uncertain          BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_proposals_financials_invalidated
  ON proposals(financials_invalidated)
  WHERE financials_invalidated = TRUE;

CREATE INDEX idx_proposals_system_size_uncertain
  ON proposals(system_size_uncertain)
  WHERE system_size_uncertain = TRUE;

COMMENT ON COLUMN proposals.financials_invalidated IS
  'Set to TRUE when migration 089 reset the financial fields after detecting corruption (per-kWp > ₹2L confident or > ₹5L doubtful). Cleared when a fresh quote/import populates valid numbers.';

COMMENT ON COLUMN proposals.system_size_uncertain IS
  'Set to TRUE when system_size_kwp could not be corroborated against lead.estimated_size_kwp or projects.system_size_kwp at the time of migration 089. The kWp itself needs verification, not just the price.';

COMMIT;
