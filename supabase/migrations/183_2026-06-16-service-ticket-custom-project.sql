-- =============================================================================
-- Migration 183 — Service tickets: optional project (free-text label) + total RPC
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
--
-- Allow tickets for Service/AMC/misc work not tied to an ERP project: project_id
-- becomes nullable with a free-text project_name_custom fallback (CHECK requires one
-- of the two). Ticket numbers are TKT-NNNN (project-independent), so nulls are safe.
-- get_service_ticket_amount_total(): SQL SUM for the list header (NEVER-DO #12) —
-- counts ALL tickets incl. closed (close is status='closed', not a delete).
--
-- Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

ALTER TABLE om_service_tickets ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE om_service_tickets ADD COLUMN IF NOT EXISTS project_name_custom TEXT;
ALTER TABLE om_service_tickets DROP CONSTRAINT IF EXISTS om_service_tickets_project_or_custom;
ALTER TABLE om_service_tickets ADD CONSTRAINT om_service_tickets_project_or_custom
  CHECK (project_id IS NOT NULL OR project_name_custom IS NOT NULL);

CREATE OR REPLACE FUNCTION get_service_ticket_amount_total()
RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(service_amount), 0) FROM om_service_tickets;
$$;
REVOKE ALL ON FUNCTION get_service_ticket_amount_total() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_service_ticket_amount_total() TO authenticated;
