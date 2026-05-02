-- ============================================================
-- Migration 090b — Apply Tier B AI re-extraction recoveries
-- File: supabase/migrations/090b_apply_tier_b_reextractions.sql
-- Description: Restores total_after_discount for 7 proposals where
--              Claude Sonnet re-extracted a plausible per-kWp total
--              from the original docx in Supabase Storage. Source
--              data: scripts/data/tier-b-reextraction-results.json
--              (entries classified 'recoverable' without caveats).
-- Date: 2026-04-30
-- Rollback: NOT SAFE — original totals are stored in the notes
--           column for forensic reference but the column-level
--           reset cannot be undone without manual lookup.
-- Dependencies: 089_proposal_data_quality_flags.sql (provides flag
--               columns), 090 (Tier A reset must already be done so
--               these Tier B rows are not also in Tier A — verified
--               in the JSON: none of the 7 had financials_invalidated
--               applied).
-- ============================================================
--
-- The 10 excluded Tier B candidates:
--   PV128/25-26  — kWp discrepancy (doc 5 kWp vs stored 3.3 kWp)
--   PV281/24     — customer name mismatch (GRN Ambuli vs Geeyam kalyan)
--   SHIROI/PRP/2024-25/0030 — ref number mismatch (doc is PV034/24)
--   PV279/24     — customer name mismatch (Newry Adora vs Arya Vysya)
--   PV134/25-26  — kWp difference (doc 3 kWp vs stored 2.2 kWp, 26.7%)
--   PV333/24     — PDF parse error (no extraction possible)
--   SHIROI/PRP/2024-25/0233 — wrong file (50 kWp doc for 10 kWp proposal)
--   PV049/25-26  — wrong customer doc (Mr. Sankaranarayanan)
--   SE/PV/217/23 — wrong doc type (solar water heater quote)
--   SHIROI/PRP/2024-25/0072 — wrong doc (appliance inquiry list)
-- ============================================================

BEGIN;

-- 1. SE/PV/027/23 — Aavaasa Ganga — 5 kWp → ₹4,03,986
--    File: Avaasa_-_Ganga_5_kWp_Rev_0_.docx
--    Stored was ₹10,09,555.77 | Per-kWp: ₹80,797 (sane for 5 kWp)
UPDATE proposals
SET
  total_after_discount = 403986,
  total_before_discount = 403986,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹403986 recovered from Avaasa_-_Ganga_5_kWp_Rev_0_.docx via Claude re-extraction. Pre-recovery stored value was ₹1009555.77.',
  updated_at = NOW()
WHERE id = '8ee04d79-5070-4bdd-a533-bd10c0707b14';

-- 2. SE/PV/050/23 — ASJ Somu Jewellery — 12 kWp → ₹7,57,849
--    File: ASJ_Somu_Jewellery_12_kWp_Solar_Proposal_.docx
--    Stored was ₹27,61,952.53 | Per-kWp: ₹63,154 (sane for 12 kWp)
UPDATE proposals
SET
  total_after_discount = 757849,
  total_before_discount = 757849,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹757849 recovered from ASJ_Somu_Jewellery_12_kWp_Solar_Proposal_.docx via Claude re-extraction. Pre-recovery stored value was ₹2761952.53.',
  updated_at = NOW()
WHERE id = '729b573f-7202-4de0-8d44-4fc401e2786b';

-- 3. SE/PV/163/23 — Bhimas Deluxe Hotel — 50 kWp → ₹17,95,792
--    File: _Bhimas_Deluxe_Hotel_50_KWp_Rev_0.docx
--    Stored was ₹1,63,02,042.50 | Per-kWp: ₹35,916 (sane for 50 kWp commercial)
UPDATE proposals
SET
  total_after_discount = 1795792,
  total_before_discount = 1795792,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹1795792 recovered from _Bhimas_Deluxe_Hotel_50_KWp_Rev_0.docx via Claude re-extraction. Pre-recovery stored value was ₹16302042.5.',
  updated_at = NOW()
WHERE id = 'f83064bf-e251-4f00-9df6-00bb3af09dc1';

-- 4. PV138/24 — Mr. Rajkumar 4KW — 4 kWp → ₹2,74,410
--    File: Mr._Rajkumar_4kWp_.docx
--    Stored was ₹8,85,892.06 | Per-kWp: ₹68,603 (sane for 4 kWp subsidy)
UPDATE proposals
SET
  total_after_discount = 274410,
  total_before_discount = 274410,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹274410 recovered from Mr._Rajkumar_4kWp_.docx via Claude re-extraction. Pre-recovery stored value was ₹885892.06.',
  updated_at = NOW()
WHERE id = 'e0c856dc-87ac-46c2-8930-e10fb8cade1e';

-- 5. 139 — Aarthi — 4 kWp → ₹3,05,162
--    File: Copy_of_Aarthi_4kWp_139_quote.docx
--    Stored was ₹15,00,283.19 | Per-kWp: ₹76,291 (sane for 4 kWp)
UPDATE proposals
SET
  total_after_discount = 305162,
  total_before_discount = 305162,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹305162 recovered from Copy_of_Aarthi_4kWp_139_quote.docx via Claude re-extraction. Pre-recovery stored value was ₹1500283.19.',
  updated_at = NOW()
WHERE id = 'cb22b7b1-4d5f-4cf6-a72d-46e5f3bf8659';

-- 6. SE/PV/263/24 — Mr. Ganesh 7KW — 7 kWp → ₹4,00,400
--    File: Mr._Ganesh_7_KWp_.docx
--    Stored was ₹32,55,398.29 | Per-kWp: ₹57,200 (sane for 7 kWp commercial)
UPDATE proposals
SET
  total_after_discount = 400400,
  total_before_discount = 400400,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹400400 recovered from Mr._Ganesh_7_KWp_.docx via Claude re-extraction. Pre-recovery stored value was ₹3255398.29.',
  updated_at = NOW()
WHERE id = '86e76cd9-245d-4a3a-bcab-bc195e2f94f9';

-- 7. PV321/24 — Sreerosh Properties — 5 kWp → ₹2,65,465
--    File: _Sreerosh_Properties_5kWp_.docx
--    Stored was ₹11,05,211.45 | Per-kWp: ₹53,093 (sane; minimal scope price)
UPDATE proposals
SET
  total_after_discount = 265465,
  total_before_discount = 265465,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery 2026-04-30] Total ₹265465 recovered from _Sreerosh_Properties_5kWp_.docx via Claude re-extraction. Pre-recovery stored value was ₹1105211.45.',
  updated_at = NOW()
WHERE id = 'd34ac426-354a-4c4f-87fa-cd70ff02f6d6';

COMMIT;
