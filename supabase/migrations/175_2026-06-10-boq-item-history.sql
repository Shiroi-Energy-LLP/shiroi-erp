-- =============================================================================
-- Migration 175 — project_boq_item_history (BOI item edit audit)
-- Spec: docs/superpowers/specs/2026-06-10-project-module-enhancements-design.md
-- PM/founder may edit BOI items in ANY state (including locked); the audit row
-- is the guardrail that replaces hard immutability. Append-only.
-- =============================================================================

CREATE TABLE project_boq_item_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_item_id  UUID NOT NULL REFERENCES project_boq_items(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id),
  boi_id       UUID REFERENCES project_bois(id),
  changed_by   UUID NOT NULL REFERENCES employees(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes      JSONB NOT NULL   -- { "<field>": { "old": ..., "new": ... }, ... }
);

CREATE INDEX idx_boq_item_history_item    ON project_boq_item_history(boq_item_id);
CREATE INDEX idx_boq_item_history_project ON project_boq_item_history(project_id);
CREATE INDEX idx_boq_item_history_at      ON project_boq_item_history(changed_at DESC);

ALTER TABLE project_boq_item_history ENABLE ROW LEVEL SECURITY;

-- Everyone reads the audit trail
CREATE POLICY "boq_item_history_read" ON project_boq_item_history
  FOR SELECT TO authenticated USING (true);

-- Only PM/founder append, and only attributed to themselves.
-- No UPDATE/DELETE policies: append-only by construction.
CREATE POLICY "boq_item_history_insert" ON project_boq_item_history
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('founder', 'project_manager')
    AND changed_by = get_my_employee_id()
  );
