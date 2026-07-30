-- =============================================================================
-- Migration 218 — AMC: per-visit Work Activity timeline
-- Spec: docs/superpowers/specs/2026-07-30-purchase-bom-ticket-amc-fixes-design.md
--
--   1. om_visit_events — per-visit chronological feed (manual notes + system
--      events) with an optional file per entry, mirroring om_ticket_events
--      (migration 199). ON DELETE CASCADE off the visit, so deleting a visit
--      takes its activity with it.
--   2. DELETE policy on om_visit_schedules so om_technician can remove a visit
--      from the AMC detail page. The pre-existing "om_schedules_write" FOR ALL
--      policy covers founder + project_manager only; policies are OR'd, so this
--      widens DELETE without touching the existing write rules.
--
-- Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

-- ── 1. Per-visit Work Activity timeline ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS om_visit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        UUID NOT NULL REFERENCES om_visit_schedules(id) ON DELETE CASCADE,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('note', 'system')),
  body            TEXT NOT NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  -- FK to employees(id), NOT profiles(id) — writers resolve this through
  -- getCurrentEmployeeId(), never auth.uid().
  created_by      UUID REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timeline query: events for one visit, newest first (NEVER-DO #17).
CREATE INDEX IF NOT EXISTS idx_om_visit_events_visit
  ON om_visit_events (visit_id, created_at DESC);

ALTER TABLE om_visit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_events_read" ON om_visit_events;
CREATE POLICY "visit_events_read"
  ON om_visit_events FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
  );

DROP POLICY IF EXISTS "visit_events_insert" ON om_visit_events;
CREATE POLICY "visit_events_insert"
  ON om_visit_events FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

DROP POLICY IF EXISTS "visit_events_delete" ON om_visit_events;
CREATE POLICY "visit_events_delete"
  ON om_visit_events FOR DELETE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

-- ── 2. Per-visit delete for om_technician ───────────────────────────────────
DROP POLICY IF EXISTS "om_schedules_delete" ON om_visit_schedules;
CREATE POLICY "om_schedules_delete"
  ON om_visit_schedules FOR DELETE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );
