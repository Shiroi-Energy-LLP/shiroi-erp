-- ============================================================
-- Migration 093 — Drop HubSpot carve-out from proposal_total_sanity
-- File: supabase/migrations/093_drop_hubspot_carveout_from_proposal_total_sanity.sql
-- Description: Tightens the proposal_total_sanity CHECK constraint
--              from migration 091. The original carve-out
--              `OR hubspot_deal_id IS NOT NULL` was added because
--              63 HubSpot-migrated proposals had implausible totals
--              (up to ₹6125 Cr/kWp) that would have blocked the
--              ALTER TABLE. After scripts/reimport-hubspot-financials.ts
--              ran on 2026-05-02 (using the cleaned HubSpot CSV
--              export of the same date), 35 corrupted HubSpot rows
--              were reset to 0 + flagged financials_invalidated, and
--              all 144 HubSpot-linked proposals are now within the
--              ₹10L/kWp ceiling. The carve-out can be removed.
-- Date: 2026-05-02
-- Rollback: re-add the carve-out via:
--   ALTER TABLE proposals DROP CONSTRAINT proposal_total_sanity;
--   ALTER TABLE proposals ADD CONSTRAINT proposal_total_sanity
--     CHECK (total_after_discount IS NULL
--       OR system_size_kwp IS NULL
--       OR system_size_kwp = 0
--       OR total_after_discount <= system_size_kwp * 1000000
--       OR hubspot_deal_id IS NOT NULL);
-- Dependencies: 091_proposal_total_sanity_constraint.sql
-- ============================================================

BEGIN;

ALTER TABLE proposals DROP CONSTRAINT proposal_total_sanity;

ALTER TABLE proposals
  ADD CONSTRAINT proposal_total_sanity
  CHECK (
    total_after_discount IS NULL
    OR system_size_kwp IS NULL
    OR system_size_kwp = 0
    OR total_after_discount <= system_size_kwp * 1000000  -- ₹10L/kWp ceiling
  );

COMMENT ON CONSTRAINT proposal_total_sanity ON proposals IS
  'Final regression net (added 2026-04-30 after the BOM-corruption cleanup, tightened 2026-05-02 after the HubSpot re-import). Rejects total_after_discount > ₹10L/kWp on every proposal regardless of source. The importer-side soft cap is ₹5L/kWp (in scripts/excel-parser.ts and scripts/migrate-hubspot.ts), so this DB-level cap only fires on code-path regressions.';

COMMIT;
