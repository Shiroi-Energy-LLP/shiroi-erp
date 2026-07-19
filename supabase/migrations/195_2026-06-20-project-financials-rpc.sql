-- 195_2026-06-20-project-financials-rpc.sql
-- Page-load perf audit [G6] / NEVER-DO #12 — projects detail FinancialBox.
--
-- getProjectFinancials() fetched contracted_value + ALL project_boq_items rows
-- + ALL approved expenses (3 parallel reads) and summed boq/site totals in JS
-- (.reduce). get_project_financials() does the whole rollup in one SQL pass:
-- contracted value, BOQ total (total_price, else quantity*unit_price — identical
-- to the JS branch), approved site-expense total, actual expenses, margin ₹ and %.
--
-- Always returns exactly one row (scalar subqueries + COALESCE) so a missing /
-- RLS-filtered project yields zeros, matching the prior JS. SECURITY INVOKER —
-- respects the same project_boq_items / expenses / projects RLS the cookie-client
-- reads did (the FinancialBox is already role-gated to founder/finance/PM).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_project_financials(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'contracted_value',    t.cv,
    'boq_total',           t.bt,
    'site_expenses_total', t.st,
    'actual_expenses',     t.bt + t.st,
    'margin_amount',       t.cv - (t.bt + t.st),
    'margin_pct',          CASE WHEN t.cv > 0
                                THEN ((t.cv - (t.bt + t.st)) / t.cv) * 100
                                ELSE 0 END
  )
  FROM (
    SELECT
      COALESCE((SELECT contracted_value FROM projects WHERE id = p_project_id), 0)::numeric AS cv,
      COALESCE((
        SELECT SUM(CASE WHEN total_price IS NOT NULL
                        THEN total_price
                        ELSE COALESCE(quantity, 0) * COALESCE(unit_price, 0) END)
        FROM project_boq_items WHERE project_id = p_project_id
      ), 0)::numeric AS bt,
      COALESCE((
        SELECT SUM(amount) FROM expenses
        WHERE project_id = p_project_id AND status = 'approved'
      ), 0)::numeric AS st
  ) t;
$$;

REVOKE ALL ON FUNCTION public.get_project_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_financials(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_project_financials(uuid) IS
  'Projects detail FinancialBox rollup in one SQL pass: contracted_value, boq_total (total_price else qty*unit_price), site_expenses_total (approved), actual_expenses, margin_amount, margin_pct. Replaces 3 parallel reads + JS .reduce (NEVER-DO #12). SECURITY INVOKER.';

COMMIT;

-- Verification: SELECT public.get_project_financials('<project-uuid>');
