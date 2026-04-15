-- ============================================================================
-- Migration 055 - Lead status trigger FK fix + won-to-project cascade
-- ============================================================================
-- Three bugs found during Apr 15 user testing:
--
--   1. `log_lead_status_change()` inserted `auth.uid()` directly into
--      `lead_status_history.changed_by`, but that column is FK to
--      `employees.id` (not profiles/auth.users). Same bug as
--      `log_project_status_change` which was fixed in migration 031.
--      Any attempt to change a lead's status failed with:
--        "insert on table lead_status_history violates foreign key
--         constraint lead_status_history_changed_by_fkey"
--      Fix: look up the employee row via profile_id + fall back to NULL
--      (the column is nullable since migration 012 exactly for system ops).
--
--   2. Flipping a lead to 'won' via the normal status dropdown or via
--      closure-actions.attemptWon() updated only `leads` — the related
--      proposal stayed in draft/sent, so the existing
--      `create_project_from_accepted_proposal` trigger (which fires on
--      proposals.status = 'accepted') never ran, and no project was
--      auto-created.
--      Fix: new AFTER-UPDATE trigger on leads that, on the 'won'
--      transition, finds the most recent in-play proposal for the lead
--      (detailed preferred over budgetary, most recent wins), marks it
--      'accepted' — which cascades into the existing proposal trigger
--      and creates the project.
--
-- (The third bug — the status dropdown showing legacy/terminal values
-- not on the stepper — is a TypeScript-only fix in leads-helpers.ts,
-- no schema change needed.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fix 1: log_lead_status_change — resolve employee_id from profile_id
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_lead_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_employee_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Look up the caller's employee record via profile_id (auth.uid()).
    -- changed_by was made nullable in migration 012 so system/migration
    -- operations without an employee context still work.
    -- NOTE: employees table has is_active boolean, not deleted_at timestamp.
    SELECT id INTO v_employee_id
      FROM employees
      WHERE profile_id = auth.uid()
      LIMIT 1;

    INSERT INTO lead_status_history (
      lead_id, changed_by, from_status, to_status
    ) VALUES (
      NEW.id, v_employee_id, OLD.status, NEW.status
    );

    NEW.status_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$func$;

-- ----------------------------------------------------------------------------
-- Fix 1b: Latent bugs in migration 052 — employees.deleted_at references
-- ----------------------------------------------------------------------------
-- Migration 052 added create_payment_followup_tasks() v2 and
-- enqueue_payment_escalations() — both filter on `e.deleted_at IS NULL` but
-- the employees table has `is_active BOOLEAN`, not `deleted_at`. These bugs
-- are latent until a project status change fires the trigger or the
-- hourly pg_cron job runs. Rewrite both without the soft-delete filter.

CREATE OR REPLACE FUNCTION public.create_payment_followup_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_schedule            RECORD;
  v_task_exists         BOOLEAN;
  v_milestone_order     INT;
  v_followup_due_date   DATE;
  v_marketing_mgr_id    UUID;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_milestone_order := CASE NEW.status::text
    WHEN 'in_progress'          THEN 2
    WHEN 'waiting_net_metering' THEN 4
    WHEN 'completed'            THEN 4
    ELSE NULL
  END;

  IF v_milestone_order IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.id INTO v_marketing_mgr_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'marketing_manager'
    AND e.is_active = TRUE
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF v_marketing_mgr_id IS NULL THEN
    v_marketing_mgr_id := NEW.project_manager_id;
  END IF;

  FOR v_schedule IN
    SELECT pps.milestone_name,
           pps.amount,
           pps.percentage,
           pps.milestone_order,
           pps.followup_sla_days
    FROM proposals p
    JOIN proposal_payment_schedule pps ON pps.proposal_id = p.id
    WHERE p.lead_id = NEW.lead_id
      AND p.status = 'accepted'
      AND pps.milestone_order = v_milestone_order
    ORDER BY pps.milestone_order
    LIMIT 1
  LOOP
    v_followup_due_date := (CURRENT_DATE + (COALESCE(v_schedule.followup_sla_days, 7) || ' days')::interval)::date;

    SELECT EXISTS (
      SELECT 1 FROM tasks
      WHERE entity_type = 'project'
        AND entity_id = NEW.id
        AND category = 'payment_followup'
        AND title LIKE 'Payment follow-up: ' || v_schedule.milestone_name || '%'
        AND deleted_at IS NULL
    ) INTO v_task_exists;

    IF NOT v_task_exists THEN
      INSERT INTO tasks (
        id, title, description, category, entity_type, entity_id, project_id,
        assigned_to, created_by, due_date, priority
      ) VALUES (
        gen_random_uuid(),
        'Payment follow-up: ' || v_schedule.milestone_name
          || ' (' || v_schedule.percentage || '% = Rs.' || ROUND(v_schedule.amount) || ')',
        'Project ' || NEW.project_number || ' has reached "' || REPLACE(NEW.status::text, '_', ' ')
          || '" stage. Payment milestone "' || v_schedule.milestone_name
          || '" is now due. Please follow up with the customer.',
        'payment_followup',
        'project',
        NEW.id,
        NEW.id,
        v_marketing_mgr_id,
        COALESCE(v_marketing_mgr_id, NEW.project_manager_id),
        v_followup_due_date,
        'high'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.enqueue_payment_escalations()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_row              RECORD;
  v_founder_id       UUID;
  v_escalation_count INT := 0;
  v_exists           BOOLEAN;
BEGIN
  SELECT e.id INTO v_founder_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'founder'
    AND e.is_active = TRUE
  ORDER BY e.created_at ASC
  LIMIT 1;

  IF v_founder_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT t.id             AS task_id,
           t.title          AS task_title,
           t.project_id,
           t.entity_id,
           t.created_at,
           pps.escalation_sla_days,
           p.project_number,
           p.id             AS project_id_full
    FROM tasks t
    JOIN projects p ON p.id = t.entity_id
    JOIN proposals pr ON pr.lead_id = p.lead_id AND pr.status = 'accepted'
    JOIN proposal_payment_schedule pps
      ON pps.proposal_id = pr.id
     AND (
       'Payment follow-up: ' || pps.milestone_name || ' (' || pps.percentage || '% = Rs.' || ROUND(pps.amount) || ')'
       = t.title
     )
    WHERE t.category = 'payment_followup'
      AND t.is_completed = FALSE
      AND t.deleted_at IS NULL
      AND t.created_at < (now() - (COALESCE(pps.escalation_sla_days, 7) || ' days')::interval)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM tasks
      WHERE entity_type = 'project'
        AND entity_id = v_row.project_id_full
        AND category = 'payment_escalation'
        AND description LIKE '%follow-up task ' || v_row.task_id::text || '%'
        AND deleted_at IS NULL
    ) INTO v_exists;

    IF NOT v_exists THEN
      INSERT INTO tasks (
        id, title, description, category, entity_type, entity_id, project_id,
        assigned_to, created_by, due_date, priority
      ) VALUES (
        gen_random_uuid(),
        'ESCALATION - ' || v_row.task_title,
        'Payment follow-up task ' || v_row.task_id::text || ' on project ' || v_row.project_number
          || ' has exceeded its escalation SLA (' || v_row.escalation_sla_days
          || ' days) without being closed. Founder escalation fired automatically.',
        'payment_escalation',
        'project',
        v_row.project_id_full,
        v_row.project_id_full,
        v_founder_id,
        v_founder_id,
        CURRENT_DATE,
        'critical'
      );

      v_escalation_count := v_escalation_count + 1;
    END IF;
  END LOOP;

  RETURN v_escalation_count;
END;
$func$;

-- ----------------------------------------------------------------------------
-- Fix 2: fn_mark_proposal_accepted_on_lead_won — cascade to project creation
-- ----------------------------------------------------------------------------
-- When any lead flips to 'won' (via dropdown, attemptWon, approveClosure, or
-- raw UPDATE), find the lead's most recent in-play proposal and mark it
-- 'accepted'. That UPDATE fires trigger_proposal_accepted_create_project
-- (migration 031) which creates the Project row with system specs copied
-- from the proposal.
--
-- Preference order when a lead has multiple in-play proposals:
--   1. Detailed proposals (is_budgetary = FALSE) over quick quotes
--   2. Most recent created_at
--
-- If the lead has no in-play proposal, log a NOTICE and skip. The lead
-- still transitions to 'won' but no project auto-spawns — the PM can
-- create one manually. We do NOT block the lead transition because that
-- would require the user to go back, create a proposal, then retry.

CREATE OR REPLACE FUNCTION public.fn_mark_proposal_accepted_on_lead_won()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_proposal_id UUID;
BEGIN
  -- Only act on the specific transition into 'won'.
  IF NEW.status != 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  -- Find the most recent in-play proposal. Prefer detailed (non-budgetary).
  SELECT id INTO v_proposal_id
  FROM proposals
  WHERE lead_id = NEW.id
    AND status = ANY (ARRAY['draft', 'sent', 'viewed', 'negotiating']::proposal_status[])
  ORDER BY is_budgetary ASC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RAISE NOTICE
      'fn_mark_proposal_accepted_on_lead_won: no in-play proposal for lead %, skipping auto-accept',
      NEW.id;
    RETURN NEW;
  END IF;

  -- Cascade: this UPDATE fires trigger_proposal_accepted_create_project
  -- which creates the Project row.
  UPDATE proposals
  SET status = 'accepted',
      accepted_at = NOW(),
      accepted_by_name = COALESCE(accepted_by_name, 'Auto-accepted on lead won'),
      acceptance_method = COALESCE(acceptance_method, 'physical_signature')
  WHERE id = v_proposal_id;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_mark_proposal_accepted_on_lead_won ON leads;

CREATE TRIGGER trg_mark_proposal_accepted_on_lead_won
  AFTER UPDATE OF status ON leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_mark_proposal_accepted_on_lead_won();

-- ============================================================================
-- END OF MIGRATION 055
-- ============================================================================
