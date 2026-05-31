-- ============================================================================
-- Migration 145 — get_project_payment_overview() RPC
-- Date: 2026-05-30
-- Why: getProjectPaymentOverview() in apps/erp/src/lib/payments-overview-queries.ts
--      was fetching all ~328 contracted projects + 4 batched IN() queries
--      across customer_payments / purchase_orders / expenses /
--      proposal_payment_schedule, then doing 4 JS reduce loops to roll up
--      per-project money totals. That violates NEVER-DO #12 ("never
--      aggregate money in JavaScript") and grows linearly — at scale we
--      were pulling 10K+ rows on every /payments page load.
--
--      This RPC pushes the entire aggregation into Postgres: four CTEs
--      (payments / POs / expenses / accepted-proposal schedules) join
--      against projects in a single round-trip. The schedule logic
--      (which milestone is current, which is next) is replicated with
--      window functions over a running total of amounts.
--
-- Pattern mirrored from get_payment_tracker_rows (migration 088) +
-- get_payments_expected_this_week (migration 117). Same conventions:
--   - LANGUAGE sql STABLE
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - GRANT EXECUTE TO authenticated
-- Access is controlled by the calling page's auth/role checks + RLS
-- on underlying tables (the page is unrestricted today; founder /
-- finance / project_manager are the intended audience).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_project_payment_overview()
RETURNS TABLE (
  project_id            UUID,
  project_number        TEXT,
  customer_name         TEXT,
  project_status        project_status,
  contracted_value      NUMERIC(14,2),
  completion_pct        NUMERIC,
  total_received        NUMERIC(14,2),
  outstanding           NUMERIC(14,2),
  total_po_cost         NUMERIC(14,2),
  total_site_expenses   NUMERIC(14,2),
  project_pnl           NUMERIC(14,2),
  next_milestone_name   TEXT,
  next_milestone_amount NUMERIC(14,2),
  next_milestone_pct    NUMERIC,
  payment_stage         TEXT,
  expected_payment_date DATE,
  pm_name               TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Per-project money rollups. Each CTE is independent and groups
  -- by project_id so the final SELECT does a single LEFT JOIN per
  -- aggregate. NEVER-DO #12: no JS reduces over monetary rows.
  WITH pay AS (
    SELECT
      project_id,
      SUM(amount) AS total_received
    FROM customer_payments
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  pos AS (
    SELECT
      project_id,
      SUM(total_amount) AS total_po_cost
    FROM purchase_orders
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  exp AS (
    SELECT
      project_id,
      SUM(amount) AS total_site_expenses
    FROM expenses
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  -- Accepted-proposal payment schedule rows, one per (lead_id, milestone).
  -- A lead can have multiple accepted proposals historically; the JS code
  -- concatenates schedules from all of them. We preserve that behaviour:
  -- all schedule rows for accepted proposals on a given lead end up in
  -- the schedule pool, ordered by milestone_order.
  schedule_rows AS (
    SELECT
      pr.lead_id,
      pps.milestone_name,
      pps.milestone_order,
      pps.amount::NUMERIC(14,2)        AS amount,
      pps.percentage::NUMERIC          AS percentage,
      pps.expected_payment_date
    FROM proposal_payment_schedule pps
    JOIN proposals pr ON pr.id = pps.proposal_id
    WHERE pr.status = 'accepted'
      AND pr.lead_id IS NOT NULL
  ),
  -- Determine "current" milestone index per project: count how many
  -- consecutive milestones (in order) are fully covered by total_received.
  -- This replicates the JS loop:
  --   for each milestone (in order):
  --     runningTotal += amount;
  --     if (totalReceived >= runningTotal) currentMilestoneIdx = i + 1;
  -- After the loop, currentMilestoneIdx is the index of the NEXT unpaid.
  schedule_with_running AS (
    SELECT
      p.id                       AS project_id,
      sr.milestone_name,
      sr.milestone_order,
      sr.amount,
      sr.percentage,
      sr.expected_payment_date,
      -- Position of this row in the project's ordered schedule (1-based)
      ROW_NUMBER() OVER (
        PARTITION BY p.id
        ORDER BY sr.milestone_order
      ) AS row_idx,
      -- Total milestones in this project's schedule
      COUNT(*) OVER (PARTITION BY p.id) AS total_milestones,
      -- Cumulative sum of amounts UP TO AND INCLUDING this milestone
      SUM(sr.amount) OVER (
        PARTITION BY p.id
        ORDER BY sr.milestone_order
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_total,
      COALESCE(pay.total_received, 0) AS project_received
    FROM projects p
    JOIN schedule_rows sr ON sr.lead_id = p.lead_id
    LEFT JOIN pay         ON pay.project_id = p.id
    WHERE p.contracted_value > 0
  ),
  -- The "current milestone index" matches the JS variable of the same
  -- name: count of milestones whose running_total is <= total_received.
  -- If currentMilestoneIdx >= total_milestones, schedule is complete and
  -- there is no "next" milestone.
  current_idx AS (
    SELECT
      project_id,
      MAX(total_milestones) AS total_milestones,
      COUNT(*) FILTER (WHERE project_received >= running_total) AS current_milestone_idx
    FROM schedule_with_running
    GROUP BY project_id
  ),
  -- Pull the "next" milestone (the one at row_idx = current_milestone_idx + 1)
  -- by joining schedule_with_running against current_idx.
  next_milestone AS (
    SELECT
      swr.project_id,
      swr.milestone_name        AS next_milestone_name,
      swr.amount                AS next_milestone_amount,
      swr.percentage            AS next_milestone_pct,
      swr.expected_payment_date AS expected_payment_date
    FROM schedule_with_running swr
    JOIN current_idx ci ON ci.project_id = swr.project_id
    WHERE swr.row_idx = ci.current_milestone_idx + 1
      AND ci.current_milestone_idx < ci.total_milestones
  )
  SELECT
    p.id                                                 AS project_id,
    p.project_number,
    p.customer_name,
    p.status                                             AS project_status,
    p.contracted_value,
    p.completion_pct,
    COALESCE(pay.total_received, 0)::NUMERIC(14,2)       AS total_received,
    (p.contracted_value
       - COALESCE(pay.total_received, 0))::NUMERIC(14,2) AS outstanding,
    COALESCE(pos.total_po_cost, 0)::NUMERIC(14,2)        AS total_po_cost,
    COALESCE(exp.total_site_expenses, 0)::NUMERIC(14,2)  AS total_site_expenses,
    (COALESCE(pay.total_received, 0)
       - COALESCE(pos.total_po_cost, 0)
       - COALESCE(exp.total_site_expenses, 0))::NUMERIC(14,2) AS project_pnl,
    nm.next_milestone_name,
    nm.next_milestone_amount,
    nm.next_milestone_pct,
    -- payment_stage mirrors the JS logic exactly:
    --   no schedule       => 'No schedule'
    --   all milestones met => 'N/N Complete'
    --   else              => 'currentIdx/N Paid'
    CASE
      WHEN ci.total_milestones IS NULL THEN 'No schedule'
      WHEN ci.current_milestone_idx >= ci.total_milestones
        THEN ci.total_milestones::text || '/' || ci.total_milestones::text || ' Complete'
      ELSE ci.current_milestone_idx::text || '/' || ci.total_milestones::text || ' Paid'
    END                                                  AS payment_stage,
    nm.expected_payment_date,
    e.full_name                                          AS pm_name
  FROM projects p
  LEFT JOIN pay            ON pay.project_id      = p.id
  LEFT JOIN pos            ON pos.project_id      = p.id
  LEFT JOIN exp            ON exp.project_id      = p.id
  LEFT JOIN current_idx ci ON ci.project_id       = p.id
  LEFT JOIN next_milestone nm ON nm.project_id    = p.id
  LEFT JOIN employees e    ON e.id                = p.project_manager_id
  WHERE p.contracted_value > 0
  ORDER BY p.contracted_value DESC;
$$;

GRANT EXECUTE ON FUNCTION get_project_payment_overview() TO authenticated;

COMMENT ON FUNCTION get_project_payment_overview() IS
  'Per-project payment overview for /payments page. Aggregates customer_payments / purchase_orders / expenses and computes next milestone from accepted-proposal payment schedules. Replaces the 5-query + 4-reduce JS pattern in payments-overview-queries.ts. NEVER-DO #12.';
