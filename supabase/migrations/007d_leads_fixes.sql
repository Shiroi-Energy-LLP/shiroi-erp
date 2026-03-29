-- ============================================================
-- Migration 007d — Phone Deduplication + Leads RLS Fix
-- File: supabase/migrations/007d_leads_fixes.sql
-- Description: Partial unique index on leads.phone to prevent
--              duplicate active leads. Fix leads_read RLS to
--              show all leads to sales_engineer (team visibility).
-- Date: 2026-03-29
-- Rollback:
--   DROP INDEX IF EXISTS idx_leads_phone_unique;
--   DROP POLICY IF EXISTS "leads_read" ON leads;
--   -- Then recreate the old policy if needed.
-- Dependencies: 002a_leads_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Partial unique index on leads.phone
-- Allows same phone in disqualified or deleted leads.
-- Blocks duplicate active leads from same phone.
-- This prevents two salespeople unknowingly working the same
-- customer, and prevents duplicate HubSpot import records.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX idx_leads_phone_unique
  ON leads(phone)
  WHERE deleted_at IS NULL
    AND status NOT IN ('disqualified', 'lost');

COMMENT ON INDEX idx_leads_phone_unique IS
  'Prevents duplicate active leads for the same phone number. '
  'Disqualified and lost leads are excluded so the same phone '
  'can re-enter the pipeline as a new lead if appropriate.';


-- ------------------------------------------------------------
-- 2. Fix leads_read RLS — all leads visible to sales_engineer
-- Decision: team pipeline visibility is useful at Shiroi's scale.
-- All sales engineers can see all leads.
-- Own-leads-only would fragment pipeline visibility in a 5-person team.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "leads_read" ON leads;

CREATE POLICY "leads_read"
  ON leads FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'hr_manager', 'finance', 'sales_engineer', 'project_manager')
  );

COMMENT ON POLICY "leads_read" ON leads IS
  'Sales engineers see all leads for team pipeline visibility. '
  'If strict ownership is needed in future, change to: '
  'assigned_to = (SELECT id FROM employees WHERE profile_id = auth.uid())';

COMMIT;