-- Migration 048: Performance round 2 — indexes + aggregation RPCs
--
-- Extends migration 028 (which added 6 indexes + 3 RPCs) with targeted
-- fixes identified in the April 14, 2026 full-codebase audit.
--
-- Targets:
--   1. Replace 3 JS `.reduce()` aggregations in dashboard-queries.ts that
--      fetch all rows and sum in JavaScript. At 10x scale these push
--      thousands of rows through the JS heap per page load.
--   2. Replace 2 `count: 'exact'` queries on om_visit_schedules with a
--      single RPC that returns both counts in one round-trip.
--   3. Fix the N+1 pattern in getProjectsWithNoReportToday() which
--      currently runs 2 sequential queries + client-side filter.
--   4. Add 4 missing indexes identified in the audit for the tables
--      that will grow fastest: activity_associations, proposal_bom_lines,
--      customer_payments, and daily_site_reports (composite on the
--      (project_id, report_date) pair for NOT EXISTS anti-joins).
--
-- Apply to DEV first, then PROD after verification.

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════

-- Activity timeline: lead/project detail pages load all activities for a
-- given entity. activity_associations is the junction table between
-- activities and entities (leads, projects, proposals, etc.). At 10x scale
-- this will be the largest append-only table in the system.
CREATE INDEX IF NOT EXISTS idx_activity_associations_entity
  ON activity_associations(entity_id, entity_type);

-- Proposal GST breakdown: the proposal detail page groups BOM lines by
-- gst_type to compute supply vs works subtotals. The existing
-- idx_bom_lines_proposal_order covers (proposal_id, line_number) but not
-- (proposal_id, gst_type). At 350k BOM lines this composite is a win.
CREATE INDEX IF NOT EXISTS idx_bom_lines_proposal_gst
  ON proposal_bom_lines(proposal_id, gst_type);

-- Customer payments history per project: the project payments page and
-- the payment-followup trigger both read these by project_id ordered by
-- date. Without this index, every project detail load scans the full
-- customer_payments table.
CREATE INDEX IF NOT EXISTS idx_customer_payments_project_date
  ON customer_payments(project_id, payment_date DESC);

-- Daily report NOT EXISTS anti-join: getProjectsWithNoReportToday() needs
-- to find projects with no report for CURRENT_DATE. Migration 028 added
-- (report_date DESC) but that doesn't help the anti-join — this composite
-- does. Also helps "latest report per project" queries.
CREATE INDEX IF NOT EXISTS idx_daily_reports_project_date
  ON daily_site_reports(project_id, report_date DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Pipeline summary — replaces JS-side reduce of all draft/sent/negotiating
--    proposals in dashboard-queries.ts:getPipelineSummary()
-- Used by: founder dashboard pipeline card
CREATE OR REPLACE FUNCTION get_pipeline_summary()
RETURNS TABLE(
  proposal_count bigint,
  total_value numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*)::bigint                               AS proposal_count,
    COALESCE(SUM(total_after_discount), 0)::numeric AS total_value
  FROM proposals
  WHERE status IN ('draft', 'sent', 'negotiating');
$$;

-- 2. Projects without today's report — replaces the N+1 in
--    dashboard-queries.ts:getProjectsWithNoReportToday() which runs
--    2 sequential queries + JS-side filter.
-- Used by: founder dashboard "Missing reports" card
-- Note: report date is computed in IST (Asia/Kolkata) to match the
--    frontend's notion of "today".
CREATE OR REPLACE FUNCTION get_projects_without_today_report()
RETURNS TABLE(
  project_id uuid,
  project_number text,
  customer_name text,
  status project_status
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    p.id,
    p.project_number,
    p.customer_name,
    p.status
  FROM projects p
  WHERE p.deleted_at IS NULL
    AND p.status NOT IN (
      'completed',
      'holding_shiroi',
      'holding_client',
      'waiting_net_metering',
      'meter_client_scope'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM daily_site_reports dsr
      WHERE dsr.project_id = p.id
        AND dsr.report_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    )
  ORDER BY p.project_number;
$$;

-- 3. AMC monthly summary — replaces 2× count: 'exact' head queries in
--    dashboard-queries.ts:getAmcMonthlySummary(). Single round-trip,
--    filters indexed column twice.
-- Used by: founder dashboard AMC card
CREATE OR REPLACE FUNCTION get_amc_monthly_summary()
RETURNS TABLE(
  scheduled_count bigint,
  completed_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH month_bounds AS (
    SELECT
      date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date   AS month_start,
      (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date) + interval '1 month' - interval '1 day')::date AS month_end
  )
  SELECT
    COUNT(*) FILTER (WHERE ovs.scheduled_date BETWEEN mb.month_start AND mb.month_end)::bigint AS scheduled_count,
    COUNT(*) FILTER (WHERE ovs.scheduled_date BETWEEN mb.month_start AND mb.month_end AND ovs.status = 'completed')::bigint AS completed_count
  FROM om_visit_schedules ovs
  CROSS JOIN month_bounds mb
  WHERE ovs.scheduled_date BETWEEN mb.month_start AND mb.month_end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════
-- After applying, verify with:
--   SELECT * FROM get_pipeline_summary();
--   SELECT * FROM get_projects_without_today_report();
--   SELECT * FROM get_amc_monthly_summary();
--
-- Index verification:
--   SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_%'
--     AND tablename IN ('activity_associations', 'proposal_bom_lines',
--                       'customer_payments', 'daily_site_reports');
