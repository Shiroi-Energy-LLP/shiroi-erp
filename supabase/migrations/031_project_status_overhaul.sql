-- ====================================================================
-- Migration 031 — Project status overhaul
--
-- Goals (per Manivel's simplified Projects-module spec):
--   1. Fix project_status_history FK: trigger passes auth.uid() (profile
--      id) directly into changed_by, which FKs to employees(id). This
--      causes FK violations on every inline status edit. Fix: look up
--      employee by profile_id, fall back to NULL for system writes.
--   2. Collapse project_status enum from 11 values to 8:
--        order_received, yet_to_start, in_progress, completed,
--        holding_shiroi, holding_client, waiting_net_metering,
--        meter_client_scope
--   3. Auto-create Projects when a Proposal is marked 'accepted'.
--      The existing flow required manual project creation — from now on,
--      accepting a proposal immediately populates the Projects list.
--
-- Existing data mapping (verified on dev — 267 completed, 14 net-metering,
-- 14 on_hold, 10 installation, 5 advance_received, 4 commissioned):
--   advance_received     → order_received
--   planning             → yet_to_start
--   material_procurement → in_progress
--   installation         → in_progress
--   electrical_work      → in_progress
--   testing              → in_progress
--   commissioned         → in_progress
--   net_metering_pending → waiting_net_metering
--   completed            → completed   (unchanged)
--   on_hold              → holding_shiroi
--   cancelled            → holding_client  (no rows in dev; safest fallback)
--
-- Order-of-operations: triggers, functions, AND partial indexes with
-- hardcoded enum literals must all be dropped before the enum swap. The
-- idx_projects_active partial index hardcodes 'completed'::project_status
-- and 'cancelled'::project_status in its WHERE clause, so altering the
-- column type fails with "operator does not exist" until the index is
-- dropped. We rebuild it after the swap using only the new enum values.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- PART 1: Drop triggers, functions, and dependent indexes
-- --------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_project_status_change ON projects;
DROP TRIGGER IF EXISTS trg_payment_followup ON projects;
DROP TRIGGER IF EXISTS trigger_proposal_accepted_create_project ON proposals;

DROP FUNCTION IF EXISTS log_project_status_change() CASCADE;
DROP FUNCTION IF EXISTS create_payment_followup_tasks() CASCADE;
DROP FUNCTION IF EXISTS generate_cashflow_snapshot() CASCADE;
DROP FUNCTION IF EXISTS create_project_from_accepted_proposal() CASCADE;

-- Partial index referencing the old enum literals — must be dropped
-- before we can change the column type
DROP INDEX IF EXISTS idx_projects_active;

-- --------------------------------------------------------------------
-- PART 2: Collapse project_status enum
-- --------------------------------------------------------------------

-- 2a. Create new enum
CREATE TYPE project_status_new AS ENUM (
  'order_received',
  'yet_to_start',
  'in_progress',
  'completed',
  'holding_shiroi',
  'holding_client',
  'waiting_net_metering',
  'meter_client_scope'
);

-- 2b. Drop default (enum type can't be altered while referenced by default)
ALTER TABLE projects ALTER COLUMN status DROP DEFAULT;

-- 2c. Remap projects.status
ALTER TABLE projects
  ALTER COLUMN status TYPE project_status_new
  USING (
    CASE status::text
      WHEN 'advance_received'     THEN 'order_received'
      WHEN 'planning'             THEN 'yet_to_start'
      WHEN 'material_procurement' THEN 'in_progress'
      WHEN 'installation'         THEN 'in_progress'
      WHEN 'electrical_work'      THEN 'in_progress'
      WHEN 'testing'              THEN 'in_progress'
      WHEN 'commissioned'         THEN 'in_progress'
      WHEN 'net_metering_pending' THEN 'waiting_net_metering'
      WHEN 'completed'            THEN 'completed'
      WHEN 'on_hold'              THEN 'holding_shiroi'
      WHEN 'cancelled'            THEN 'holding_client'
    END::project_status_new
  );

-- 2d. Remap project_status_history.from_status (nullable)
ALTER TABLE project_status_history
  ALTER COLUMN from_status TYPE project_status_new
  USING (
    CASE from_status::text
      WHEN 'advance_received'     THEN 'order_received'
      WHEN 'planning'             THEN 'yet_to_start'
      WHEN 'material_procurement' THEN 'in_progress'
      WHEN 'installation'         THEN 'in_progress'
      WHEN 'electrical_work'      THEN 'in_progress'
      WHEN 'testing'              THEN 'in_progress'
      WHEN 'commissioned'         THEN 'in_progress'
      WHEN 'net_metering_pending' THEN 'waiting_net_metering'
      WHEN 'completed'            THEN 'completed'
      WHEN 'on_hold'              THEN 'holding_shiroi'
      WHEN 'cancelled'            THEN 'holding_client'
      ELSE NULL
    END::project_status_new
  );

-- 2e. Remap project_status_history.to_status (NOT NULL)
ALTER TABLE project_status_history
  ALTER COLUMN to_status TYPE project_status_new
  USING (
    CASE to_status::text
      WHEN 'advance_received'     THEN 'order_received'
      WHEN 'planning'             THEN 'yet_to_start'
      WHEN 'material_procurement' THEN 'in_progress'
      WHEN 'installation'         THEN 'in_progress'
      WHEN 'electrical_work'      THEN 'in_progress'
      WHEN 'testing'              THEN 'in_progress'
      WHEN 'commissioned'         THEN 'in_progress'
      WHEN 'net_metering_pending' THEN 'waiting_net_metering'
      WHEN 'completed'            THEN 'completed'
      WHEN 'on_hold'              THEN 'holding_shiroi'
      WHEN 'cancelled'            THEN 'holding_client'
    END::project_status_new
  );

-- 2f. Drop old type, rename new
DROP TYPE project_status;
ALTER TYPE project_status_new RENAME TO project_status;

-- 2g. Restore default to new initial state
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'order_received';

-- 2h. Recreate partial index with new enum literals ("active" = not done)
CREATE INDEX idx_projects_active
  ON projects USING btree (status)
  WHERE status != 'completed'::project_status;

-- --------------------------------------------------------------------
-- PART 3: Recreate functions against the NEW enum
-- --------------------------------------------------------------------

-- 3a. log_project_status_change — FK fix: lookup employee_id from profile_id
CREATE OR REPLACE FUNCTION log_project_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT id INTO v_employee_id
      FROM employees
      WHERE profile_id = auth.uid()
      LIMIT 1;

    INSERT INTO project_status_history (
      project_id, changed_by, from_status, to_status
    ) VALUES (
      NEW.id, v_employee_id, OLD.status, NEW.status
    );

    NEW.status_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- 3b. create_payment_followup_tasks — map new simplified statuses → milestones
CREATE OR REPLACE FUNCTION create_payment_followup_tasks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_schedule RECORD;
  v_task_exists boolean;
  v_milestone_order int;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map simplified statuses → payment milestone order
  -- order_received       → NULL (advance already captured upstream)
  -- in_progress          → milestone 2 (material delivery / mid-install collection)
  -- waiting_net_metering → milestone 4 (pre-handover collection)
  -- completed            → milestone 4 (final handover)
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
      AND p.status IN ('approved', 'accepted')
      AND pps.milestone_order = v_milestone_order
    ORDER BY pps.milestone_order
    LIMIT 1
  LOOP
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
        'Project ' || NEW.project_number || ' has reached "' || REPLACE(NEW.status::text, '_', ' ') || '" stage. Payment milestone "' || v_schedule.milestone_name || '" is now due. Please follow up with the customer.',
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
$$;

-- 3c. generate_cashflow_snapshot — drop the 'cancelled' literal (no longer valid)
CREATE OR REPLACE FUNCTION generate_cashflow_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_count      INT;
  v_invested_count    INT;
  v_total_contracted  NUMERIC(14,2);
  v_total_invoiced    NUMERIC(14,2);
  v_total_received    NUMERIC(14,2);
  v_total_outstanding NUMERIC(14,2);
  v_total_paid_vendors NUMERIC(14,2);
  v_total_vendor_out  NUMERIC(14,2);
  v_working_capital   NUMERIC(14,2);
  v_overdue_count     INT;
  v_overdue_value     NUMERIC(14,2);
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE is_invested = TRUE),
    COALESCE(SUM(total_contracted), 0),
    COALESCE(SUM(total_invoiced), 0),
    COALESCE(SUM(total_received), 0),
    COALESCE(SUM(total_outstanding), 0),
    COALESCE(SUM(total_paid_to_vendors), 0),
    COALESCE(SUM(total_vendor_outstanding), 0),
    COALESCE(SUM(CASE WHEN net_cash_position < 0
      THEN ABS(net_cash_position) ELSE 0 END), 0)
  INTO
    v_active_count, v_invested_count,
    v_total_contracted, v_total_invoiced,
    v_total_received, v_total_outstanding,
    v_total_paid_vendors, v_total_vendor_out,
    v_working_capital
  FROM project_cash_positions
  JOIN projects p ON p.id = project_cash_positions.project_id
  WHERE p.status != 'completed';

  SELECT COUNT(*), COALESCE(SUM(amount_outstanding), 0)
  INTO v_overdue_count, v_overdue_value
  FROM invoices
  WHERE status IN ('sent', 'partially_paid')
    AND due_date < CURRENT_DATE;

  INSERT INTO company_cashflow_snapshots (
    snapshot_date,
    active_projects_count,
    invested_projects_count,
    total_contracted_value,
    total_invoiced,
    total_received,
    total_outstanding,
    total_paid_to_vendors,
    total_vendor_outstanding,
    net_working_capital_deployed,
    overdue_invoices_count,
    overdue_invoices_value
  ) VALUES (
    CURRENT_DATE,
    v_active_count, v_invested_count,
    v_total_contracted, v_total_invoiced,
    v_total_received, v_total_outstanding,
    v_total_paid_vendors, v_total_vendor_out,
    v_working_capital,
    v_overdue_count, v_overdue_value
  )
  ON CONFLICT (snapshot_date)
  DO UPDATE SET
    active_projects_count        = EXCLUDED.active_projects_count,
    invested_projects_count      = EXCLUDED.invested_projects_count,
    total_contracted_value       = EXCLUDED.total_contracted_value,
    total_invoiced               = EXCLUDED.total_invoiced,
    total_received               = EXCLUDED.total_received,
    total_outstanding            = EXCLUDED.total_outstanding,
    total_paid_to_vendors        = EXCLUDED.total_paid_to_vendors,
    total_vendor_outstanding     = EXCLUDED.total_vendor_outstanding,
    net_working_capital_deployed = EXCLUDED.net_working_capital_deployed,
    overdue_invoices_count       = EXCLUDED.overdue_invoices_count,
    overdue_invoices_value       = EXCLUDED.overdue_invoices_value;

  INSERT INTO system_logs (
    function_name, event_type, status, metadata
  ) VALUES (
    'generate_cashflow_snapshot', 'cron_complete', 'success',
    jsonb_build_object(
      'snapshot_date', CURRENT_DATE,
      'active_projects', v_active_count,
      'invested_projects', v_invested_count
    )
  );
END;
$$;

-- 3d. create_project_from_accepted_proposal — NEW: auto-create project on accepted proposal
CREATE OR REPLACE FUNCTION create_project_from_accepted_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_number  TEXT;
  v_lead            RECORD;
  v_existing_id     UUID;
BEGIN
  -- Only fire on transition TO 'accepted'
  IF NEW.status != 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if any project already exists for this lead
  SELECT id INTO v_existing_id
    FROM projects
    WHERE lead_id = NEW.lead_id
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch customer + site details from the lead
  SELECT
    customer_name,
    phone,
    email,
    COALESCE(address_line1, city) AS address_line1,
    city,
    state,
    pincode
  INTO v_lead
  FROM leads
  WHERE id = NEW.lead_id;

  IF v_lead IS NULL THEN
    RAISE NOTICE 'Cannot auto-create project: lead % not found', NEW.lead_id;
    RETURN NEW;
  END IF;

  -- Generate a new project number
  v_project_number := generate_doc_number('PROJ');

  -- Insert the project. Any field missing from the proposal falls back
  -- to safe zeros/nulls — the PM can fill in details via the stepper.
  INSERT INTO projects (
    proposal_id,
    lead_id,
    project_number,
    customer_name,
    customer_phone,
    customer_email,
    site_address_line1,
    site_city,
    site_state,
    site_pincode,
    system_type,
    system_size_kwp,
    panel_brand,
    panel_model,
    panel_wattage,
    panel_count,
    inverter_brand,
    inverter_model,
    inverter_capacity_kw,
    battery_brand,
    battery_model,
    battery_capacity_kwh,
    contracted_value,
    advance_amount,
    advance_received_at,
    status
  ) VALUES (
    NEW.id,
    NEW.lead_id,
    v_project_number,
    v_lead.customer_name,
    v_lead.phone,
    v_lead.email,
    v_lead.address_line1,
    v_lead.city,
    v_lead.state,
    v_lead.pincode,
    NEW.system_type,
    NEW.system_size_kwp,
    NEW.panel_brand,
    NEW.panel_model,
    NEW.panel_wattage,
    COALESCE(NEW.panel_count, 0),
    NEW.inverter_brand,
    NEW.inverter_model,
    NEW.inverter_capacity_kw,
    NEW.battery_brand,
    NEW.battery_model,
    NEW.battery_capacity_kwh,
    COALESCE(NEW.total_after_discount, 0),
    0,
    CURRENT_DATE,
    'order_received'
  );

  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------
-- PART 4: Reattach triggers with the fresh functions
-- --------------------------------------------------------------------

CREATE TRIGGER trigger_project_status_change
  BEFORE UPDATE OF status ON projects
  FOR EACH ROW
  EXECUTE FUNCTION log_project_status_change();

CREATE TRIGGER trg_payment_followup
  AFTER UPDATE OF status ON projects
  FOR EACH ROW
  EXECUTE FUNCTION create_payment_followup_tasks();

CREATE TRIGGER trigger_proposal_accepted_create_project
  AFTER UPDATE OF status ON proposals
  FOR EACH ROW
  EXECUTE FUNCTION create_project_from_accepted_proposal();

COMMIT;
