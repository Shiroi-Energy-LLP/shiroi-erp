-- Migration 028: BOI/BOQ project-level fields
-- Adds BOI lock state, BOQ completion state, and manual project cost for margin calculation

-- BOI lock state on projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boi_locked BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boi_locked_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boi_locked_by UUID REFERENCES employees(id);

-- BOQ completion state on projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_completed BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_completed_at TIMESTAMPTZ;

-- Manual project cost for margin calculation in BOQ summary
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_cost_manual NUMERIC(14,2);

-- Index on project_boq_items for category filtering
CREATE INDEX IF NOT EXISTS idx_project_boq_items_category ON project_boq_items(project_id, item_category);
