-- ============================================================================
-- Migration 212 — Projects: next_followup_date + status_rank + follow-up task sync
-- (Renumbered from 210 — a parallel purchase-flow session took 210/211 first.)
-- Date: 2026-07-20
-- Spec: docs/superpowers/specs/2026-07-20-projects-list-dates-followup-multistatus-design.md
-- Why: (1) /projects list gains Expected Start / Expected Completion (reusing
--      planned_start_date / planned_end_date — now sortable, so indexed per
--      NEVER-DO #17) and a Next Follow-up column for holding_client /
--      meter_client_scope chasing. (2) Sorting by status must put 'completed'
--      last — the enum's declaration order lands it in the middle, so a
--      generated status_rank column carries the workflow order. (3) Setting
--      next_followup_date auto-syncs an open task to the PM, mirroring the
--      lead follow-up trigger (mig 108).
-- ============================================================================

BEGIN;

-- ── (1) next_followup_date ────────────────────────────────────────────────

ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_followup_date DATE;

COMMENT ON COLUMN projects.next_followup_date IS
  'Next follow-up date shown/edited on the /projects list. Trigger-synced to an open project_followup task (mig 212).';

CREATE INDEX IF NOT EXISTS idx_projects_next_followup
  ON projects(next_followup_date) WHERE deleted_at IS NULL;

-- ── (2) status_rank generated column (completed last) ─────────────────────

ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_rank SMALLINT
  GENERATED ALWAYS AS (
    CASE status
      WHEN 'order_received'       THEN 1
      WHEN 'yet_to_start'         THEN 2
      WHEN 'in_progress'          THEN 3
      WHEN 'holding_shiroi'       THEN 4
      WHEN 'holding_client'       THEN 5
      WHEN 'waiting_net_metering' THEN 6
      WHEN 'meter_client_scope'   THEN 7
      WHEN 'completed'            THEN 8
    END
  ) STORED;

COMMENT ON COLUMN projects.status_rank IS
  'Workflow sort order for the status enum with completed last. Generated — never write. Used when the /projects list sorts by Status.';

CREATE INDEX IF NOT EXISTS idx_projects_status_rank
  ON projects(status_rank) WHERE deleted_at IS NULL;

-- ── (3) Indexes for the newly sortable planned-date columns ───────────────

CREATE INDEX IF NOT EXISTS idx_projects_planned_start
  ON projects(planned_start_date) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_planned_end
  ON projects(planned_end_date) WHERE deleted_at IS NULL;

-- ── (4) Allow 'project_followup' in tasks.category ────────────────────────

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_category_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_category_check CHECK (
  (category IS NULL) OR (category = ANY (ARRAY[
    'advance_payment'::text,
    'material_delivery'::text,
    'structure_installation'::text,
    'panel_installation'::text,
    'electrical_work'::text,
    'testing_commissioning'::text,
    'civil_work'::text,
    'net_metering'::text,
    'handover'::text,
    'general'::text,
    'payment_followup'::text,
    'payment_escalation'::text,
    'lead_followup'::text,
    'call'::text,
    'site_visit'::text,
    'document'::text,
    'project_followup'::text
  ]))
);

-- ── (5) Follow-up task sync trigger (mirrors sync_lead_followup_task, mig 108) ──

CREATE OR REPLACE FUNCTION public.sync_project_followup_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_task_id UUID;
  v_assignee UUID;
BEGIN
  -- Find existing OPEN follow-up task for this project, if any
  SELECT id INTO v_existing_task_id
  FROM tasks
  WHERE entity_type  = 'project'
    AND entity_id    = NEW.id
    AND category     = 'project_followup'
    AND is_completed = FALSE
    AND deleted_at IS NULL
  LIMIT 1;

  -- Project soft-deleted or follow-up cleared: soft-close any open task
  IF NEW.deleted_at IS NOT NULL OR NEW.next_followup_date IS NULL THEN
    IF v_existing_task_id IS NOT NULL THEN
      UPDATE tasks
      SET is_completed = TRUE,
          completed_at = NOW(),
          updated_at   = NOW()
      WHERE id = v_existing_task_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Resolve assignee: project's PM, fallback oldest active project_manager,
  -- final fallback oldest active founder. NEVER NULL (tasks.assigned_to is NOT NULL).
  v_assignee := COALESCE(
    NEW.project_manager_id,
    (SELECT e.id FROM employees e
       JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'project_manager' AND e.is_active = TRUE
      ORDER BY e.created_at ASC LIMIT 1),
    (SELECT e.id FROM employees e
       JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'founder' AND e.is_active = TRUE
      ORDER BY e.created_at ASC LIMIT 1)
  );

  -- Upsert: move the open task's due date/assignee, or create one.
  -- project_id is set alongside entity_type/entity_id so the task surfaces on
  -- both the project Execution tab and /tasks (universal entity model).
  IF v_existing_task_id IS NOT NULL THEN
    UPDATE tasks
    SET due_date    = NEW.next_followup_date,
        assigned_to = v_assignee,
        updated_at  = NOW()
    WHERE id = v_existing_task_id;
  ELSE
    INSERT INTO tasks (
      entity_type, entity_id, project_id, category, title,
      assigned_to, due_date, created_by, priority
    ) VALUES (
      'project', NEW.id, NEW.id, 'project_followup',
      'Follow up: ' || NEW.customer_name,
      v_assignee, NEW.next_followup_date, v_assignee, 'medium'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_followup_task ON projects;

CREATE TRIGGER trg_sync_project_followup_task
  AFTER UPDATE OF next_followup_date, project_manager_id, deleted_at ON projects
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_followup_task();

COMMIT;
