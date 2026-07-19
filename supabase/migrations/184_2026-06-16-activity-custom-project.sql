-- =============================================================================
-- Migration 184 — Activities: optional project (free-text label)
-- Spec: docs/superpowers/specs/2026-06-16-manivel-feedback-batch3-design.md
--
-- Capture activities for Service/AMC/misc work not tied to an ERP project:
-- project_id becomes nullable with a free-text project_name_custom fallback
-- (CHECK requires one of the two). project_id keeps its FK + ON DELETE CASCADE.
--
-- Dev-first; prod deferred (standing dev-only rule).
-- =============================================================================

ALTER TABLE project_activities ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_activities ADD COLUMN IF NOT EXISTS project_name_custom TEXT;
ALTER TABLE project_activities DROP CONSTRAINT IF EXISTS project_activities_project_or_custom;
ALTER TABLE project_activities ADD CONSTRAINT project_activities_project_or_custom
  CHECK (project_id IS NOT NULL OR project_name_custom IS NOT NULL);
