-- =============================================================================
-- Migration 181 — dashboard year-wise summary RPC
-- Spec: docs/superpowers/specs/2026-06-15-manivel-dashboard-parity-design.md
--
-- get_dashboard_year_summary(): one row per resolved-year bucket (from
-- project_reconciliation.resolved_year; <2022 collapses to '<=2021') PLUS a
-- 'TOTAL' grand-total row via GROUPING SETS. Money aggregated in SQL (NEVER-DO #12).
-- revenue = contracted_value; cost = committed POs (excl cancelled/draft) + approved expenses.
-- Additive only.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_dashboard_year_summary()
RETURNS TABLE (
  year_bucket      TEXT,
  project_count    BIGINT,
  completed_count  BIGINT,
  total_contracted NUMERIC,
  total_cost_erp   NUMERIC,
  avg_margin_pct   NUMERIC
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH po AS (
    SELECT project_id, SUM(total_amount) AS amt
    FROM purchase_orders
    WHERE project_id IS NOT NULL AND status NOT IN ('cancelled','draft')
    GROUP BY project_id
  ),
  ex AS (
    SELECT project_id, SUM(amount) AS amt
    FROM expenses
    WHERE project_id IS NOT NULL AND status = 'approved'
    GROUP BY project_id
  ),
  base AS (
    SELECT
      p.id,
      CASE
        WHEN pr.resolved_year IS NULL THEN 'unknown'
        WHEN pr.resolved_year < 2022 THEN '<=2021'
        ELSE pr.resolved_year::text
      END AS year_bucket,
      p.status::text AS status,
      p.contracted_value AS revenue,
      COALESCE(po.amt, 0) + COALESCE(ex.amt, 0) AS cost
    FROM projects p
    LEFT JOIN project_reconciliation pr ON pr.project_id = p.id
    LEFT JOIN po ON po.project_id = p.id
    LEFT JOIN ex ON ex.project_id = p.id
    WHERE p.deleted_at IS NULL
  )
  SELECT
    CASE WHEN GROUPING(year_bucket) = 1 THEN 'TOTAL' ELSE year_bucket END,
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COALESCE(SUM(revenue), 0),
    COALESCE(SUM(cost), 0),
    ROUND(AVG(CASE WHEN revenue > 0 AND cost > 0 THEN (revenue - cost) / revenue * 100 END), 1)
  FROM base
  GROUP BY GROUPING SETS ((year_bucket), ());
$$;

REVOKE ALL ON FUNCTION get_dashboard_year_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_dashboard_year_summary() TO authenticated;
