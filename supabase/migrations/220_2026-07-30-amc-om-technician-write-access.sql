-- =============================================================================
-- Migration 220 — AMC: give om_technician write access (and fix mig 218 initplan)
-- Spec: docs/superpowers/specs/2026-07-30-purchase-bom-ticket-amc-fixes-design.md
--
-- Problem: the O&M technician — the role that actually performs AMC visits —
-- could READ the AMC screens but not write to them. `om_schedules_write` and
-- `om_contracts_write` were both `FOR ALL` limited to founder + project_manager
-- (mig 005d), so for an om_technician every one of these failed *silently*
-- (RLS returns 0 rows affected, not an error, so the UI showed no message):
--   · visit status dropdown, reschedule, assign engineer
--   · work done / issues / resolution / feedback / notes
--   · report file upload (writes report_file_paths)
--   · AMC contract Open/Closed toggle, Create AMC, close-out
-- Mig 218 then let them DELETE a visit they could not edit — incoherent.
--
-- Fix: align both tables with this module's own established convention, set by
-- `tickets_update` / `tickets_insert` on om_service_tickets — founder +
-- project_manager + om_technician. The read policies are left untouched.
--
-- Also rewrites the three mig 218 om_visit_events policies. They were copied
-- from mig 199 and use a bare `auth.uid()` inside the subquery, which
-- re-introduces the per-row initplan re-evaluation that mig 206 removed
-- repo-wide (185 warnings → 0). Switching them to the STABLE SECURITY DEFINER
-- `get_my_role()` helper matches every modern policy here and is evaluated once
-- per statement.
--
-- `FOR ALL` is deliberately replaced by explicit INSERT/UPDATE/DELETE policies:
-- a FOR ALL policy with only USING supplies no WITH CHECK, which makes the
-- INSERT path read as an accident rather than a decision.
--
-- Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

-- ── 1. om_visit_schedules — replace FOR ALL with explicit per-command grants ──
DROP POLICY IF EXISTS "om_schedules_write"  ON om_visit_schedules;
DROP POLICY IF EXISTS "om_schedules_delete" ON om_visit_schedules;  -- mig 218

CREATE POLICY "om_schedules_insert"
  ON om_visit_schedules FOR INSERT
  WITH CHECK (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

CREATE POLICY "om_schedules_update"
  ON om_visit_schedules FOR UPDATE
  USING (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  )
  WITH CHECK (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

CREATE POLICY "om_schedules_delete"
  ON om_visit_schedules FOR DELETE
  USING (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

-- ── 2. om_contracts — same treatment ────────────────────────────────────────
-- No hard DELETE policy: deleteAmc() is a soft close (status → 'cancelled'),
-- which the UPDATE policy covers. Nothing in the app hard-deletes a contract.
DROP POLICY IF EXISTS "om_contracts_write" ON om_contracts;

CREATE POLICY "om_contracts_insert"
  ON om_contracts FOR INSERT
  WITH CHECK (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

CREATE POLICY "om_contracts_update"
  ON om_contracts FOR UPDATE
  USING (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  )
  WITH CHECK (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

-- ── 3. om_visit_events — swap mig 218's bare auth.uid() for get_my_role() ───
DROP POLICY IF EXISTS "visit_events_read"   ON om_visit_events;
DROP POLICY IF EXISTS "visit_events_insert" ON om_visit_events;
DROP POLICY IF EXISTS "visit_events_delete" ON om_visit_events;

CREATE POLICY "visit_events_read"
  ON om_visit_events FOR SELECT
  USING (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician', 'finance']::app_role[])
  );

CREATE POLICY "visit_events_insert"
  ON om_visit_events FOR INSERT
  WITH CHECK (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

CREATE POLICY "visit_events_delete"
  ON om_visit_events FOR DELETE
  USING (
    get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician']::app_role[])
  );

-- ── 4. Cover the om_visit_events.created_by FK (NEVER-DO #17) ───────────────
-- Mig 218 indexed (visit_id, created_at DESC) for the timeline read but left
-- created_by uncovered, which the Supabase performance advisor flags. The
-- column is joined on every timeline read
-- (`author:employees!om_visit_events_created_by_fkey(full_name)`).
CREATE INDEX IF NOT EXISTS idx_om_visit_events_created_by
  ON om_visit_events (created_by);
