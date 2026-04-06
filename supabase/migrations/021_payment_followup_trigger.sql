-- Migration 021: Auto-create payment follow-up tasks when project status advances
-- When a project moves to key stages, creates tasks for the PM to follow up on payments.

CREATE OR REPLACE FUNCTION create_payment_followup_tasks()
RETURNS trigger AS $$
DECLARE
  v_schedule RECORD;
  v_task_exists boolean;
  v_milestone_order int;
BEGIN
  -- Only fire on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map project status to which payment milestone order should be triggered
  -- 1st payment = advance (at project award)
  -- 2nd payment = material procurement stage
  -- 3rd payment = installation/testing stage
  -- 4th/final payment = commissioning/completion
  v_milestone_order := CASE NEW.status
    WHEN 'advance_received' THEN NULL  -- advance already paid
    WHEN 'material_procurement' THEN 2
    WHEN 'installation' THEN 3
    WHEN 'testing' THEN 3       -- also trigger 3rd if not yet done
    WHEN 'commissioned' THEN 4
    WHEN 'completed' THEN 4     -- final payment
    ELSE NULL
  END;

  IF v_milestone_order IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the matching payment milestone from the approved proposal
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
    -- Check if a task already exists for this milestone + lead
    SELECT EXISTS (
      SELECT 1 FROM tasks
      WHERE entity_type = 'lead'
        AND entity_id = NEW.lead_id::text
        AND title LIKE 'Payment follow-up: ' || v_schedule.milestone_name || '%'
        AND deleted_at IS NULL
    ) INTO v_task_exists;

    IF NOT v_task_exists THEN
      INSERT INTO tasks (id, title, description, entity_type, entity_id, project_id, assigned_to, created_by, due_date, priority)
      VALUES (
        gen_random_uuid(),
        'Payment follow-up: ' || v_schedule.milestone_name || ' (' || v_schedule.percentage || '% = Rs.' || ROUND(v_schedule.amount) || ')',
        'Project ' || NEW.project_number || ' has reached "' || REPLACE(NEW.status, '_', ' ') || '" stage. Payment milestone "' || v_schedule.milestone_name || '" is now due. Please follow up with the customer.',
        'lead',
        NEW.lead_id::text,
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
$$ LANGUAGE plpgsql;

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS trg_payment_followup ON projects;

CREATE TRIGGER trg_payment_followup
  AFTER UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION create_payment_followup_tasks();

COMMENT ON FUNCTION create_payment_followup_tasks IS 'Auto-creates payment follow-up tasks when project reaches payment milestone stages';
