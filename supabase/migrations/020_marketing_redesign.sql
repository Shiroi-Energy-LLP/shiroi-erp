-- Migration 020: Marketing redesign — pipeline fields + archived flag
-- Adds expected_close_date, close_probability, is_archived to leads table.

-- Add expected close date (when do we expect to close this deal?)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS expected_close_date date;

-- Add close probability (0-100, for weighted pipeline)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS close_probability smallint DEFAULT 0
  CHECK (close_probability >= 0 AND close_probability <= 100);

-- Add archived flag (for "to check" leads that are parked)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- Add index for stage-based queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_leads_status_archived
  ON leads (status, is_archived)
  WHERE deleted_at IS NULL;

-- Add index for pipeline date-based views
CREATE INDEX IF NOT EXISTS idx_leads_expected_close
  ON leads (expected_close_date)
  WHERE deleted_at IS NULL AND status NOT IN ('won', 'lost', 'disqualified', 'converted');

-- Comment for documentation
COMMENT ON COLUMN leads.expected_close_date IS 'Expected close date for weighted pipeline forecasting';
COMMENT ON COLUMN leads.close_probability IS 'Close probability 0-100% for weighted pipeline value';
COMMENT ON COLUMN leads.is_archived IS 'Archived/parked leads — hidden from main list, visible via filter';
