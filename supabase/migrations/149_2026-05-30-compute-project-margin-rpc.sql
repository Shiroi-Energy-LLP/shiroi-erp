-- ============================================================
-- Migration 149 — compute_project_margin() RPC
-- Date: 2026-05-30
-- Why:
--   apps/erp/src/lib/project-detail-actions.ts getProjectFinancials previously
--   fetched 3 tables and did 2 .reduce() loops in JavaScript to compute the
--   project P&L block shown on /projects/[id]. NEVER-DO #12 (money in JS).
--
--   total_boq_cost is computed from total_price when present (canonical),
--   else falls back to quantity * unit_price (handles partially-filled rows).
--   total_expenses only counts approved expenses (status = 'approved').
--   margin_pct returns 0 when contract_value is 0 to avoid division-by-zero.
--
--   Reconstructed from dev DB state (Batch-A workflow agent applied via
--   execute_sql but didn't persist the local file).
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_project_margin(p_project_id uuid)
RETURNS TABLE(
  contract_value   numeric,
  total_boq_cost   numeric,
  total_expenses   numeric,
  total_invested   numeric,
  margin           numeric,
  margin_pct       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH proj AS (
    SELECT COALESCE(contracted_value, 0)::NUMERIC(14,2) AS contract_value
    FROM projects
    WHERE id = p_project_id
  ),
  boq AS (
    SELECT COALESCE(SUM(
      CASE
        WHEN total_price IS NOT NULL THEN total_price
        ELSE COALESCE(quantity, 0) * COALESCE(unit_price, 0)
      END
    ), 0)::NUMERIC(14,2) AS total_boq_cost
    FROM project_boq_items
    WHERE project_id = p_project_id
  ),
  exp AS (
    SELECT COALESCE(SUM(amount), 0)::NUMERIC(14,2) AS total_expenses
    FROM expenses
    WHERE project_id = p_project_id
      AND status = 'approved'
  )
  SELECT
    COALESCE(proj.contract_value, 0)::NUMERIC(14,2)              AS contract_value,
    boq.total_boq_cost                                           AS total_boq_cost,
    exp.total_expenses                                           AS total_expenses,
    (boq.total_boq_cost + exp.total_expenses)::NUMERIC(14,2)     AS total_invested,
    (COALESCE(proj.contract_value, 0)
       - (boq.total_boq_cost + exp.total_expenses))::NUMERIC(14,2) AS margin,
    CASE
      WHEN COALESCE(proj.contract_value, 0) > 0 THEN
        ((COALESCE(proj.contract_value, 0)
            - (boq.total_boq_cost + exp.total_expenses))
         / proj.contract_value) * 100
      ELSE 0
    END                                                          AS margin_pct
  FROM proj
  CROSS JOIN boq
  CROSS JOIN exp;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_project_margin(uuid) TO authenticated;
