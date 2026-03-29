-- ============================================================
-- Migration 007f — Universal Tasks Table
-- File: supabase/migrations/007f_universal_tasks.sql
-- Description: Rename project_tasks to tasks. Add entity_type
--              and entity_id so tasks can belong to any domain:
--              projects, leads, O&M tickets, procurement, HR.
--              Enables unified "my tasks today" view across all
--              domains in the mobile app and ERP dashboard.
-- Date: 2026-03-29
-- Rollback:
--   ALTER TABLE tasks RENAME TO project_tasks;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS entity_type;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS entity_id;
-- Dependencies: 004a_projects_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Step 1: Rename the table
-- All existing FKs and triggers rename automatically with it.
-- ------------------------------------------------------------
ALTER TABLE project_tasks RENAME TO tasks;


-- ------------------------------------------------------------
-- Step 2: Add entity_type + entity_id columns
-- entity_type: which domain this task belongs to
-- entity_id:   the UUID of the record in that domain
-- project_id and milestone_id remain — now nullable for non-project tasks
-- ------------------------------------------------------------
ALTER TABLE tasks
  ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'project'
    CHECK (entity_type IN (
      'project',
      'lead',
      'om_ticket',
      'procurement',
      'hr'
    )),
  ADD COLUMN entity_id UUID;
-- entity_id NULL = legacy project tasks (uses project_id FK instead).
-- For new non-project tasks: entity_id holds the FK to the domain record.
-- project_id stays as an explicit FK for project tasks — it's more
-- useful than a generic entity_id for JOIN queries on the most common case.

-- Make project_id nullable now that tasks can belong to other domains
ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL;

COMMENT ON COLUMN tasks.entity_type IS
  'Which domain this task belongs to. '
  'project: use project_id FK. '
  'lead: entity_id = leads.id. '
  'om_ticket: entity_id = om_service_tickets.id. '
  'procurement: entity_id = purchase_orders.id. '
  'hr: entity_id = employees.id.';

COMMENT ON COLUMN tasks.entity_id IS
  'UUID of the record this task is attached to. '
  'NULL for project tasks (use project_id FK instead). '
  'Populated for lead, om_ticket, procurement, hr tasks.';


-- ------------------------------------------------------------
-- Step 3: Add index on entity_type + entity_id for fast lookup
-- "All open tasks for lead X" — used in lead detail screen.
-- ------------------------------------------------------------
CREATE INDEX idx_tasks_entity ON tasks(entity_type, entity_id)
  WHERE entity_id IS NOT NULL AND is_completed = FALSE AND deleted_at IS NULL;

CREATE INDEX idx_tasks_assigned_open ON tasks(assigned_to)
  WHERE is_completed = FALSE AND deleted_at IS NULL;
-- "All my open tasks across all domains" — used in mobile home screen.


-- ------------------------------------------------------------
-- Step 4: Update RLS policy name to match new table name
-- The policy logic is unchanged — just recreate with correct name.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "project_tasks_read" ON tasks;
DROP POLICY IF EXISTS "project_tasks_write" ON tasks;

CREATE POLICY "tasks_read"
  ON tasks FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'hr_manager')
    OR assigned_to = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR created_by  = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "tasks_write"
  ON tasks FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor',
       'sales_engineer', 'om_technician', 'hr_manager')
  );

-- Rename trigger to match new table name (cosmetic — works either way)
ALTER TRIGGER project_tasks_updated_at ON tasks
  RENAME TO tasks_updated_at;

COMMIT;