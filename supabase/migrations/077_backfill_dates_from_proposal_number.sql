-- ============================================================================
-- Migration 077 — Backfill proposal/lead dates from proposal_number
-- ============================================================================
-- Context: Migrations 073 + 076 fixed projects and the proposals/leads that
-- cascaded from them. That still leaves 438 proposals (and ~26 leads) stuck
-- in the April-2026 import clobber — these are proposals that never became
-- projects, so no project-linked signal could reach them.
--
-- Shiroi's proposal_number field encodes year in several historic formats:
--   - SHIROI/PROP/YYYY-YY/NNNN  (FY-structured, e.g. 2022-23)   — 71 rows
--   - PVNNN/YY-YY               (old FY format, e.g. 25-26)     — 77 rows
--   - PV NNN/YY                 (old CY format, e.g. /24)       — 162 rows
--   - SE/PV/NNN/YYYY            (legacy CY, 4-digit)            —  12 rows
--   - SE/PV/NNN/YY-YY or /YY    (legacy CY/FY)                  — 171 rows
--   - sequential (137, 137.2)   (no year info)                  —  ~5 rows (skipped)
--
-- Parsing rules (order matters — 4-digit year tested before 2-digit):
--   - "/YYYY-YY/"  → FY start year YYYY, April 1 IST
--   - "/YYYY$"     → calendar year YYYY, January 1 IST
--   - ".../YY-YY"  → FY start 2000+YY, April 1 IST
--   - ".../YY"     → calendar year 2000+YY, January 1 IST (most conservative)
--
-- We take LEAST(current, parsed_date) so dates only move earlier. After the
-- proposal fix, we re-run the lead cascade (MIN of linked proposals).
--
-- Safety:
--   - Window-scoped: only touches proposals with created_at in the clobber
--     window [2026-04-01, 2026-04-16). Proposals created legitimately in
--     FY2026-27 (parsed_year = 2026) are excluded to avoid snapping them
--     back to a date before their own FY started.
--   - Idempotent: LEAST guards on every update.
--   - No schema changes.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Proposals — created_at ← LEAST(current, parsed_date_from_proposal_number)
-- ------------------------------------------------------------------
WITH parsed AS (
  SELECT
    id,
    proposal_number,
    created_at,
    CASE
      -- "/YYYY-YY/" embedded FY (SHIROI/PROP/2024-25/...)
      WHEN proposal_number ~ '/(20[0-9]{2})-[0-9]{2}/' THEN
        make_timestamptz(
          (regexp_match(proposal_number, '/(20[0-9]{2})-[0-9]{2}/'))[1]::int,
          4, 1, 0, 0, 0, 'Asia/Kolkata')
      -- "/YYYY$" trailing 4-digit calendar year (e.g. SE/PV/093/2023)
      WHEN proposal_number ~ '/(20[0-9]{2})$' THEN
        make_timestamptz(
          (regexp_match(proposal_number, '/(20[0-9]{2})$'))[1]::int,
          1, 1, 0, 0, 0, 'Asia/Kolkata')
      -- "/YY-YY" trailing FY (e.g. PV007/25-26)
      WHEN proposal_number ~ '/([0-9]{2})-[0-9]{2}$' THEN
        make_timestamptz(
          2000 + (regexp_match(proposal_number, '/([0-9]{2})-[0-9]{2}$'))[1]::int,
          4, 1, 0, 0, 0, 'Asia/Kolkata')
      -- "/YY" trailing calendar year (e.g. PV 210/24)
      WHEN proposal_number ~ '/([0-9]{2})$' THEN
        make_timestamptz(
          2000 + (regexp_match(proposal_number, '/([0-9]{2})$'))[1]::int,
          1, 1, 0, 0, 0, 'Asia/Kolkata')
      ELSE NULL
    END AS parsed_date
  FROM proposals
  WHERE created_at >= '2026-04-01T00:00:00+05:30'::timestamptz
    AND created_at <  '2026-04-16T00:00:00+05:30'::timestamptz
)
UPDATE proposals pr
SET created_at = LEAST(pr.created_at, p.parsed_date)
FROM parsed p
WHERE p.id = pr.id
  AND p.parsed_date IS NOT NULL
  -- Exclude FY2026-27+ proposals (legitimate current-FY proposals)
  AND p.parsed_date < '2026-04-01T00:00:00+05:30'::timestamptz
  AND p.parsed_date < pr.created_at;

-- ------------------------------------------------------------------
-- 2. Leads — created_at ← MIN(current, earliest linked proposal.created_at)
--    Re-run the cascade to catch leads whose only signal is a newly-
--    backfilled proposal from step 1.
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
