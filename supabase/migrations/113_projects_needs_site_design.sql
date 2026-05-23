-- ============================================================================
-- Migration 113 — projects.needs_site_design (At-Site Design request flag)
-- Date: 2026-05-20
--
-- Vivek's round-2 marketing feedback: /design queue should not only show leads
-- in the design pipeline, but also won projects that the project_manager
-- (Manivel) has explicitly flagged as needing the design team to produce an
-- at-site layout (e.g. unusual roof geometry, post-survey changes).
--
-- One transient flag per project. The design team clears it when they're done.
-- If we later need request history, that becomes a separate
-- project_design_requests table — for v1 a boolean + audit trio is enough.
-- ============================================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS needs_site_design BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_site_design_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS needs_site_design_requested_by UUID NULL REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS needs_site_design_note TEXT NULL;

COMMENT ON COLUMN projects.needs_site_design IS
  'Flagged TRUE by project_manager when a won project needs the design team to produce an at-site layout (e.g. unusual roof geometry or post-survey changes). Surfaces in /design Section 2.';

CREATE INDEX IF NOT EXISTS idx_projects_needs_site_design
  ON projects(needs_site_design_requested_at DESC)
  WHERE needs_site_design = TRUE AND deleted_at IS NULL;
