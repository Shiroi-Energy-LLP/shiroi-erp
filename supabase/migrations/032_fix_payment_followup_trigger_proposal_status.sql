-- Migration 032: Fix create_payment_followup_tasks trigger
-- Bug: 'approved' is not a valid proposal_status enum value.
-- The proposal_status enum contains: draft, sent, accepted, rejected, expired, revised.
-- Without this fix, updating a project to in_progress, completed, or
-- waiting_net_metering fails with: invalid input value for enum
-- proposal_status: "approved"
--
-- Original bug was introduced in 021_payment_followup_trigger.sql

CREATE OR REPLACE FUNCTION create_payment_followup_tasks()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_schedule RECORD;
  v_task_exists boolean;
  v_milestone_order int;
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

  FOR v_schedule IN
    SELECT pps.milestone_name, pps.amount, pps.percentage, pps.milestone_order
    FROM proposals p
    JOIN proposal_payment_schedule pps ON pps.proposal_id = p.id
    WHERE p.lead_id = NEW.lead_id
      AND p.status = 'accepted'
      AND pps.milestone_order = v_milestone_order
    ORDER BY pps.milestone_order
    LIMIT 1
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM tasks
      WHERE entity_type = 'lead'
        AND entity_id = NEW.lead_id
        AND title LIKE 'Payment follow-up: ' || v_schedule.milestone_name || '%'
        AND deleted_at IS NULL
    ) INTO v_task_exists;

    IF NOT v_task_exists THEN
      INSERT INTO tasks (id, title, description, entity_type, entity_id, project_id, assigned_to, created_by, due_date, priority)
      VALUES (
        gen_random_uuid(),
        'Payment follow-up: ' || v_schedule.milestone_name || ' (' || v_schedule.percentage || '% = Rs.' || ROUND(v_schedule.amount) || ')',
        'Project ' || NEW.project_number || ' has reached "' || REPLACE(NEW.status::text, '_', ' ') || '" stage. Payment milestone "' || v_schedule.milestone_name || '" is now due. Please follow up with the customer.',
        'lead',
        NEW.lead_id,
        NEW.id,
        NEW.project_manager_id,
        NEW.project_manager_id,
        (CURRENT_DATE + INTERVAL '3 days')::date,
        'high'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$func$;
