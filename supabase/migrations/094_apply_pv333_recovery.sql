-- ============================================================
-- Migration 094 — Apply PV333/24 (Mr. Lakshman) recovery
-- File: supabase/migrations/094_apply_pv333_recovery.sql
-- Description: PV333/24 was the only Tier B candidate that hit a
--              pdf-parse v1 interop bug during the 2026-04-30
--              re-extraction pass. After commit 5d8fa42 swapped
--              both re-extract scripts to the v2 PDFParse class
--              API, scripts/retry-pv333-pdf-extract.ts ran cleanly
--              and recovered the proposal total directly from
--              storage/.../Mr._Lakshman_3.78kWp_138.78_quote.pdf.
--              Doc explicitly states:
--                "Total investment for your solar system is Rs 3,00,346/-"
--                "System size 3.78 kWp ... 3.78 KW on Grid Inverter"
--              Per-kWp: ₹79,456 — sane.
-- Date: 2026-05-02
-- Rollback: NOT SAFE — original total preserved in `notes` for
--           forensic reference but column reset cannot be undone.
-- Dependencies: 089 (data quality flags). PV333 was excluded from
--               the Tier A reset (mig 090) because it stayed below
--               the doubtful-kWp ₹5L/kWp threshold (it was at
--               ₹3.01L/kWp), so it had financials_invalidated=FALSE
--               at that point.
-- ============================================================

BEGIN;

UPDATE proposals
SET
  total_after_discount = 300346,
  total_before_discount = 300346,
  notes = COALESCE(notes || E'\n', '') || '[AI recovery via pdf-parse v2 retry, 2026-05-02] Total recovered from Mr._Lakshman_3.78kWp_138.78_quote.pdf — doc states "Total investment for your solar system is Rs 3,00,346/-" for 3.78 kWp (₹79456/kWp, sane). Pre-recovery stored: ₹1137892.66 (₹3.01L/kWp, implausible). The original 2026-04-30 Tier B pass had a pdf-parse v1 interop bug; v2 class-based API works.',
  updated_at = NOW()
WHERE id = 'b658402c-1dae-43a6-a6bd-1c5a2cc60132';

COMMIT;
