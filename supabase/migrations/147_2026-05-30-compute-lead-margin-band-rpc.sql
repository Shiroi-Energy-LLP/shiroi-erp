-- ============================================================
-- Migration 147 — compute_lead_margin_band() RPC
-- Date: 2026-05-30
-- Why:
--   apps/erp/src/lib/closure-actions.ts computeMargin() previously did a
--   .filter+.reduce over proposal_bom_lines in JavaScript to compute the
--   green/amber/red margin band that gates lead Won. NEVER-DO #12 (money
--   math in JS). This RPC pushes all aggregation server-side.
--
--   Data-quality fallback ladder (preserved from closure-helpers.classifyBand):
--     no_data (no base_price AND no bom_cost)         → band='red'
--     no_bom_cost (base_price > 0, bom_cost = 0)      → band='green' (May-19 fallback)
--     no_base_price (base_price = 0, bom_cost > 0)    → band='red'
--     ok                                              → band derived from margin %:
--                                                          ≥10% green, ≥8% amber, else red.
--
--   Reconstructed from dev DB state (the Batch-A workflow agent applied via
--   execute_sql but didn't persist the local file).
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_lead_margin_band(p_lead_id uuid)
RETURNS TABLE(
  base_price          numeric,
  bom_cost            numeric,
  site_expenses_est   numeric,
  gross_margin        numeric,
  band                text,
  data_quality        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH
  lead_row AS (
    SELECT COALESCE(l.base_quote_price, 0)::NUMERIC AS lead_base_price
    FROM leads l
    WHERE l.id = p_lead_id
  ),
  picked_proposal AS (
    SELECT p.id, p.total_after_discount
    FROM proposals p
    WHERE p.lead_id = p_lead_id
      AND p.status IN ('draft', 'sent', 'viewed', 'negotiating')
    ORDER BY p.created_at DESC
    LIMIT 1
  ),
  bom_total AS (
    SELECT COALESCE(SUM(b.raw_estimated_cost), 0)::NUMERIC AS shiroi_bom_cost
    FROM proposal_bom_lines b
    WHERE b.proposal_id = (SELECT id FROM picked_proposal)
      AND b.scope_owner = 'shiroi'
  ),
  resolved AS (
    SELECT
      CASE
        WHEN (SELECT lead_base_price FROM lead_row) > 0
          THEN (SELECT lead_base_price FROM lead_row)
        WHEN (SELECT total_after_discount FROM picked_proposal) IS NOT NULL
          THEN (SELECT total_after_discount FROM picked_proposal)::NUMERIC
        ELSE 0::NUMERIC
      END AS resolved_base_price,
      (SELECT shiroi_bom_cost FROM bom_total) AS resolved_bom_cost,
      0::NUMERIC AS resolved_site_expenses_est
  )
  SELECT
    CASE
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost <= 0 THEN 0::NUMERIC
      WHEN r.resolved_base_price > 0  AND r.resolved_bom_cost <= 0 THEN r.resolved_base_price
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost > 0  THEN 0::NUMERIC
      ELSE r.resolved_base_price
    END AS base_price,
    CASE
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost <= 0 THEN 0::NUMERIC
      WHEN r.resolved_base_price > 0  AND r.resolved_bom_cost <= 0 THEN 0::NUMERIC
      ELSE r.resolved_bom_cost
    END AS bom_cost,
    r.resolved_site_expenses_est AS site_expenses_est,
    CASE
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost <= 0 THEN 0::NUMERIC
      WHEN r.resolved_base_price > 0  AND r.resolved_bom_cost <= 0 THEN NULL::NUMERIC
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost > 0  THEN 0::NUMERIC
      ELSE ROUND(
        ((r.resolved_base_price - (r.resolved_bom_cost + r.resolved_site_expenses_est))
         / r.resolved_base_price) * 100,
        2
      )
    END AS gross_margin,
    CASE
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost <= 0 THEN 'red'
      WHEN r.resolved_base_price > 0  AND r.resolved_bom_cost <= 0 THEN 'green'
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost > 0  THEN 'red'
      ELSE
        CASE
          WHEN ROUND(
                 ((r.resolved_base_price - (r.resolved_bom_cost + r.resolved_site_expenses_est))
                  / r.resolved_base_price) * 100,
                 2
               ) >= 10 THEN 'green'
          WHEN ROUND(
                 ((r.resolved_base_price - (r.resolved_bom_cost + r.resolved_site_expenses_est))
                  / r.resolved_base_price) * 100,
                 2
               ) >= 8  THEN 'amber'
          ELSE 'red'
        END
    END AS band,
    CASE
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost <= 0 THEN 'no_data'
      WHEN r.resolved_base_price > 0  AND r.resolved_bom_cost <= 0 THEN 'no_bom_cost'
      WHEN r.resolved_base_price <= 0 AND r.resolved_bom_cost > 0  THEN 'no_base_price'
      ELSE 'ok'
    END AS data_quality
  FROM resolved r;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_lead_margin_band(uuid) TO authenticated;
