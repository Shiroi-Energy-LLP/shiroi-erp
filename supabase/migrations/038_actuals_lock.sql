-- Migration 038: Add actuals lock fields to projects
-- Required for Actuals Module lock/unlock mechanism per Manivel's spec

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS actuals_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS actuals_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actuals_locked_by UUID REFERENCES employees(id);

COMMENT ON COLUMN projects.actuals_locked IS 'Whether project actuals + BOQ are locked (read-only)';
COMMENT ON COLUMN projects.actuals_locked_at IS 'Timestamp when actuals were locked';
COMMENT ON COLUMN projects.actuals_locked_by IS 'Employee who locked the actuals';
