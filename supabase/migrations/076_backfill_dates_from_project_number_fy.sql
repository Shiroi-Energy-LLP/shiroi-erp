-- ============================================================================
-- Migration 076 — Backfill created_at from project_number FY + actual_start_date
-- ============================================================================
-- Context: Migration 073 fixed 12 projects that had Zoho-linked invoices/bills.
-- That leaves 154 more projects whose created_at is stuck at the overnight
-- Zoho-import clobber timestamp (2026-04-02). Zoho data couldn't reach them
-- because their project/proposal/lead links weren't populated at import time.
--
-- This migration uses two deterministic signals that don't require fuzzy
-- matching or external API calls:
--   1. project_number encodes the Indian fiscal year: SHIROI/PROJ/YYYY-YY/NNNN
--      → e.g. "/2024-25/" means FY starts 2024-04-01 and ends 2025-03-31.
--   2. actual_start_date is a date-only field set by ops when on-site work
--      began — always a hard lower bound on created_at.
--
-- We take LEAST(current_created_at, actual_start_date, FY_start) so we never
-- move a date forward, only earlier. For projects without actual_start_date
-- we fall back to FY_start (April 1 of the FY). Projects outside the clobber
-- window are untouched.
--
-- Scope:
--   - 50 FY2024-25 projects all in April 2026 clobber → snapped to ≤ 2024-04-01
--   - 104 FY2025-26 projects in April 2026 clobber → snapped to ≤ 2025-04-01
--   - 2 FY2026-27 projects: their FY just started, dates legitimate, skipped
--
-- Safety:
--   - Only touches rows with created_at in [2026-04-01, 2026-04-15) — the
--     import-batch window. Projects created normally after that date are safe.
--   - Idempotent: re-running leaves rows unchanged (LEAST never moves forward).
--   - No schema changes.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Projects — created_at ← LEAST(current, actual_start_date, FY_start)
-- ------------------------------------------------------------------
WITH parsed AS (
  SELECT
    id,
    created_at,
    actual_start_date,
    -- Parse "SHIROI/PROJ/YYYY-YY/NNNN" → FY start year (int)
    CASE
      WHEN project_number ~ '/20[0-9]{2}-[0-9]{2}/' THEN
        (regexp_match(project_number, '/(20[0-9]{2})-[0-9]{2}/'))[1]::int
      ELSE NULL
    END AS fy_start_year
  FROM projects
  WHERE created_at >= '2026-04-01T00:00:00+05:30'::timestamptz
    AND created_at <  '2026-04-16T00:00:00+05:30'::timestamptz
),
candidates AS (
  SELECT
    id,
    created_at AS old_created_at,
    -- FY start in IST = April 1 00:00 Asia/Kolkata
    make_timestamptz(fy_start_year, 4, 1, 0, 0, 0, 'Asia/Kolkata') AS fy_start_ts,
    -- actual_start_date at midnight IST (or a far-future sentinel if NULL)
    COALESCE(
      (actual_start_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata',
      '9999-12-31T00:00:00+00:00'::timestamptz
    ) AS actual_start_ts
  FROM parsed
  WHERE fy_start_year IS NOT NULL
    -- Skip FY2026-27+ where the clobber window overlaps a legitimate FY start
    AND fy_start_year <= 2025
)
UPDATE projects p
SET created_at = LEAST(c.old_created_at, c.fy_start_ts, c.actual_start_ts)
FROM candidates c
WHERE c.id = p.id
  AND LEAST(c.old_created_at, c.fy_start_ts, c.actual_start_ts) < p.created_at;

-- ------------------------------------------------------------------
-- 2. Proposals — created_at ← MIN(current, related project.created_at)
--    A proposal must predate its project, so snap proposal date back
--    whenever the linked project now has an earlier created_at.
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
