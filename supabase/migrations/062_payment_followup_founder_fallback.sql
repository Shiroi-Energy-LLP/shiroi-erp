-- ============================================================
-- Migration 062 — Founder fallback in create_payment_followup_tasks()
-- File: supabase/migrations/062_payment_followup_founder_fallback.sql
-- Date: 2026-04-17
--
-- BUG
-- ---
-- Project Deepak (SHIROI/PROJ/2026-27/0003) could not be moved from
-- 'yet_to_start' → 'in_progress' because the trg_payment_followup
-- AFTER UPDATE trigger crashed with:
--
--   null value in column created_by of relation "tasks" violates
--   not-null constraint
--
-- Root cause chain:
--   1. No employee rows exist with role = 'marketing_manager' yet
--      (role was introduced in migration 051 but not populated).
--   2. The project had project_manager_id = NULL (auto-created
--      projects via create_project_from_accepted_proposal() in
--      migration 031 start with no PM).
--   3. Trigger resolved owner as COALESCE(NULL, NULL) = NULL and
--      tried to INSERT INTO tasks with created_by = NULL, which
--      violates the NOT NULL + FK → employees(id) constraint.
--
-- FIX
-- ---
-- Widen the owner-resolution ladder to three tiers:
--   Tier 1: marketing_manager  (unchanged — the intended owner)
--   Tier 2: project_manager_id (unchanged fallback)
--   Tier 3: founder            ← NEW — catch-all when neither of
--                                 the above is available
--
-- If even the founder is missing (should never happen), the trigger
-- silently skips task creation rather than crashing the status
-- change. Payment follow-up is recoverable; a blocked project
-- transition is not.
--
-- Function signature, return type, and all INSERT semantics are
-- unchanged. Only the owner-resolution block and one variable
-- rename (v_marketing_mgr_id → v_owner_id) differ.
-- ============================================================

BEGIN;

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
  v_owner_id            UUID;
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

  -- Tier 1: marketing_manager (preferred — payment collection is their remit)
  SELECT e.id INTO v_owner_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'marketing_manager'
    AND e.is_active = TRUE
  ORDER BY e.created_at ASC
  LIMIT 1;

  -- Tier 2: project_manager of this project
  IF v_owner_id IS NULL THEN
    v_owner_id := NEW.project_manager_id;
  END IF;

  -- Tier 3: founder (final catch-all so the UPDATE never fails on NULL owner)
  IF v_owner_id IS NULL THEN
    SELECT e.id INTO v_owner_id
    FROM employees e
    JOIN profiles p ON p.id = e.profile_id
    WHERE p.role = 'founder'
      AND e.is_active = TRUE
    ORDER BY e.created_at ASC
    LIMIT 1;
  END IF;

  -- Ultra-safety: if even a founder is missing (shouldn't happen in
  -- a single-tenant Shiroi deployment), skip silently rather than
  -- crash the status change the user just initiated.
  IF v_owner_id IS NULL THEN
    RETURN NEW;
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
        v_owner_id,
        v_owner_id,
        v_followup_due_date,
        'high'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$func$;

COMMIT;
