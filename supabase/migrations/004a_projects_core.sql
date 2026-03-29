-- ============================================================
-- Migration 004a — Projects Core + Milestones
-- File: supabase/migrations/004a_projects_core.sql
-- Description: Core project table, assignments, milestones,
--              milestone weights, change orders, delay log,
--              project tasks, project issues, completion
--              components, and project status history.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS project_status_history CASCADE;
--   DROP TABLE IF EXISTS project_completion_components CASCADE;
--   DROP TABLE IF EXISTS project_issues CASCADE;
--   DROP TABLE IF EXISTS project_tasks CASCADE;
--   DROP TABLE IF EXISTS project_delay_log CASCADE;
--   DROP TABLE IF EXISTS project_change_orders CASCADE;
--   DROP TABLE IF EXISTS project_milestone_weights CASCADE;
--   DROP TABLE IF EXISTS project_milestones CASCADE;
--   DROP TABLE IF EXISTS project_assignments CASCADE;
--   DROP TABLE IF EXISTS projects CASCADE;
--   DROP TYPE IF EXISTS project_status;
--   DROP TYPE IF EXISTS milestone_status;
-- Dependencies: 001_foundation.sql, 002a_leads_core.sql,
--               003a_proposals_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Enums for projects domain
-- ------------------------------------------------------------
CREATE TYPE project_status AS ENUM (
  'advance_received',
  'planning',
  'material_procurement',
  'installation',
  'electrical_work',
  'testing',
  'commissioned',
  'net_metering_pending',
  'completed',
  'on_hold',
  'cancelled'
);

CREATE TYPE milestone_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'skipped'
);

CREATE TYPE delay_responsibility AS ENUM (
  'shiroi',
  'client',
  'vendor',
  'discom',
  'weather',
  'ceig',
  'other'
);


-- ------------------------------------------------------------
-- 2. projects
-- Core project record. Created only after:
--   1. Proposal accepted (OTP verified or physical signature)
--   2. Advance payment received
-- This is the master record everything else hangs off.
-- ------------------------------------------------------------
CREATE TABLE projects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Origin
  proposal_id             UUID NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE RESTRICT,
  lead_id                 UUID NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,

  -- Reference
  project_number          TEXT NOT NULL UNIQUE,
  -- Format: SHIROI/PROJ/2025-26/0087

  -- Customer
  customer_name           TEXT NOT NULL,
  customer_phone          TEXT NOT NULL,
  customer_email          TEXT,
  customer_profile_id     UUID REFERENCES profiles(id),
  -- Populated when customer creates their app account.

  -- Site
  site_address_line1      TEXT NOT NULL,
  site_address_line2      TEXT,
  site_city               TEXT NOT NULL,
  site_state              TEXT NOT NULL DEFAULT 'Tamil Nadu',
  site_pincode            TEXT,
  site_latitude           NUMERIC(9,6),
  site_longitude          NUMERIC(9,6),

  -- System specification (confirmed from accepted proposal)
  system_size_kwp         NUMERIC(6,2) NOT NULL,
  system_type             system_type NOT NULL,
  panel_brand             TEXT,
  panel_model             TEXT,
  panel_wattage           INT,
  panel_count             INT NOT NULL,
  inverter_brand          TEXT,
  inverter_model          TEXT,
  inverter_capacity_kw    NUMERIC(6,2),
  battery_brand           TEXT,
  battery_model           TEXT,
  battery_capacity_kwh    NUMERIC(6,2),
  structure_type          TEXT,

  -- Financial (from accepted proposal)
  contracted_value        NUMERIC(14,2) NOT NULL,
  -- Total amount customer agreed to pay.
  advance_amount          NUMERIC(14,2) NOT NULL,
  advance_received_at     DATE NOT NULL,

  -- Status
  status                  project_status NOT NULL DEFAULT 'advance_received',
  status_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Team
  project_manager_id      UUID REFERENCES employees(id),
  site_supervisor_id      UUID REFERENCES employees(id),

  -- Dates
  planned_start_date      DATE,
  planned_end_date        DATE,
  actual_start_date       DATE,
  actual_end_date         DATE,
  commissioned_date       DATE,
  -- Date system was switched on and generating power.

  -- Completion (computed — never manually entered)
  completion_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- Weighted average of milestone completion percentages.
  -- Updated by trigger after every daily_site_report insert.

  -- Builder involvement
  has_builder_scope       BOOLEAN NOT NULL DEFAULT FALSE,
  builder_name            TEXT,
  builder_civil_cleared   BOOLEAN NOT NULL DEFAULT FALSE,
  builder_civil_cleared_at TIMESTAMPTZ,
  -- Shiroi cannot start until builder confirms civil is done.

  -- CEIG
  ceig_required           BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE for commercial >10kW. Hard block on TNEB submission.
  ceig_cleared            BOOLEAN NOT NULL DEFAULT FALSE,
  ceig_cleared_at         TIMESTAMPTZ,

  -- Automation
  automation_paused       BOOLEAN NOT NULL DEFAULT FALSE,
  automation_pause_reason TEXT,
  -- Paused when customer has open unresolved complaint.

  notes                   TEXT,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sequence for project numbering
CREATE SEQUENCE project_number_seq START 1;

CREATE INDEX idx_projects_status      ON projects(status);
CREATE INDEX idx_projects_pm          ON projects(project_manager_id);
CREATE INDEX idx_projects_supervisor  ON projects(site_supervisor_id);
CREATE INDEX idx_projects_proposal    ON projects(proposal_id);
CREATE INDEX idx_projects_number      ON projects(project_number);
CREATE INDEX idx_projects_active      ON projects(status)
  WHERE status NOT IN ('completed', 'cancelled');


-- ------------------------------------------------------------
-- 3. project_assignments
-- Full team assignment history per project.
-- Multiple employees can be assigned at different stages.
-- ------------------------------------------------------------
CREATE TABLE project_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id),
  assigned_by     UUID NOT NULL REFERENCES employees(id),

  role_on_project TEXT NOT NULL CHECK (role_on_project IN (
    'project_manager', 'site_supervisor', 'electrical_engineer',
    'sales_engineer', 'om_technician', 'support'
  )),

  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at   TIMESTAMPTZ,
  -- NULL = currently active on project.

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proj_assignments_project  ON project_assignments(project_id);
CREATE INDEX idx_proj_assignments_employee ON project_assignments(employee_id);
CREATE INDEX idx_proj_assignments_active   ON project_assignments(project_id)
  WHERE unassigned_at IS NULL;


-- ------------------------------------------------------------
-- 4. project_milestones
-- Standard milestones per project. Gates 1, 2, 3 are
-- also payment gates — completion unlocks invoice generation.
-- ------------------------------------------------------------
CREATE TABLE project_milestones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  milestone_name        TEXT NOT NULL CHECK (milestone_name IN (
    'advance_payment',
    'material_delivery',
    'structure_installation',
    'panel_installation',
    'electrical_work',
    'testing_commissioning',
    'civil_work',
    'net_metering',
    'handover'
  )),

  milestone_order       INT NOT NULL,
  status                milestone_status NOT NULL DEFAULT 'pending',

  -- Payment gate
  is_payment_gate       BOOLEAN NOT NULL DEFAULT FALSE,
  payment_gate_number   INT CHECK (payment_gate_number IN (1, 2, 3)),
  -- Gate 1: material_delivery → unlocks delivery invoice (40%)
  -- Gate 2: mid-installation PM visit → allows electrical work
  -- Gate 3: pre-commissioning QC → unlocks commissioning invoice (20%)
  invoice_unlocked      BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_unlocked_at   TIMESTAMPTZ,

  -- Dates
  planned_start_date    DATE,
  planned_end_date      DATE,
  actual_start_date     DATE,
  actual_end_date       DATE,

  -- Completion (computed from project_completion_components)
  completion_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- Blocking
  is_blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_reason        TEXT,
  blocked_since         TIMESTAMPTZ,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_milestones_updated_at
  BEFORE UPDATE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_milestones_project_name
  ON project_milestones(project_id, milestone_name);
CREATE INDEX idx_milestones_status ON project_milestones(status);
CREATE INDEX idx_milestones_gate   ON project_milestones(is_payment_gate)
  WHERE is_payment_gate = TRUE;


-- ------------------------------------------------------------
-- 5. project_milestone_weights
-- Configurable weights per milestone type per project category.
-- Default weights from Master Reference:
-- delivery 15% · structure 15% · panels 25% · electrical 20%
-- · commissioning 10% · testing 5% · civil 5% · net metering 5%
-- ------------------------------------------------------------
CREATE TABLE project_milestone_weights (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment           customer_segment NOT NULL,
  system_type       system_type NOT NULL,

  milestone_name    TEXT NOT NULL CHECK (milestone_name IN (
    'material_delivery', 'structure_installation', 'panel_installation',
    'electrical_work', 'testing_commissioning', 'civil_work',
    'net_metering', 'handover'
  )),

  weight_pct        NUMERIC(5,2) NOT NULL,
  -- Must sum to 100 per segment+system_type combination.

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER milestone_weights_updated_at
  BEFORE UPDATE ON project_milestone_weights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_milestone_weights_unique
  ON project_milestone_weights(segment, system_type, milestone_name)
  WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 6. project_completion_components
-- Sub-component values per project per milestone.
-- Supervisor enters facts → system computes percentage.
-- No subjective estimates ever.
-- ------------------------------------------------------------
CREATE TABLE project_completion_components (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id        UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,

  component_name      TEXT NOT NULL,
  -- e.g. 'panels_installed', 'inverter_mounted', 'earthing_done'

  component_type      TEXT NOT NULL CHECK (component_type IN (
    'boolean',    -- tick box: done or not done
    'count',      -- numeric: panels_installed = 12 of 18
    'checklist'   -- multi-step checklist item
  )),

  -- For boolean components
  is_completed        BOOLEAN,

  -- For count components
  current_value       NUMERIC(10,2),
  target_value        NUMERIC(10,2),
  -- completion_pct = (current_value / target_value) * 100

  -- For checklist components
  checklist_steps_total     INT,
  checklist_steps_completed INT,

  -- Computed
  component_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- Stored after each update. Never computed on read.

  -- Photo gate
  requires_photo      BOOLEAN NOT NULL DEFAULT FALSE,
  photo_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  -- count components with requires_photo=TRUE: count not accepted
  -- until photo is uploaded and verified.

  last_updated_by     UUID REFERENCES employees(id),
  last_updated_at     TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER completion_components_updated_at
  BEFORE UPDATE ON project_completion_components
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_completion_components_project
  ON project_completion_components(project_id, milestone_id);


-- ------------------------------------------------------------
-- 7. project_change_orders
-- Formal scope change records post-acceptance.
-- Requires new OTP acceptance from customer.
-- Revenue and margin updated on approval.
-- Immutable once accepted — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE project_change_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,

  change_order_number TEXT NOT NULL UNIQUE,
  -- Format: SHIROI/CO/PROJ-087/01

  requested_by        TEXT NOT NULL CHECK (requested_by IN (
    'customer', 'shiroi', 'site_condition'
  )),
  description         TEXT NOT NULL,

  -- Financial impact
  additional_value    NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Positive = additional charge. Negative = credit/reduction.
  revised_total       NUMERIC(14,2) NOT NULL,
  -- Updated contracted_value after this change order.

  -- Approval
  prepared_by         UUID NOT NULL REFERENCES employees(id),
  approved_by_internal UUID REFERENCES employees(id),
  approved_internally_at TIMESTAMPTZ,

  -- Customer acceptance (new OTP required)
  customer_otp_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  customer_otp_verified_at  TIMESTAMPTZ,
  customer_accepted_at      TIMESTAMPTZ,

  pdf_storage_path    TEXT,
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable after customer acceptance. No updated_at post-acceptance.
);

CREATE INDEX idx_change_orders_project ON project_change_orders(project_id);


-- ------------------------------------------------------------
-- 8. project_delay_log
-- Every delay recorded with responsibility.
-- Immutable — Tier 3.
-- Enables: delay analysis by responsibility type.
-- ------------------------------------------------------------
CREATE TABLE project_delay_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id        UUID REFERENCES project_milestones(id),
  logged_by           UUID NOT NULL REFERENCES employees(id),

  delay_start_date    DATE NOT NULL,
  delay_end_date      DATE,
  -- NULL if delay is still ongoing.
  delay_days          INT,
  -- Computed on delay_end_date entry.

  responsibility      delay_responsibility NOT NULL,
  description         TEXT NOT NULL,

  -- Weather delays (auto-created when >3 consecutive days)
  is_weather_auto     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Customer notification
  customer_notified   BOOLEAN NOT NULL DEFAULT FALSE,
  customer_notified_at TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_delay_log_project        ON project_delay_log(project_id);
CREATE INDEX idx_delay_log_responsibility ON project_delay_log(responsibility);


-- ------------------------------------------------------------
-- 9. project_tasks
-- Actionable tasks assigned to team members.
-- Tier 1 — freely editable until completed.
-- ------------------------------------------------------------
CREATE TABLE project_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id    UUID REFERENCES project_milestones(id),

  title           TEXT NOT NULL,
  description     TEXT,

  assigned_to     UUID REFERENCES employees(id),
  created_by      UUID NOT NULL REFERENCES employees(id),

  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN (
    'low', 'medium', 'high', 'critical'
  )),

  due_date        DATE,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES employees(id),

  is_completed    BOOLEAN NOT NULL DEFAULT FALSE,

  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_tasks_updated_at
  BEFORE UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_project_tasks_project  ON project_tasks(project_id);
CREATE INDEX idx_project_tasks_assigned ON project_tasks(assigned_to);
CREATE INDEX idx_project_tasks_due      ON project_tasks(due_date)
  WHERE is_completed = FALSE AND deleted_at IS NULL;


-- ------------------------------------------------------------
-- 10. project_issues
-- Problems raised on site. Escalated if unresolved.
-- Tier 1 until resolved, Tier 2 after PM sign-off.
-- ------------------------------------------------------------
CREATE TABLE project_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id    UUID REFERENCES project_milestones(id),
  raised_by       UUID NOT NULL REFERENCES employees(id),

  issue_type      TEXT NOT NULL CHECK (issue_type IN (
    'material_quality', 'material_shortage', 'site_access',
    'design_change', 'weather', 'vendor_delay',
    'customer_request', 'safety', 'other'
  )),

  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'low', 'medium', 'high', 'critical'
  )),

  assigned_to     UUID REFERENCES employees(id),
  resolved_by     UUID REFERENCES employees(id),
  resolved_at     TIMESTAMPTZ,
  resolution_notes TEXT,

  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,

  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER project_issues_updated_at
  BEFORE UPDATE ON project_issues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_project_issues_project  ON project_issues(project_id);
CREATE INDEX idx_project_issues_open     ON project_issues(project_id)
  WHERE is_resolved = FALSE AND deleted_at IS NULL;
CREATE INDEX idx_project_issues_severity ON project_issues(severity)
  WHERE is_resolved = FALSE;


-- ------------------------------------------------------------
-- 11. project_status_history
-- Immutable log of every project status change.
-- Tier 3 — never edited, never deleted.
-- ------------------------------------------------------------
CREATE TABLE project_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  changed_by      UUID REFERENCES employees(id),
  -- NULL if changed by system automation.

  from_status     project_status,
  to_status       project_status NOT NULL,
  reason          TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_project_status_history
  ON project_status_history(project_id, changed_at DESC);


-- ------------------------------------------------------------
-- RLS — projects core
-- ------------------------------------------------------------

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_read"
  ON projects FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'hr_manager')
    OR project_manager_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR site_supervisor_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      JOIN employees e ON e.id = pa.employee_id
      WHERE pa.project_id = projects.id
        AND e.profile_id = auth.uid()
        AND pa.unassigned_at IS NULL
    )
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'customer'
      AND customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "projects_insert"
  ON projects FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'sales_engineer')
  );

CREATE POLICY "projects_update"
  ON projects FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'project_manager')
    OR project_manager_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_assignments_read"
  ON project_assignments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'hr_manager', 'project_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "project_assignments_write"
  ON project_assignments FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'project_manager')
  );

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestones_read"
  ON project_milestones FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_milestones.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "milestones_write"
  ON project_milestones FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE project_milestone_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestone_weights_read"
  ON project_milestone_weights FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "milestone_weights_write"
  ON project_milestone_weights FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

ALTER TABLE project_completion_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "completion_components_read"
  ON project_completion_components FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "completion_components_write"
  ON project_completion_components FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE project_change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "change_orders_read"
  ON project_change_orders FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance', 'sales_engineer')
  );

CREATE POLICY "change_orders_write"
  ON project_change_orders FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'project_manager')
  );

ALTER TABLE project_delay_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delay_log_read"
  ON project_delay_log FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "delay_log_insert"
  ON project_delay_log FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_tasks_read"
  ON project_tasks FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
    OR assigned_to = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR created_by = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "project_tasks_write"
  ON project_tasks FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE project_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_issues_read"
  ON project_issues FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "project_issues_write"
  ON project_issues FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE project_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_status_history_read"
  ON project_status_history FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "project_status_history_insert"
  ON project_status_history FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'sales_engineer')
  );

COMMIT;