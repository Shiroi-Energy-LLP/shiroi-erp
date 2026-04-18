-- ============================================================================
-- Migration 073 — Backfill created_at from earliest Zoho activity
-- ============================================================================
-- Context: After Zoho Books backfill (migrations 067–072), we discovered
-- that import-batch timestamps had clobbered real project/proposal/lead
-- dates. Most leads cluster at 3 exact HubSpot-import timestamps in
-- Sep 2025, and a second batch clusters at 2026-04-02 from the overnight
-- Zoho run. See reconciliation output in CHANGELOG.
--
-- This migration fixes the 12 projects that have Zoho-imported activity
-- (invoices / bills / purchase_orders / expenses) — their earliest Zoho
-- transaction date is a lower bound on when the project must have existed.
-- We then cascade the correction back to any proposal and lead whose
-- stored created_at is later than its related project's corrected date.
--
-- Scope limitations:
--   - Only 12 projects link to Zoho activity (most Zoho bills are unlinked
--     at the vendor-only level). Proposal-level backfill from Google Drive
--     folder dates is a separate later step.
--   - We take MIN(current, new) on the cascade side so we never move a
--     date forward — only earlier.
--
-- Safety:
--   - Idempotent: re-running leaves rows unchanged (MIN/LEAST guards).
--   - No schema changes.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Projects — created_at ← MIN(Zoho activity date) when ERP date is later
-- ------------------------------------------------------------------
WITH zoho_first AS (
  SELECT project_id, MIN(d) AS first_zoho_date
  FROM (
    SELECT project_id, invoice_date::timestamptz AS d FROM invoices
      WHERE project_id IS NOT NULL AND zoho_invoice_id IS NOT NULL
    UNION ALL
    SELECT project_id, bill_date::timestamptz FROM vendor_bills
      WHERE project_id IS NOT NULL AND zoho_bill_id IS NOT NULL
    UNION ALL
    SELECT project_id, po_date::timestamptz FROM purchase_orders
      WHERE project_id IS NOT NULL AND zoho_po_id IS NOT NULL
    UNION ALL
    SELECT project_id, expense_date::timestamptz FROM expenses
      WHERE project_id IS NOT NULL AND zoho_expense_id IS NOT NULL
  ) x
  WHERE project_id IS NOT NULL
  GROUP BY project_id
)
UPDATE projects p
SET created_at = zf.first_zoho_date
FROM zoho_first zf
WHERE zf.project_id = p.id
  AND p.created_at > zf.first_zoho_date;

-- ------------------------------------------------------------------
-- 2. Proposals — created_at ← MIN(current, related project.created_at)
--    A proposal must predate its project, so if the proposal's stored
--    created_at is later than the newly-backfilled project date, snap it
--    back. We only touch proposals that belong to the 12 Zoho-linked
--    projects (via the proposal_id link on projects).
-- ------------------------------------------------------------------
UPDATE proposals pr
SET created_at = LEAST(pr.created_at, pj.created_at)
FROM projects pj
WHERE pj.proposal_id = pr.id
  AND pr.created_at > pj.created_at;

-- ------------------------------------------------------------------
-- 3. Leads — created_at ← MIN(current, earliest linked proposal.created_at)
-- ------------------------------------------------------------------
WITH lead_first_proposal AS (
  SELECT lead_id, MIN(created_at) AS earliest
  FROM proposals
  WHERE lead_id IS NOT NULL
  GROUP BY lead_id
)
UPDATE leads l
SET created_at = LEAST(l.created_at, lfp.earliest)
FROM lead_first_proposal lfp
WHERE lfp.lead_id = l.id
  AND l.created_at > lfp.earliest;

COMMIT;
