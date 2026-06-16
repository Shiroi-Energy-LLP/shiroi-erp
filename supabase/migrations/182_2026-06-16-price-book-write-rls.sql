-- =============================================================================
-- Migration 182 — Price Book write RLS includes project_manager
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
--
-- price_book_write (mig 052) allowed founder/sales_engineer/purchase_officer/
-- marketing_manager/designer — project_manager was MISSING, so Manivel's insert/
-- update hit "new row violates row-level security policy for table price_book"
-- (42501). Align RLS to the server action's editor set (price-book-actions.ts:9-14)
-- and add an explicit WITH CHECK (mig 052 had USING only, which still gates INSERT
-- but is implicit). The Price Book UI is gated to founder/PM/purchase_officer, so the
-- dropped sales_engineer/marketing_manager/designer never had visible write access.
--
-- Additive policy replacement. Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

DROP POLICY IF EXISTS price_book_write ON price_book;
CREATE POLICY price_book_write ON price_book
  FOR ALL TO authenticated
  USING      (get_my_role() IN ('founder','project_manager','purchase_officer','finance'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer','finance'));
