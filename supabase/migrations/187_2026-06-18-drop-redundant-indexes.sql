-- ============================================================================
-- Migration 187 — drop redundant indexes on projects & leads
-- Date: 2026-06-18
-- Context: docs/reviews/2026-06-18-projects-leads-search-perf.md
--
-- Diagnosed that query planning (not execution) dominates cost on the projects
-- and leads list/search pages — every plan reads 700–900 catalog buffers, and
-- each extra index on these hot tables adds to that planning work. These four
-- indexes are pure redundancy:
--   * two are exact duplicates of the FK index on the same column
--   * two are shadowed by the UNIQUE-constraint index on the same column
-- Dropping them lowers per-query planning cost with ZERO loss of index coverage
-- (verified: project_number lookups still use projects_project_number_key).
--
-- Applied to DEV 2026-06-18. Prod: deferred (see project: dev-only, no prod).
-- ============================================================================

-- Exact duplicates of the FK index (identical btree(company_id))
DROP INDEX IF EXISTS public.idx_leads_company;       -- dup of idx_leads_company_id
DROP INDEX IF EXISTS public.idx_projects_company;    -- dup of idx_projects_company_id

-- Shadowed by the UNIQUE-constraint index on the same column
DROP INDEX IF EXISTS public.idx_projects_number;     -- covered by projects_project_number_key UNIQUE(project_number)
DROP INDEX IF EXISTS public.idx_projects_proposal;   -- covered by projects_proposal_id_key UNIQUE(proposal_id)
