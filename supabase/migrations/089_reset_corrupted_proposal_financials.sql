-- ============================================================
-- Migration 089 — Reset corrupted proposal financials (Tier A)
-- File: supabase/migrations/089_reset_corrupted_proposal_financials.sql
-- Description: One-time cleanup. Resets total_after_discount,
--              total_before_discount, subtotals, GST, and revenue
--              for ~130 proposals where per-kWp price is implausibly
--              high. Sets financials_invalidated = TRUE on all,
--              system_size_uncertain = TRUE on the doubtful-kWp
--              subset (~24). Deletes the contaminating BOM lines.
--              HubSpot-migrated proposals are excluded — they go
--              through Tier D (re-import).
-- Date: 2026-04-30
-- Dry-run verified: 2026-04-30 — total_targets=130, confident=106,
--   doubtful=24, max_per_kwp≈246B (PV147), min_per_kwp≈200K.
-- Rollback: NOT SAFE TO ROLLBACK. Original values are not preserved
--           anywhere recoverable. The full original numbers are
--           captured in financials_invalidated_reason for forensic
--           reference. Re-running this migration is idempotent
--           (rows already at 0 stay at 0, but the flag/reason gets
--           refreshed to NOW()).
-- Dependencies: 088_proposal_data_quality_flags.sql
-- ============================================================

BEGIN;

-- Tier A targets: union of confident-kWp + doubtful-kWp under Vivek's adaptive rule.
-- HubSpot-migrated proposals (hubspot_deal_id IS NOT NULL) are excluded — those go
-- through the Tier D re-import workflow, not this reset.
CREATE TEMP TABLE tier_a_targets AS
WITH lead_sizes AS (
  SELECT id, estimated_size_kwp FROM leads
),
project_sizes AS (
  SELECT proposal_id, MAX(system_size_kwp) AS projects_size_kwp
  FROM projects
  WHERE proposal_id IS NOT NULL
  GROUP BY proposal_id
),
classified AS (
  SELECT
    p.id,
    p.proposal_number,
    p.system_size_kwp,
    p.total_after_discount,
    p.total_after_discount / NULLIF(p.system_size_kwp, 0) AS per_kwp,
    p.hubspot_deal_id,
    ls.estimated_size_kwp AS lead_size,
    ps.projects_size_kwp,
    -- "confident" = lead size OR project size matches proposal size within 20%
    (
      (ls.estimated_size_kwp IS NOT NULL
        AND ls.estimated_size_kwp > 0
        AND ABS(p.system_size_kwp - ls.estimated_size_kwp)
            / GREATEST(p.system_size_kwp, ls.estimated_size_kwp) < 0.2)
      OR
      (ps.projects_size_kwp IS NOT NULL
        AND ps.projects_size_kwp > 0
        AND ABS(p.system_size_kwp - ps.projects_size_kwp)
            / GREATEST(p.system_size_kwp, ps.projects_size_kwp) < 0.2)
    ) AS kwp_confident
  FROM proposals p
  LEFT JOIN lead_sizes ls ON ls.id = p.lead_id
  LEFT JOIN project_sizes ps ON ps.proposal_id = p.id
  WHERE p.total_after_discount IS NOT NULL
    AND p.total_after_discount > 0
    AND p.system_size_kwp > 0
    AND p.hubspot_deal_id IS NULL  -- Tier D handles these separately
)
SELECT id, proposal_number, system_size_kwp, total_after_discount, per_kwp,
       lead_size, projects_size_kwp, kwp_confident
FROM classified
WHERE
  (kwp_confident AND per_kwp > 200000)      -- ₹2L/kWp threshold for confident
  OR (NOT kwp_confident AND per_kwp > 500000); -- ₹5L/kWp threshold for doubtful

-- Reset financials and flag the row. The 24 doubtful-kWp rows ALSO get
-- system_size_uncertain = TRUE so the UI tells the SE to verify the kWp itself
-- before requoting (not just the price).
UPDATE proposals AS p
SET
  total_after_discount = 0,
  total_before_discount = 0,
  subtotal_supply = 0,
  subtotal_works = 0,
  gst_supply_amount = 0,
  gst_works_amount = 0,
  shiroi_revenue = 0,
  shiroi_cost = 0,
  gross_margin_amount = 0,
  gross_margin_pct = 0,
  financials_invalidated = TRUE,
  financials_invalidated_at = NOW(),
  financials_invalidated_reason = format(
    'Reset by migration 089 on %s. Original total_after_discount=%s for system_size_kwp=%s (per-kWp=%s, threshold=%s, kwp_confident=%s). Cause: BOM extracted from wrong file in co-mingled lead folder. Re-quote to populate.',
    NOW()::date,
    t.total_after_discount,
    t.system_size_kwp,
    ROUND(t.per_kwp),
    CASE WHEN t.kwp_confident THEN '₹2L/kWp' ELSE '₹5L/kWp' END,
    t.kwp_confident
  ),
  system_size_uncertain = NOT t.kwp_confident
FROM tier_a_targets t
WHERE p.id = t.id;

-- Sever the FK link from project_boq_items before deleting the BOM lines.
-- The BOQ items are derived from corrupted BOM lines (wrong file), so their
-- bom_line_id reference is meaningless. NULL it out rather than cascade-delete
-- the BOQ items — a PM may have manually adjusted quantities on those rows.
-- (project_boq_items.bom_line_id FK is NO ACTION, not CASCADE.)
UPDATE project_boq_items boq
SET bom_line_id = NULL
WHERE bom_line_id IN (
  SELECT pbl.id
  FROM proposal_bom_lines pbl
  WHERE pbl.proposal_id IN (SELECT id FROM tier_a_targets)
);

-- Drop the contaminating BOM lines (otherwise re-summing them re-corrupts).
DELETE FROM proposal_bom_lines
WHERE proposal_id IN (SELECT id FROM tier_a_targets);

COMMIT;
