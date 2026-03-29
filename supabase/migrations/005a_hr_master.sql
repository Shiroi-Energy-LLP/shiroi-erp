-- ============================================================
-- Migration 005a — HR Master
-- File: supabase/migrations/005a_hr_master.sql
-- Description: Employee compensation, salary history, skills,
--              certifications, documents, lifecycle events,
--              exit checklists, and system logs.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS system_webhook_failures CASCADE;
--   DROP TABLE IF EXISTS system_logs CASCADE;
--   DROP TABLE IF EXISTS employee_exit_checklists CASCADE;
--   DROP TABLE IF EXISTS employee_lifecycle_events CASCADE;
--   DROP TABLE IF EXISTS employee_documents CASCADE;
--   DROP TABLE IF EXISTS employee_certifications CASCADE;
--   DROP TABLE IF EXISTS employee_skills CASCADE;
--   DROP TABLE IF EXISTS salary_increment_history CASCADE;
--   DROP TABLE IF EXISTS employee_compensation CASCADE;
-- Dependencies: 001_foundation.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. employee_compensation
-- Current compensation record per employee.
-- One active row per employee at any time.
-- Sensitive — restricted by RLS to employee, manager, HR, founder.
-- Immutable once superseded — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE employee_compensation (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  -- CTC breakdown
  ctc_annual              NUMERIC(14,2) NOT NULL,
  ctc_monthly             NUMERIC(14,2) NOT NULL,
  basic_salary            NUMERIC(14,2) NOT NULL,
  hra                     NUMERIC(14,2) NOT NULL DEFAULT 0,
  special_allowance       NUMERIC(14,2) NOT NULL DEFAULT 0,
  travel_allowance        NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_allowances        NUMERIC(14,2) NOT NULL DEFAULT 0,
  variable_pay            NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Target variable. Actual paid monthly in payroll_monthly_inputs.

  -- Deductions
  pf_employee             NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- 12% of basic. Computed and stored.
  pf_employer             NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- 12% of basic. Employer contribution.
  esic_employee           NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- 0.75% of gross if esic_applicable.
  esic_employer           NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- 3.25% of gross if esic_applicable.
  professional_tax        NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Per Tamil Nadu PT slab.

  -- Net
  gross_monthly           NUMERIC(14,2) NOT NULL,
  net_take_home           NUMERIC(14,2) NOT NULL,
  -- gross - pf_employee - esic_employee - professional_tax

  -- Effective dates
  effective_from          DATE NOT NULL,
  effective_until         DATE,
  -- NULL = currently active. Set when superseded by increment.

  is_current              BOOLEAN NOT NULL DEFAULT TRUE,
  -- Only one row per employee has is_current = TRUE.

  set_by                  UUID NOT NULL REFERENCES employees(id),
  -- HR manager or founder who set this compensation.

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_compensation_employee ON employee_compensation(employee_id);
CREATE INDEX idx_compensation_current  ON employee_compensation(employee_id)
  WHERE is_current = TRUE;


-- ------------------------------------------------------------
-- 2. salary_increment_history
-- Every increment logged here. Immutable — Tier 3.
-- Enables: increment analytics, compensation history.
-- ------------------------------------------------------------
CREATE TABLE salary_increment_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  old_compensation_id   UUID NOT NULL REFERENCES employee_compensation(id),
  new_compensation_id   UUID NOT NULL REFERENCES employee_compensation(id),

  increment_type        TEXT NOT NULL CHECK (increment_type IN (
    'annual_review', 'promotion', 'market_correction',
    'probation_confirmation', 'performance', 'other'
  )),

  old_ctc_annual        NUMERIC(14,2) NOT NULL,
  new_ctc_annual        NUMERIC(14,2) NOT NULL,
  increment_amount      NUMERIC(14,2) NOT NULL,
  increment_pct         NUMERIC(5,2) NOT NULL,

  effective_date        DATE NOT NULL,
  approved_by           UUID NOT NULL REFERENCES employees(id),
  reason                TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_increment_history_employee ON salary_increment_history(employee_id);
CREATE INDEX idx_increment_history_date     ON salary_increment_history(effective_date DESC);


-- ------------------------------------------------------------
-- 3. employee_skills
-- Skills and proficiency levels per employee.
-- Used for: deployment decisions, training gap analysis.
-- ------------------------------------------------------------
CREATE TABLE employee_skills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  skill_name        TEXT NOT NULL CHECK (skill_name IN (
    'panel_installation', 'inverter_installation', 'electrical_wiring',
    'earthing', 'structure_fabrication', 'net_metering_liaisoning',
    'autocad', 'site_survey', 'customer_handling',
    'project_management', 'procurement', 'om_maintenance', 'other'
  )),

  proficiency_level TEXT NOT NULL CHECK (proficiency_level IN (
    'beginner', 'intermediate', 'advanced', 'expert'
  )),

  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by       UUID REFERENCES employees(id),
  verified_at       DATE,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER employee_skills_updated_at
  BEFORE UPDATE ON employee_skills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_skills_employee_skill
  ON employee_skills(employee_id, skill_name);
CREATE INDEX idx_skills_employee ON employee_skills(employee_id);


-- ------------------------------------------------------------
-- 4. employee_certifications
-- Safety and technical certifications.
-- blocks_deployment = TRUE: expiry blocks site assignment.
-- System alert 30 days before expiry.
-- ------------------------------------------------------------
CREATE TABLE employee_certifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  certification_name    TEXT NOT NULL CHECK (certification_name IN (
    'electrical_safety', 'working_at_height', 'first_aid',
    'fire_safety', 'ceig_licensed_supervisor', 'iso_9001',
    'solar_installer', 'other'
  )),

  issuing_authority     TEXT NOT NULL,
  certificate_number    TEXT,
  issued_date           DATE NOT NULL,
  expiry_date           DATE,
  -- NULL for lifetime certifications.

  blocks_deployment     BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE: expired cert blocks assignment to any site project.

  is_expired            BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set by nightly cron when expiry_date < TODAY.

  certificate_storage_path TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER employee_certifications_updated_at
  BEFORE UPDATE ON employee_certifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_certifications_employee ON employee_certifications(employee_id);
CREATE INDEX idx_certifications_expiry   ON employee_certifications(expiry_date)
  WHERE expiry_date IS NOT NULL AND is_expired = FALSE;
CREATE INDEX idx_certifications_blocking ON employee_certifications(employee_id)
  WHERE blocks_deployment = TRUE AND is_expired = TRUE;


-- ------------------------------------------------------------
-- 5. employee_documents
-- HR documents: offer letter, ID proof, educational certs etc.
-- ------------------------------------------------------------
CREATE TABLE employee_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  uploaded_by       UUID NOT NULL REFERENCES employees(id),

  document_type     TEXT NOT NULL CHECK (document_type IN (
    'offer_letter', 'appointment_letter', 'id_proof',
    'address_proof', 'educational_certificate', 'experience_letter',
    'relieving_letter', 'increment_letter', 'ff_settlement',
    'nda', 'other'
  )),

  document_name     TEXT NOT NULL,
  storage_path      TEXT NOT NULL UNIQUE,
  file_size_bytes   BIGINT,

  issued_date       DATE,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable after upload. No updated_at.
);

CREATE INDEX idx_employee_docs_employee ON employee_documents(employee_id);
CREATE INDEX idx_employee_docs_type     ON employee_documents(document_type);


-- ------------------------------------------------------------
-- 6. employee_lifecycle_events
-- Key employment events: joining, confirmation, promotion,
-- transfer, resignation, termination.
-- Immutable log — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE employee_lifecycle_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  recorded_by       UUID NOT NULL REFERENCES employees(id),

  event_type        TEXT NOT NULL CHECK (event_type IN (
    'joined', 'probation_confirmed', 'promoted', 'transferred',
    'resigned', 'terminated', 'contract_renewed', 'retired',
    'reinstated', 'other'
  )),

  event_date        DATE NOT NULL,
  previous_role     TEXT,
  new_role          TEXT,
  previous_department TEXT,
  new_department    TEXT,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_lifecycle_employee ON employee_lifecycle_events(employee_id);
CREATE INDEX idx_lifecycle_type     ON employee_lifecycle_events(event_type);
CREATE INDEX idx_lifecycle_date     ON employee_lifecycle_events(event_date DESC);


-- ------------------------------------------------------------
-- 7. employee_exit_checklists
-- Gates F&F payment. All items must complete before
-- last_working_day. Project handover mandatory.
-- ------------------------------------------------------------
CREATE TABLE employee_exit_checklists (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                 UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE RESTRICT,
  initiated_by                UUID NOT NULL REFERENCES employees(id),

  resignation_date            DATE,
  last_working_day            DATE NOT NULL,

  -- Checklist items
  projects_handed_over        BOOLEAN NOT NULL DEFAULT FALSE,
  projects_handed_over_at     TIMESTAMPTZ,
  assets_returned             BOOLEAN NOT NULL DEFAULT FALSE,
  assets_returned_at          TIMESTAMPTZ,
  access_revoked              BOOLEAN NOT NULL DEFAULT FALSE,
  access_revoked_at           TIMESTAMPTZ,
  -- ERP access revoked same day as last_working_day.
  knowledge_documented        BOOLEAN NOT NULL DEFAULT FALSE,
  knowledge_documented_at     TIMESTAMPTZ,
  leave_balance_cleared       BOOLEAN NOT NULL DEFAULT FALSE,
  leave_balance_cleared_at    TIMESTAMPTZ,
  final_payroll_processed     BOOLEAN NOT NULL DEFAULT FALSE,
  final_payroll_processed_at  TIMESTAMPTZ,
  experience_letter_issued    BOOLEAN NOT NULL DEFAULT FALSE,
  experience_letter_issued_at TIMESTAMPTZ,
  relieving_letter_issued     BOOLEAN NOT NULL DEFAULT FALSE,
  relieving_letter_issued_at  TIMESTAMPTZ,

  -- F&F
  ff_amount                   NUMERIC(14,2),
  ff_paid                     BOOLEAN NOT NULL DEFAULT FALSE,
  ff_paid_at                  TIMESTAMPTZ,
  -- F&F payment blocked until all checklist items complete.

  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER exit_checklists_updated_at
  BEFORE UPDATE ON employee_exit_checklists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_exit_checklist_employee ON employee_exit_checklists(employee_id);
CREATE INDEX idx_exit_checklist_pending  ON employee_exit_checklists(ff_paid)
  WHERE ff_paid = FALSE;


-- ------------------------------------------------------------
-- 8. system_logs
-- Critical function execution log.
-- Written by edge functions after business-critical operations.
-- PDF gen, payroll export, handover assembly, invoicing.
-- ------------------------------------------------------------
CREATE TABLE system_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'function_start', 'function_complete', 'function_error',
    'cron_start', 'cron_complete', 'cron_error',
    'webhook_sent', 'webhook_failed'
  )),
  entity_type     TEXT,
  -- 'project', 'employee', 'invoice' etc.
  entity_id       UUID,
  status          TEXT NOT NULL CHECK (status IN (
    'success', 'error', 'warning'
  )),
  duration_ms     INT,
  error_message   TEXT,
  metadata        JSONB,
  -- Non-sensitive context only. Never log salary, Aadhar, bank details.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_system_logs_function ON system_logs(function_name, created_at DESC);
CREATE INDEX idx_system_logs_error    ON system_logs(status, created_at DESC)
  WHERE status = 'error';
CREATE INDEX idx_system_logs_entity   ON system_logs(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;


-- ------------------------------------------------------------
-- 9. system_webhook_failures
-- Failed n8n webhook deliveries. Polled on n8n startup
-- for retry. No failure ever silently dropped.
-- ------------------------------------------------------------
CREATE TABLE system_webhook_failures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url       TEXT NOT NULL,
  payload           JSONB NOT NULL,
  error_message     TEXT,
  attempt_count     INT NOT NULL DEFAULT 1,
  last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved          BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER webhook_failures_updated_at
  BEFORE UPDATE ON system_webhook_failures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_webhook_failures_unresolved ON system_webhook_failures(resolved)
  WHERE resolved = FALSE;


-- ------------------------------------------------------------
-- RLS — HR master tables
-- ------------------------------------------------------------

-- employee_compensation: salary special rule.
-- Readable only by: the employee (own), direct manager,
-- hr_manager, founder. No peer visibility.
ALTER TABLE employee_compensation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compensation_read"
  ON employee_compensation FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "compensation_insert"
  ON employee_compensation FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

-- salary_increment_history: same restriction as compensation.
ALTER TABLE salary_increment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "increment_history_read"
  ON salary_increment_history FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "increment_history_insert"
  ON salary_increment_history FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_skills_read"
  ON employee_skills FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'hr_manager', 'project_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "employee_skills_write"
  ON employee_skills FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "certifications_read"
  ON employee_certifications FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'hr_manager', 'project_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "certifications_write"
  ON employee_certifications FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_docs_read"
  ON employee_documents FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "employee_docs_insert"
  ON employee_documents FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lifecycle_events_read"
  ON employee_lifecycle_events FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "lifecycle_events_insert"
  ON employee_lifecycle_events FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_exit_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exit_checklists_read"
  ON employee_exit_checklists FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "exit_checklists_write"
  ON employee_exit_checklists FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

-- system_logs: founder only.
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_logs_read"
  ON system_logs FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

CREATE POLICY "system_logs_insert"
  ON system_logs FOR INSERT
  WITH CHECK (TRUE);
  -- Written by service role from edge functions.
  -- INSERT allowed from any authenticated context.
  -- Service role bypasses RLS entirely anyway.

-- system_webhook_failures: founder only.
ALTER TABLE system_webhook_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_failures_read"
  ON system_webhook_failures FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

CREATE POLICY "webhook_failures_write"
  ON system_webhook_failures FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  );

COMMIT;