-- supabase/migrations/102_orphan_triage_add_project_manager.sql
-- ============================================================================
-- Migration 102 — Add project_manager to orphan-triage RLS policies
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-05-01-zoho-orphan-triage-design.md
--
-- Vivek (2026-05-02): "BOM checking will be done by Prem and Manivel, so they
-- should both have access to the triage that you have created."
--   Prem (Premkumar) is marketing_manager → already covered by mig 099.
--   Manivel is project_manager → not in the original policy. This migration
--   adds project_manager to the read+insert policies on zoho_attribution_audit.
--
-- The page-level role guard and the actions-layer ALLOWED_ROLES set are
-- updated in the same commit (apps/erp/src/app/(erp)/cash/orphan-invoices/
-- page.tsx + apps/erp/src/lib/orphan-triage-actions.ts).

BEGIN;

DROP POLICY IF EXISTS "Triage roles can read audit" ON zoho_attribution_audit;
DROP POLICY IF EXISTS "Triage roles can insert audit" ON zoho_attribution_audit;

CREATE POLICY "Triage roles can read audit"
  ON zoho_attribution_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('founder','finance','marketing_manager','project_manager')
    )
  );

CREATE POLICY "Triage roles can insert audit"
  ON zoho_attribution_audit FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('founder','finance','marketing_manager','project_manager')
    )
  );

DO $$
BEGIN
  RAISE NOTICE '=== Migration 102 applied ===';
  RAISE NOTICE 'zoho_attribution_audit RLS now includes project_manager.';
END $$;

COMMIT;
