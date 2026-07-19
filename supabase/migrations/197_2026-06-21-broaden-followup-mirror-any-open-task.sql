-- ============================================================================
-- Migration 197 — Broaden the lead "Next Follow-up" mirror to ANY open task
-- Date: 2026-06-21
-- Why: Mig 193 made leads.next_followup_date mirror the earliest OPEN
--      lead_followup *task*. But the lead "Add Task" box (quick-add-task.tsx)
--      lets reps pick a Type — Call / Site visit / Document / Payment / Other —
--      and reps overwhelmingly track their real next step as a Call/Document/
--      Site-visit task, NOT a "Follow-up"-typed one. The mig-193 mirror ignored
--      those: once the lead_followup task was completed the date froze in the
--      past while a future Call/Document task sat open in the lead. (Reported:
--      ~7 leads on dev showing a past Next-Follow-up date with a later open task,
--      e.g. Chitra kannan nfd 06-15 / open "call" due 06-22; Smridhi kalati
--      nfd 06-17 / open "document" due 06-26.)
--
--      Per Vivek's call (2026-06-21): the Next Follow-up date tracks the EARLIEST
--      open task of ANY type on the lead. This migration:
--        (1) broadens the task → lead trigger (sync_followup_task_to_lead) to
--            drop the category = 'lead_followup' filter, and
--        (2) re-runs the reconcile over ALL open lead tasks (idempotent).
--
--      The lead → task direction (sync_lead_followup_task, mig 108/193) is left
--      UNCHANGED: setting a lead's follow-up date directly still materialises a
--      canonical 'lead_followup' task. During the one-time reconcile that trigger
--      is disabled so backfilling a date from a Call/Document task does NOT spawn
--      a phantom 'lead_followup' task duplicating it.
--
--      Known minor behaviour (acceptable, self-heals): if a rep sets a lead's
--      follow-up date directly to a date LATER than an existing earlier open task,
--      next_followup_date holds the typed date until the next task event, when the
--      broadened trigger recomputes MIN(open task due). The depth guard prevents
--      ping-pong between the two directions.
-- ============================================================================

BEGIN;

-- ── (1) Broaden task → lead sync: earliest OPEN task of ANY category ─────────
-- Identical to mig 193 except the MIN(due_date) and the lead-collection no
-- longer filter on category = 'lead_followup'. Still scoped to entity_type =
-- 'lead', still depth-guarded so it never fires as a nested (lead → task) call.
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

  -- Collect the lead(s) whose open-task set may have changed. ANY category now
  -- (mig 197): a Call / Site-visit / Document task is a valid "next action".
  IF TG_OP = 'UPDATE'
     AND OLD.entity_type = 'lead' AND OLD.entity_id IS NOT NULL THEN
    v_lead_ids := v_lead_ids || OLD.entity_id;
  END IF;
  IF NEW.entity_type = 'lead' AND NEW.entity_id IS NOT NULL THEN
    v_lead_ids := v_lead_ids || NEW.entity_id;
  END IF;

  v_lead_ids := ARRAY(SELECT DISTINCT x FROM unnest(v_lead_ids) AS x WHERE x IS NOT NULL);

  FOREACH v_lead_id IN ARRAY v_lead_ids LOOP
    SELECT MIN(due_date) INTO v_new_date
    FROM tasks
    WHERE entity_type  = 'lead'
      AND entity_id    = v_lead_id
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

-- The trigger itself is unchanged from mig 193 — it already fires on the right
-- columns for tasks of EVERY category:
--   AFTER INSERT OR UPDATE OF due_date, is_completed, deleted_at, category,
--   entity_id, entity_type ON tasks. The category scoping lived only in the
--   function body (now removed), so no trigger redefinition is needed.

-- ── (2) One-time reconcile over ALL open lead tasks (idempotent) ─────────────
-- Disable the lead → task trigger so filling a date from a Call/Document task
-- does NOT spawn a phantom 'lead_followup' task. Re-enabled immediately after.
-- NULL-result rows are intentionally skipped: a lead with a follow-up date but
-- no open task keeps its date (we only FILL / CORRECT from a real open task,
-- never wipe a date here) — mirrors mig 193's non-destructive reconcile.
ALTER TABLE leads DISABLE TRIGGER trg_sync_lead_followup_task;

WITH desired AS (
  SELECT l.id AS lead_id,
         (SELECT MIN(t.due_date)
            FROM tasks t
           WHERE t.entity_type  = 'lead'
             AND t.entity_id    = l.id
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

ALTER TABLE leads ENABLE TRIGGER trg_sync_lead_followup_task;

COMMIT;
