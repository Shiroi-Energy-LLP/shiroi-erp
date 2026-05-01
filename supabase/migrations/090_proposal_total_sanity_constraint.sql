-- ============================================================
-- Migration 090 — Proposal total sanity CHECK constraint
-- File: supabase/migrations/090_proposal_total_sanity_constraint.sql
-- Description: Final regression net. Rejects any UPDATE/INSERT that
--              would set total_after_discount > ₹10L/kWp (twice the
--              importer's ₹5L threshold so importer warnings happen
--              first; this only catches code-path regressions).
-- Date: 2026-04-30
-- Rollback: ALTER TABLE proposals DROP CONSTRAINT proposal_total_sanity;
-- Dependencies: 089_reset_corrupted_proposal_financials.sql (must be
--               applied first; otherwise the constraint blocks the
--               existing corrupted rows from being reset to 0).
-- ============================================================

BEGIN;

ALTER TABLE proposals
  ADD CONSTRAINT proposal_total_sanity
  CHECK (
    total_after_discount IS NULL
    OR system_size_kwp IS NULL
    OR system_size_kwp = 0
    OR total_after_discount <= system_size_kwp * 1000000  -- ₹10L/kWp ceiling
    OR hubspot_deal_id IS NOT NULL  -- HubSpot proposals pending Tier D re-import are exempt
  );

COMMENT ON CONSTRAINT proposal_total_sanity ON proposals IS
  'Final regression net (added 2026-04-30 after the BOM-corruption cleanup). Rejects total_after_discount > ₹10L/kWp for non-HubSpot proposals. HubSpot proposals (hubspot_deal_id IS NOT NULL) are exempt until Tier D re-import corrects them.';

COMMIT;
