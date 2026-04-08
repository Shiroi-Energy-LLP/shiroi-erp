-- Migration 028: Performance indexes + RPC functions
-- Fixes statement timeouts caused by missing indexes and JS-side aggregation
-- Apply to DEV first, then PROD after verification

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Dashboard: daily reports by date (founder dashboard checks today's reports)
CREATE INDEX IF NOT EXISTS idx_daily_site_reports_report_date
  ON daily_site_reports(report_date DESC);

-- Leads pipeline: composite for stage queries (leads page stage nav)
CREATE INDEX IF NOT EXISTS idx_leads_pipeline
  ON leads(deleted_at, status, is_archived)
  WHERE deleted_at IS NULL;

-- Payments page: proposals by lead + accepted status
CREATE INDEX IF NOT EXISTS idx_proposals_lead_accepted
  ON proposals(lead_id, status)
  WHERE status = 'accepted';

-- Cash positions: invested projects (dashboard + cash page)
CREATE INDEX IF NOT EXISTS idx_cash_positions_invested
  ON project_cash_positions(net_cash_position)
  WHERE net_cash_position < 0;

-- BOM lines: order by proposal + line number (project BOM step)
CREATE INDEX IF NOT EXISTS idx_bom_lines_proposal_order
  ON proposal_bom_lines(proposal_id, line_number);

-- Profitability page: project status filter
CREATE INDEX IF NOT EXISTS idx_projects_status_not_deleted
  ON projects(status, created_at DESC)
  WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- 1. Lead stage counts — replaces JS-side grouping of 1,115 leads
-- Used by: /leads page pipeline summary + stage nav
CREATE OR REPLACE FUNCTION get_lead_stage_counts(p_include_archived boolean DEFAULT false)
RETURNS TABLE(status lead_status, lead_count bigint, total_value numeric, weighted_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    l.status,
    COUNT(*)::bigint AS lead_count,
    COALESCE(SUM(l.estimated_size_kwp * 60000), 0) AS total_value,
    COALESCE(SUM(l.estimated_size_kwp * 60000 * COALESCE(l.close_probability, 0) / 100), 0) AS weighted_value
  FROM leads l
  WHERE l.deleted_at IS NULL
    AND l.status != 'converted'
    AND (p_include_archived OR l.is_archived = false)
  GROUP BY l.status;
$$;

-- 2. Company cash summary — replaces JS-side aggregation of all project_cash_positions
-- Used by: founder dashboard, finance dashboard
CREATE OR REPLACE FUNCTION get_company_cash_summary()
RETURNS TABLE(
  total_invested numeric, total_receivables numeric,
  active_po_value numeric, project_count bigint, invested_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE(SUM(CASE WHEN net_cash_position < 0 THEN ABS(net_cash_position) ELSE 0 END), 0),
    COALESCE(SUM(total_outstanding), 0),
    COALESCE(SUM(total_po_value), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE net_cash_position < 0)
  FROM project_cash_positions;
$$;

-- 3. MSME due count — replaces client-side filter of all POs
-- Used by: finance dashboard
CREATE OR REPLACE FUNCTION get_msme_due_count(p_due_before date)
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COUNT(*)::bigint
  FROM purchase_orders po
  JOIN vendors v ON po.vendor_id = v.id
  WHERE v.is_msme = true
    AND po.amount_outstanding > 0
    AND po.payment_due_date <= p_due_before;
$$;
