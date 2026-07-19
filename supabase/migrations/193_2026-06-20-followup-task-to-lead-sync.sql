-- ============================================================================
-- Migration 193 — Two-way sync: lead_followup task → leads.next_followup_date
-- Date: 2026-06-20
-- Why: The leads-list "Next Follow-up" column reads leads.next_followup_date.
--      Mig 108 added the lead → task direction (setting the date materializes /
--      updates one open lead_followup task). The REVERSE never existed: when a
--      rep creates / reschedules / completes a lead_followup task inside the
--      lead's Tasks tab, next_followup_date stayed stale, so the leads list
--      didn't reflect it (the reported bug — Prem's new follow-up task didn't
--      move the list date).
--      This adds the task → lead direction and guards BOTH triggers against
--      mutual recursion via pg_trigger_depth(), so they never ping-pong.
-- ============================================================================

BEGIN;

-- ── (1) Re-entrancy guard on the existing lead → task sync (mig 108) ──────────
-- Identical body to mig 108 plus a pg_trigger_depth() short-circuit so it no
-- longer fires when the new task → lead trigger updates the lead. Behaviour is
-- unchanged for direct lead edits (those always run at depth 1 today). The
-- guard also stops the old trigger from re-stamping a task's assignee on the
-- echo update fired by the reverse sync.
CREATE OR REPLACE FUNCTION public.sync_lead_followup_task()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_existing_task_id UUID;
  v_assignee UUID;
BEGIN
  -- Only act on direct DML on leads, never as a nested (task → lead) trigger.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

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

-- ── (2) New task → lead sync ─────────────────────────────────────────────────
-- When an open lead_followup task is created / rescheduled / completed / soft-
-- deleted, set the owning lead's next_followup_date to the EARLIEST remaining
-- open lead_followup task (NULL when none remain — the exact mirror of mig 108
-- clearing the date auto-completing the task). Reconciles both OLD and NEW lead
-- so a category / entity reassignment fixes up both sides.
CREATE OR REPLACE FUNCTION public.sync_followup_task_to_lead()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_lead_ids UUID[] := ARRAY[]::UUID[];
  v_lead_id  UUID;
  v_new_date DATE;
BEGIN
  -- Only act on direct DML on tasks, never as a nested (lead → task) trigger.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Collect the lead(s) whose open-follow-up set may have changed.
  IF TG_OP = 'UPDATE'
     AND OLD.entity_type = 'lead' AND OLD.category = 'lead_followup'
     AND OLD.entity_id IS NOT NULL THEN
    v_lead_ids := v_lead_ids || OLD.entity_id;
  END IF;
  IF NEW.entity_type = 'lead' AND NEW.category = 'lead_followup'
     AND NEW.entity_id IS NOT NULL THEN
    v_lead_ids := v_lead_ids || NEW.entity_id;
  END IF;

  v_lead_ids := ARRAY(SELECT DISTINCT x FROM unnest(v_lead_ids) AS x WHERE x IS NOT NULL);

  FOREACH v_lead_id IN ARRAY v_lead_ids LOOP
    SELECT MIN(due_date) INTO v_new_date
    FROM tasks
    WHERE entity_type  = 'lead'
      AND entity_id    = v_lead_id
      AND category     = 'lead_followup'
      AND is_completed = FALSE
      AND deleted_at IS NULL;

    UPDATE leads
    SET next_followup_date = v_new_date,
        updated_at = NOW()
    WHERE id = v_lead_id
      AND deleted_at IS NULL
      AND next_followup_date IS DISTINCT FROM v_new_date;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_followup_task_to_lead() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_sync_followup_task_to_lead ON tasks;
CREATE TRIGGER trg_sync_followup_task_to_lead
  AFTER INSERT OR UPDATE OF due_date, is_completed, deleted_at, category, entity_id, entity_type
  ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_followup_task_to_lead();

-- ── (3) One-time reconcile of existing drift (idempotent, non-destructive) ────
-- Correct leads whose stored next_followup_date disagrees with their earliest
-- open lead_followup task. NULL-result rows are intentionally skipped: a lead
-- with a follow-up date but no open follow-up task keeps its date (we only
-- FILL / CORRECT from a real task, never wipe a date here).
WITH desired AS (
  SELECT l.id AS lead_id,
         (SELECT MIN(t.due_date)
            FROM tasks t
           WHERE t.entity_type  = 'lead'
             AND t.entity_id    = l.id
             AND t.category     = 'lead_followup'
             AND t.is_completed = FALSE
             AND t.deleted_at IS NULL) AS new_date
  FROM leads l
  WHERE l.deleted_at IS NULL
)
UPDATE leads l
SET next_followup_date = d.new_date,
    updated_at = NOW()
FROM desired d
WHERE l.id = d.lead_id
  AND d.new_date IS NOT NULL
  AND l.next_followup_date IS DISTINCT FROM d.new_date;

COMMIT;
