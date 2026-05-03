-- ============================================================================
-- Migration 108 — Auto-create lead-follow-up tasks + NOT NULL assigned_to
-- Date: 2026-05-02
-- Why: (1) Sales reps' next_followup_date on leads never materializes as a
--      task, so /my-tasks (and the new /sales/tasks team view) is empty for
--      sales-flavoured work. Adding a trigger + backfill closes that loop.
--      (2) Enforce that every task has an assignee — defeats the purpose of a
--      task list otherwise. Dev verified zero unassigned (non-deleted); the
--      one soft-deleted NULL row is defensively backfilled first.
-- ============================================================================

BEGIN;

-- ── (0) Expand category check constraint to include lead_followup ─────────

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
    'lead_followup'::text
  ]))
);

-- ── (1) Lead follow-up sync function + trigger ────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_lead_followup_task()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_existing_task_id UUID;
  v_assignee UUID;
BEGIN
  -- Only act when lead is alive
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve assignee: lead's assigned_to, fallback to oldest active
  -- marketing_manager, final fallback to founder. NEVER NULL.
  v_assignee := COALESCE(
    NEW.assigned_to,
    (SELECT e.id FROM employees e
       JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'marketing_manager' AND e.is_active = TRUE
      ORDER BY e.created_at ASC LIMIT 1),
    (SELECT e.id FROM employees e
       JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'founder' AND e.is_active = TRUE
      ORDER BY e.created_at ASC LIMIT 1)
  );

  -- Find existing OPEN follow-up task for this lead, if any
  SELECT id INTO v_existing_task_id
  FROM tasks
  WHERE entity_type  = 'lead'
    AND entity_id    = NEW.id
    AND category     = 'lead_followup'
    AND is_completed = FALSE
    AND deleted_at IS NULL
  LIMIT 1;

  IF NEW.next_followup_date IS NULL THEN
    -- Follow-up cleared: soft-close any open follow-up task
    IF v_existing_task_id IS NOT NULL THEN
      UPDATE tasks
      SET is_completed = TRUE,
          completed_at = NOW(),
          completed_by = NEW.assigned_to,
          updated_at   = NOW()
      WHERE id = v_existing_task_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Upsert: update existing open task or insert a new one
  IF v_existing_task_id IS NOT NULL THEN
    UPDATE tasks
    SET due_date    = NEW.next_followup_date,
        assigned_to = v_assignee,
        updated_at  = NOW()
    WHERE id = v_existing_task_id;
  ELSE
    INSERT INTO tasks (
      entity_type, entity_id, category, title,
      assigned_to, due_date, created_by, priority
    ) VALUES (
      'lead', NEW.id, 'lead_followup',
      'Follow up: ' || NEW.customer_name,
      v_assignee, NEW.next_followup_date, v_assignee, 'medium'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lead_followup_task ON leads;

CREATE TRIGGER trg_sync_lead_followup_task
  AFTER INSERT OR UPDATE OF next_followup_date, assigned_to, deleted_at ON leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_followup_task();

-- ── (2) Backfill tasks for currently-active leads with future follow-ups ──

WITH leads_needing_task AS (
  SELECT l.*
  FROM leads l
  WHERE l.deleted_at IS NULL
    AND l.next_followup_date IS NOT NULL
    AND l.next_followup_date >= CURRENT_DATE
    AND l.status NOT IN ('won', 'lost', 'on_hold', 'disqualified', 'converted')
    AND NOT EXISTS (
      SELECT 1 FROM tasks t
       WHERE t.entity_type  = 'lead'
         AND t.entity_id    = l.id
         AND t.category     = 'lead_followup'
         AND t.is_completed = FALSE
         AND t.deleted_at IS NULL
    )
)
INSERT INTO tasks (entity_type, entity_id, category, title, assigned_to, due_date, created_by, priority)
SELECT
  'lead',
  l.id,
  'lead_followup',
  'Follow up: ' || l.customer_name,
  COALESCE(
    l.assigned_to,
    (SELECT e.id FROM employees e JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'marketing_manager' AND e.is_active = TRUE ORDER BY e.created_at ASC LIMIT 1)
  ),
  l.next_followup_date,
  COALESCE(
    l.assigned_to,
    (SELECT e.id FROM employees e JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'marketing_manager' AND e.is_active = TRUE ORDER BY e.created_at ASC LIMIT 1)
  ),
  'medium'
FROM leads_needing_task l
WHERE COALESCE(
  l.assigned_to,
  (SELECT e.id FROM employees e JOIN profiles p ON p.id = e.profile_id
    WHERE p.role = 'marketing_manager' AND e.is_active = TRUE ORDER BY e.created_at ASC LIMIT 1)
) IS NOT NULL;

-- ── (3) Defensive backfill of any NULL assigned_to (incl. soft-deleted) ──

UPDATE tasks t
SET assigned_to = COALESCE(
  -- Prefer project's PM
  (SELECT pr.project_manager_id FROM projects pr WHERE pr.id = t.project_id),
  -- Then lead owner
  (SELECT l.assigned_to FROM leads l WHERE l.id = t.entity_id AND t.entity_type = 'lead'),
  -- Then oldest active founder (sentinel)
  (SELECT e.id FROM employees e JOIN profiles p ON p.id = e.profile_id
    WHERE p.role = 'founder' AND e.is_active = TRUE ORDER BY e.created_at ASC LIMIT 1)
)
WHERE t.assigned_to IS NULL;

-- ── (4) Assertion then NOT NULL constraint on tasks.assigned_to ──────────

DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM tasks WHERE assigned_to IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL: % tasks still unassigned after backfill', v_count;
  END IF;
END $$;

ALTER TABLE tasks ALTER COLUMN assigned_to SET NOT NULL;

-- ── (5) Index for team-tasks query (entity_type + open + due_date) ───────

CREATE INDEX IF NOT EXISTS idx_tasks_sales_team
  ON tasks (entity_type, is_completed, deleted_at, due_date)
  WHERE is_completed = FALSE AND deleted_at IS NULL;

COMMIT;
