-- =============================================================================
-- Migration 185 — get_project_status_summary(p_fy): projects-list header dashboard
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
--
-- One row per status (count + summed system size) over non-deleted projects, FY-filtered
-- with the SAME order_date-with-created_at-fallback logic the list uses
-- (projects-queries.ts). A 'TOTAL' grand-total row (GROUPING SETS) keeps the total
-- system size fully in SQL (NEVER-DO #12). p_fy NULL or malformed = all projects.
--
-- Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

CREATE OR REPLACE FUNCTION get_project_status_summary(p_fy TEXT DEFAULT NULL)
RETURNS TABLE (status TEXT, project_count BIGINT, total_kwp NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT p.status::text AS status, p.system_size_kwp AS kwp
    FROM projects p
    WHERE p.deleted_at IS NULL
      AND (
        p_fy IS NULL OR p_fy !~ '^\d{4}-\d{2}$'
        OR (p.order_date >= (substring(p_fy from 1 for 4) || '-04-01')::date
            AND p.order_date < (((substring(p_fy from 1 for 4))::int + 1)::text || '-04-01')::date)
        OR (p.order_date IS NULL
            AND p.created_at >= (substring(p_fy from 1 for 4) || '-04-01')::timestamptz
            AND p.created_at < (((substring(p_fy from 1 for 4))::int + 1)::text || '-04-01')::timestamptz)
      )
  )
  SELECT CASE WHEN GROUPING(status) = 1 THEN 'TOTAL' ELSE status END,
         COUNT(*),
         COALESCE(SUM(kwp), 0)
  FROM base
  GROUP BY GROUPING SETS ((status), ());
$$;
REVOKE ALL ON FUNCTION get_project_status_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_project_status_summary(TEXT) TO authenticated;
