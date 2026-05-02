-- ============================================================
-- Migration 092 — Apply Tier B caveated recoveries (Vivek-authorised)
-- File: supabase/migrations/092_apply_tier_b_caveated_recoveries.sql
-- Description: 3 of 5 caveated Tier B candidates resolved by Vivek
--              on 2026-05-02 after manual triage:
--                - PV128/25-26 Venus Polymers: confirmed 5 kWp (was 3.3
--                  in DB), apply ₹2,93,666 + update system_size_kwp.
--                - SHIROI/PRP/2024-25/0030 Thirumala Developers: doc
--                  ref PV034/24 was a typo, doc IS the right proposal.
--                  Apply ₹3,51,747 for 4.36 kWp.
--                - PV134/25-26 Kaadosh Akkarai Site: confirmed 3 kWp
--                  (was 2.2 in DB), apply ₹2,03,001 + update
--                  system_size_kwp.
--              Skipped (Vivek's call):
--                - PV281/24 (Geeyam kalyan): different project from
--                  GRN Ambuli Srinivas. Banner only.
--                - PV279/24-25 (Arya Vysya Hospital): different from
--                  Newry Adora. Banner only.
-- Date: 2026-05-02
-- Rollback: NOT SAFE — original totals are preserved in `notes` for
--           forensic reference but the column reset cannot be undone.
-- Dependencies: 089 (data quality flags), 090b (Tier B baseline
--               recoveries — these 3 had `financials_invalidated=
--               FALSE` set by mig 090 (Tier A excluded them) and
--               were left untouched by 090b).
-- Source: scripts/data/tier-b-reextraction-results.json + Vivek's
--         decisions in chat 2026-05-02.
-- ============================================================

BEGIN;

-- 1. PV128/25-26 — Venus Polymers
--    File: Venus_polymer_5_kWp_Ongrid_Off_grid_Rev_1.docx
--    Stored: 3.3 kWp / ₹12,99,461.60   |   Doc: 5 kWp / ₹2,93,666 (on-grid option)
--    Vivek confirmed 5 kWp on-grid is correct.
UPDATE proposals
SET
  total_after_discount = 293666,
  total_before_discount = 293666,
  system_size_kwp = 5,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery + Vivek confirmation 2026-05-02] System size corrected 3.3 → 5 kWp; total recovered ₹293666 from Venus_polymer_5_kWp_Ongrid_Off_grid_Rev_1.docx (on-grid option). Pre-recovery stored: 3.3 kWp / ₹1299461.60. Off-grid alternative quote was ₹297647.',
  updated_at = NOW()
WHERE id = 'd26fb498-ac75-449c-8f7c-d7fc3775b4ad';

-- 2. SHIROI/PRP/2024-25/0030 — Thirumala Developers - Sambhavnath avenue
--    File: Thirumala_Developers_-_Sambhavnath_avenue._.docx
--    Stored: 5 kWp / ₹10,09,340.19   |   Doc: 4.36 kWp / ₹3,51,747 per unit
--    Vivek: doc reference "PV034/24" is a typo; this IS the right proposal.
UPDATE proposals
SET
  total_after_discount = 351747,
  total_before_discount = 351747,
  system_size_kwp = 4.36,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery + Vivek confirmation 2026-05-02] System size corrected 5 → 4.36 kWp; total recovered ₹351747 from Thirumala_Developers_-_Sambhavnath_avenue._.docx (single-unit price). Doc-internal ref "PV034/24" confirmed by Vivek as a typo — this IS the right proposal. Pre-recovery stored: 5 kWp / ₹1009340.19. Two-unit total in doc: ₹703493.',
  updated_at = NOW()
WHERE id = 'debbe1b3-b84f-4861-b996-36df19d55264';

-- 3. PV134/25-26 — Kaadosh Akkarai Site
--    File: kaadosh_Akkarai_3_KWp_Rev_0.docx
--    Stored: 2.2 kWp / ₹6,00,229.35   |   Doc: 3 kWp / ₹2,03,001
--    Vivek confirmed 3 kWp is correct.
UPDATE proposals
SET
  total_after_discount = 203001,
  total_before_discount = 203001,
  system_size_kwp = 3,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery + Vivek confirmation 2026-05-02] System size corrected 2.2 → 3 kWp; total recovered ₹203001 from kaadosh_Akkarai_3_KWp_Rev_0.docx. Pre-recovery stored: 2.2 kWp / ₹600229.35.',
  updated_at = NOW()
WHERE id = '6b902707-2e46-4c9e-b1df-b5e178179c61';

COMMIT;
