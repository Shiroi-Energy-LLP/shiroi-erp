-- =============================================================================
-- Migration 061 — Broaden RFQ-table RLS to include project_manager
-- =============================================================================
--
-- Date: 2026-04-17
-- Context: Migration 060 shipped the Purchase v2 pipeline with RFQ-family
-- RLS policies that permitted only `founder` and `purchase_officer` on
-- INSERT/UPDATE. In practice Shiroi has no `purchase_officer` user — the
-- PM (Manivel) is the de-facto Purchase Engineer, and the employees table
-- carries no "purchase" designation either.
--
-- Symptom: Manivel (project_manager) hits "new row violates row-level
-- security policy for table \"rfqs\"" the moment he clicks Send RFQ.
--
-- Fix: add `project_manager` to every INSERT/UPDATE WITH CHECK / USING on
-- the RFQ family (rfqs, rfq_items, rfq_invitations, rfq_quotes, rfq_awards).
-- Policies are DROP-then-CREATE since Postgres has no ALTER POLICY for the
-- check expression.
--
-- The founder-approval gate on `purchase_orders` (approve / reject) is
-- intentionally NOT touched. Founder stays the sole approver per spec §8.
-- DELETE policies are also left founder-only — PM can raise an RFQ but
-- can't hard-delete one. Cancellation flips status to 'cancelled' via the
-- existing UPDATE path.
-- =============================================================================

-- ─── rfqs ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS rfqs_insert ON rfqs;
CREATE POLICY rfqs_insert ON rfqs FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

DROP POLICY IF EXISTS rfqs_update ON rfqs;
CREATE POLICY rfqs_update ON rfqs FOR UPDATE
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

-- ─── rfq_items ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS rfq_items_insert ON rfq_items;
CREATE POLICY rfq_items_insert ON rfq_items FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

DROP POLICY IF EXISTS rfq_items_update ON rfq_items;
CREATE POLICY rfq_items_update ON rfq_items FOR UPDATE
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

-- ─── rfq_invitations ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS rfq_invitations_insert ON rfq_invitations;
CREATE POLICY rfq_invitations_insert ON rfq_invitations FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

DROP POLICY IF EXISTS rfq_invitations_update ON rfq_invitations;
CREATE POLICY rfq_invitations_update ON rfq_invitations FOR UPDATE
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

-- ─── rfq_quotes ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS rfq_quotes_insert ON rfq_quotes;
CREATE POLICY rfq_quotes_insert ON rfq_quotes FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

DROP POLICY IF EXISTS rfq_quotes_update ON rfq_quotes;
CREATE POLICY rfq_quotes_update ON rfq_quotes FOR UPDATE
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

-- ─── rfq_awards ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS rfq_awards_insert ON rfq_awards;
CREATE POLICY rfq_awards_insert ON rfq_awards FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

DROP POLICY IF EXISTS rfq_awards_update ON rfq_awards;
CREATE POLICY rfq_awards_update ON rfq_awards FOR UPDATE
  USING (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'purchase_officer'::app_role,
    'project_manager'::app_role
  ]));

-- =============================================================================
-- Verification
-- =============================================================================
-- Run after apply to confirm all INSERT / UPDATE policies mention
-- 'project_manager' (should return 10 rows, 2 per table × 5 tables):
--
--   SELECT c.relname, p.polname, pg_get_expr(COALESCE(p.polwithcheck, p.polqual), p.polrelid)
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE c.relname IN ('rfqs','rfq_items','rfq_invitations','rfq_quotes','rfq_awards')
--     AND p.polcmd IN ('a','w')
--   ORDER BY c.relname, p.polname;
-- =============================================================================
