-- Migration 012: Allow NULL changed_by in lead_status_history for system operations
-- Date: April 3, 2026
-- Purpose: Admin/migration scripts run without an auth session, so auth.uid() is NULL.
--          The NOT NULL constraint on changed_by blocks status updates from system operations.
--          Dropping it allows migration scripts and system automation to update lead status
--          while still recording the employee ID when available (normal app usage).
--
-- Impact: lead_status_history.changed_by becomes optional.
--         Normal app operations still populate it via auth.uid() in the trigger.
--         Migration/admin operations leave it NULL (= "system/migration").

ALTER TABLE lead_status_history ALTER COLUMN changed_by DROP NOT NULL;

-- Verify
DO $$
BEGIN
  RAISE NOTICE 'Migration 012 complete: changed_by is now nullable on lead_status_history';
END $$;
