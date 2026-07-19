-- =============================================================================
-- Migration 199 — Service tickets: combined timeline, attachments, hard-delete, KPIs
-- Spec: docs/superpowers/specs/2026-06-27-service-ticket-detail-and-timeline-design.md
--
-- Adds the detail-page substrate:
--   1. om_ticket_events — one combined chronological feed (manual notes + system
--      events) with an optional file per entry. ON DELETE CASCADE off the ticket.
--   2. Ticket-level supporting documents: attachment_paths / attachment_names arrays.
--   3. DELETE policy on om_service_tickets — none existed (only read/insert/update),
--      so hard delete under the user session needs one (founder/PM/om_technician).
--   4. get_service_ticket_kpis() — open/closed counts + total amount in one SQL call
--      (NEVER-DO #12: never aggregate money in JS). Open = NOT IN (resolved,closed);
--      Closed = IN (resolved,closed).
--
-- Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

-- ── 1. Ticket-level supporting documents ────────────────────────────────────
ALTER TABLE om_service_tickets
  ADD COLUMN IF NOT EXISTS attachment_paths TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attachment_names TEXT[] NOT NULL DEFAULT '{}';

-- ── 2. Combined timeline (notes + system events) ────────────────────────────
CREATE TABLE IF NOT EXISTS om_ticket_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES om_service_tickets(id) ON DELETE CASCADE,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('note', 'system')),
  body            TEXT NOT NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  created_by      UUID REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timeline query: events for one ticket, newest first.
CREATE INDEX IF NOT EXISTS idx_om_ticket_events_ticket
  ON om_ticket_events (ticket_id, created_at DESC);

ALTER TABLE om_ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_events_read" ON om_ticket_events;
CREATE POLICY "ticket_events_read"
  ON om_ticket_events FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
  );

DROP POLICY IF EXISTS "ticket_events_insert" ON om_ticket_events;
CREATE POLICY "ticket_events_insert"
  ON om_ticket_events FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

DROP POLICY IF EXISTS "ticket_events_delete" ON om_ticket_events;
CREATE POLICY "ticket_events_delete"
  ON om_ticket_events FOR DELETE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

-- ── 3. Hard-delete policy on om_service_tickets ─────────────────────────────
DROP POLICY IF EXISTS "tickets_delete" ON om_service_tickets;
CREATE POLICY "tickets_delete"
  ON om_service_tickets FOR DELETE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

-- ── 4. KPI rollup RPC (open/closed counts + total amount) ───────────────────
CREATE OR REPLACE FUNCTION get_service_ticket_kpis()
RETURNS TABLE (open_count BIGINT, closed_count BIGINT, total_amount NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) AS open_count,
    COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))     AS closed_count,
    COALESCE(SUM(service_amount), 0)                             AS total_amount
  FROM om_service_tickets;
$$;
REVOKE ALL ON FUNCTION get_service_ticket_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_service_ticket_kpis() TO authenticated;
