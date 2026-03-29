-- ============================================================
-- Migration 005b — Leave, Attendance, Payroll, Insurance
-- File: supabase/migrations/005b_leave_payroll.sql
-- Description: Leave requests, leave ledger, leave balances,
--              attendance, payroll monthly inputs, payroll
--              export files, and employee insurance.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS employee_insurance CASCADE;
--   DROP TABLE IF EXISTS payroll_export_files CASCADE;
--   DROP TABLE IF EXISTS payroll_monthly_inputs CASCADE;
--   DROP TABLE IF EXISTS monthly_attendance_summary CASCADE;
--   DROP TABLE IF EXISTS attendance_corrections CASCADE;
--   DROP TABLE IF EXISTS leave_balances CASCADE;
--   DROP TABLE IF EXISTS leave_ledger CASCADE;
--   DROP TABLE IF EXISTS leave_requests CASCADE;
--   DROP TYPE IF EXISTS leave_type;
-- Dependencies: 001_foundation.sql, 005a_hr_master.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Enums for leave domain
-- ------------------------------------------------------------
CREATE TYPE leave_type AS ENUM (
  'casual',
  'sick',
  'earned',
  'maternity',
  'paternity',
  'compensatory',
  'loss_of_pay',
  'other'
);


-- ------------------------------------------------------------
-- 2. leave_requests
-- Every leave application by an employee.
-- Tier 1 while pending — freely editable.
-- Tier 2 once approved — correction by new record.
-- ------------------------------------------------------------
CREATE TABLE leave_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  approved_by         UUID REFERENCES employees(id),

  leave_type          leave_type NOT NULL,
  from_date           DATE NOT NULL,
  to_date             DATE NOT NULL,
  days_requested      NUMERIC(4,1) NOT NULL,
  -- 0.5 for half day, 1.0 for full day etc.

  reason              TEXT NOT NULL,
  is_half_day         BOOLEAN NOT NULL DEFAULT FALSE,
  half_day_session    TEXT CHECK (half_day_session IN ('morning', 'afternoon')),

  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'cancelled', 'recalled'
  )),

  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at         TIMESTAMPTZ,
  rejected_reason     TEXT,

  -- Offline sync (mobile app)
  sync_status         TEXT NOT NULL DEFAULT 'local_only' CHECK (sync_status IN (
    'local_only', 'syncing', 'synced', 'sync_failed'
  )),

  -- Supervisor on leave during active project
  backup_assigned_to  UUID REFERENCES employees(id),
  -- Who covers this employee's projects during leave.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER leave_requests_updated_at
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status   ON leave_requests(status);
CREATE INDEX idx_leave_requests_dates    ON leave_requests(from_date, to_date);
CREATE INDEX idx_leave_requests_pending  ON leave_requests(approved_by)
  WHERE status = 'pending';
CREATE INDEX idx_leave_requests_sync     ON leave_requests(sync_status)
  WHERE sync_status != 'synced';


-- ------------------------------------------------------------
-- 3. leave_ledger
-- Double-entry accounting model for leave balances.
-- Every transaction recorded here. Immutable — Tier 3.
-- Balance disputes resolved by the ledger, not the balance field.
-- Corrections via reversal entries only — never edit in place.
-- ------------------------------------------------------------
CREATE TABLE leave_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_request_id    UUID REFERENCES leave_requests(id),
  -- NULL for system entries: accrual, opening balance, adjustments.

  entry_type          TEXT NOT NULL CHECK (entry_type IN (
    'opening_balance',  -- Set at joining or system go-live
    'accrual',          -- Monthly earned leave credit
    'debit',            -- Leave taken
    'reversal',         -- Reversal of a previous entry (correction)
    'adjustment',       -- Manual adjustment by HR with reason
    'lapse',            -- Lapsed leave at year end
    'encashment'        -- Leave encashment at exit
  )),

  leave_type          leave_type NOT NULL,
  days                NUMERIC(4,1) NOT NULL,
  -- Positive = credit. Negative = debit.

  balance_after       NUMERIC(6,1) NOT NULL,
  -- Running balance after this entry. Stored explicitly.
  -- Never computed on read — too expensive at scale.

  description         TEXT NOT NULL,
  -- Human readable: "Casual leave taken 15-Mar to 16-Mar"
  reversal_of_id      UUID REFERENCES leave_ledger(id),
  -- Populated when entry_type = 'reversal'.

  recorded_by         UUID REFERENCES employees(id),
  -- NULL for system-generated entries (accrual, lapse).
  transaction_date    DATE NOT NULL DEFAULT CURRENT_DATE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at. No deletes. Ever.
);

CREATE INDEX idx_leave_ledger_employee ON leave_ledger(employee_id, transaction_date DESC);
CREATE INDEX idx_leave_ledger_type     ON leave_ledger(leave_type);
CREATE INDEX idx_leave_ledger_request  ON leave_ledger(leave_request_id)
  WHERE leave_request_id IS NOT NULL;


-- ------------------------------------------------------------
-- 4. leave_balances
-- Current leave balance per employee per leave type.
-- Computed summary — refreshed on every leave_ledger INSERT.
-- Never manually edited. Source of truth is leave_ledger.
-- ------------------------------------------------------------
CREATE TABLE leave_balances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type          leave_type NOT NULL,

  balance_days        NUMERIC(6,1) NOT NULL DEFAULT 0,
  -- Current balance. Always equals SUM of leave_ledger.days
  -- for this employee + leave_type.

  last_accrual_date   DATE,
  last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_leave_balances_employee_type
  ON leave_balances(employee_id, leave_type);
CREATE INDEX idx_leave_balances_employee ON leave_balances(employee_id);


-- ------------------------------------------------------------
-- 5. attendance_corrections
-- Tier 2 correction for attendance after payroll export.
-- Cannot edit monthly_attendance_summary in place post-export.
-- ------------------------------------------------------------
CREATE TABLE attendance_corrections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  requested_by            UUID NOT NULL REFERENCES employees(id),
  approved_by             UUID REFERENCES employees(id),

  correction_month        TEXT NOT NULL,
  -- Format: '2025-03' (YYYY-MM).

  field_corrected         TEXT NOT NULL CHECK (field_corrected IN (
    'paid_days', 'lop_days', 'present_days',
    'late_count', 'half_day_count'
  )),
  original_value          NUMERIC(6,1) NOT NULL,
  corrected_value         NUMERIC(6,1) NOT NULL,
  correction_reason       TEXT NOT NULL,

  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected'
  )),
  approved_at             TIMESTAMPTZ,
  rejected_reason         TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER attendance_corrections_updated_at
  BEFORE UPDATE ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_att_corrections_employee ON attendance_corrections(employee_id);
CREATE INDEX idx_att_corrections_pending  ON attendance_corrections(status)
  WHERE status = 'pending';


-- ------------------------------------------------------------
-- 6. monthly_attendance_summary
-- One row per employee per month.
-- Locked after payroll export — corrections via
-- attendance_corrections table only.
-- ------------------------------------------------------------
CREATE TABLE monthly_attendance_summary (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  month_year          TEXT NOT NULL,
  -- Format: '2025-03' (YYYY-MM).

  working_days        INT NOT NULL,
  -- Total working days in the month (excluding holidays).
  present_days        NUMERIC(6,1) NOT NULL DEFAULT 0,
  absent_days         NUMERIC(6,1) NOT NULL DEFAULT 0,
  half_day_count      NUMERIC(4,1) NOT NULL DEFAULT 0,
  late_count          INT NOT NULL DEFAULT 0,
  -- Days employee marked late.

  -- Leave breakdown
  casual_leave_days   NUMERIC(4,1) NOT NULL DEFAULT 0,
  sick_leave_days     NUMERIC(4,1) NOT NULL DEFAULT 0,
  earned_leave_days   NUMERIC(4,1) NOT NULL DEFAULT 0,
  lop_days            NUMERIC(4,1) NOT NULL DEFAULT 0,
  -- Loss of pay days. Key input for payroll.
  other_leave_days    NUMERIC(4,1) NOT NULL DEFAULT 0,

  paid_days           NUMERIC(6,1) NOT NULL DEFAULT 0,
  -- working_days - lop_days. Input to Zoho payroll CSV.

  -- Lock status
  is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at           TIMESTAMPTZ,
  -- Locked when payroll export is generated for this month.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER monthly_attendance_updated_at
  BEFORE UPDATE ON monthly_attendance_summary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_attendance_employee_month
  ON monthly_attendance_summary(employee_id, month_year);
CREATE INDEX idx_attendance_month  ON monthly_attendance_summary(month_year DESC);
CREATE INDEX idx_attendance_locked ON monthly_attendance_summary(is_locked)
  WHERE is_locked = FALSE;


-- ------------------------------------------------------------
-- 7. payroll_monthly_inputs
-- Variable inputs for each employee each month.
-- Collected by HR before 25th for payroll export.
-- Locked once export is generated.
-- ------------------------------------------------------------
CREATE TABLE payroll_monthly_inputs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  attendance_summary_id   UUID NOT NULL REFERENCES monthly_attendance_summary(id),
  month_year              TEXT NOT NULL,

  -- From attendance
  paid_days               NUMERIC(6,1) NOT NULL,
  lop_days                NUMERIC(4,1) NOT NULL DEFAULT 0,

  -- Variable pay this month
  variable_pay_actual     NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Actual variable paid this month (may differ from target).

  -- One-time additions
  one_time_additions      NUMERIC(14,2) NOT NULL DEFAULT 0,
  one_time_addition_note  TEXT,
  -- e.g. 'Bonus', 'Festival advance repayment credit'

  -- One-time deductions
  one_time_deductions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  one_time_deduction_note TEXT,
  -- e.g. 'Advance recovery', 'Loan EMI'

  -- Computed totals (stored for Zoho CSV export)
  gross_this_month        NUMERIC(14,2) NOT NULL DEFAULT 0,
  pf_employee_this_month  NUMERIC(14,2) NOT NULL DEFAULT 0,
  esic_employee_this_month NUMERIC(14,2) NOT NULL DEFAULT 0,
  professional_tax_this_month NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_this_month          NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Remarks for Zoho
  remarks                 TEXT,

  -- Lock
  is_locked               BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at               TIMESTAMPTZ,
  -- Locked when payroll_export_files record is created.

  entered_by              UUID REFERENCES employees(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER payroll_inputs_updated_at
  BEFORE UPDATE ON payroll_monthly_inputs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_payroll_inputs_employee_month
  ON payroll_monthly_inputs(employee_id, month_year);
CREATE INDEX idx_payroll_inputs_month  ON payroll_monthly_inputs(month_year DESC);
CREATE INDEX idx_payroll_inputs_locked ON payroll_monthly_inputs(is_locked)
  WHERE is_locked = FALSE;


-- ------------------------------------------------------------
-- 8. payroll_export_files
-- Record of every Zoho CSV export generated.
-- Immutable — Tier 3.
-- Generated on 25th of every month.
-- ------------------------------------------------------------
CREATE TABLE payroll_export_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_year          TEXT NOT NULL UNIQUE,
  generated_by        UUID NOT NULL REFERENCES employees(id),
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  employee_count      INT NOT NULL,
  total_gross         NUMERIC(14,2) NOT NULL,
  total_pf            NUMERIC(14,2) NOT NULL,
  total_esic          NUMERIC(14,2) NOT NULL,
  total_pt            NUMERIC(14,2) NOT NULL,
  total_net           NUMERIC(14,2) NOT NULL,

  -- Storage
  csv_storage_path    TEXT NOT NULL UNIQUE,
  -- Path: payroll/exports/payroll_YYYY_MM.csv
  pdf_storage_path    TEXT,
  -- Payroll statement PDF.

  -- Zoho upload confirmation
  uploaded_to_zoho    BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at         TIMESTAMPTZ,
  uploaded_by         UUID REFERENCES employees(id),

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_payroll_exports_month ON payroll_export_files(month_year DESC);


-- ------------------------------------------------------------
-- 9. employee_insurance
-- Group health and personal accident insurance tracking.
-- Alert when addition pending >25 days from join date.
-- ------------------------------------------------------------
CREATE TABLE employee_insurance (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  insurance_type          TEXT NOT NULL CHECK (insurance_type IN (
    'group_health', 'personal_accident', 'term_life', 'other'
  )),

  policy_number           TEXT,
  insurer_name            TEXT NOT NULL,
  sum_insured             NUMERIC(14,2) NOT NULL,

  -- Coverage dates
  coverage_start_date     DATE NOT NULL,
  coverage_end_date       DATE,
  -- NULL for ongoing group policies.

  -- Dependents (for group health)
  dependents_covered      INT NOT NULL DEFAULT 0,
  -- Number of family members covered.
  dependent_names         TEXT[],

  -- Addition tracking
  addition_requested_date DATE,
  -- Date HR initiated addition to policy.
  addition_confirmed_date DATE,
  -- Date insurer confirmed addition.
  addition_pending_days   INT,
  -- Computed: TODAY - addition_requested_date.
  -- Alert when > 25 days.

  premium_annual          NUMERIC(14,2),
  premium_paid_by         TEXT CHECK (premium_paid_by IN (
    'company', 'employee', 'shared'
  )),

  policy_document_path    TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER employee_insurance_updated_at
  BEFORE UPDATE ON employee_insurance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_insurance_employee ON employee_insurance(employee_id);
CREATE INDEX idx_insurance_pending  ON employee_insurance(addition_requested_date)
  WHERE addition_confirmed_date IS NULL
    AND addition_requested_date IS NOT NULL;
CREATE INDEX idx_insurance_active   ON employee_insurance(is_active)
  WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- RLS — leave, payroll, insurance
-- ------------------------------------------------------------

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_requests_read"
  ON leave_requests FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR approved_by = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "leave_requests_insert"
  ON leave_requests FOR INSERT
  WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

CREATE POLICY "leave_requests_update"
  ON leave_requests FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
    OR (
      employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
      AND status = 'pending'
    )
  );

-- leave_ledger: immutable. Read restricted to employee + HR + founder.
ALTER TABLE leave_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_ledger_read"
  ON leave_ledger FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "leave_ledger_insert"
  ON leave_ledger FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_balances_read"
  ON leave_balances FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "att_corrections_read"
  ON attendance_corrections FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "att_corrections_write"
  ON attendance_corrections FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE monthly_attendance_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_read"
  ON monthly_attendance_summary FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "attendance_write"
  ON monthly_attendance_summary FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

-- payroll_monthly_inputs: salary-level sensitivity.
-- Same restriction as compensation.
ALTER TABLE payroll_monthly_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_inputs_read"
  ON payroll_monthly_inputs FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "payroll_inputs_write"
  ON payroll_monthly_inputs FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

-- payroll_export_files: founder and hr_manager only.
ALTER TABLE payroll_export_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_exports_read"
  ON payroll_export_files FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

CREATE POLICY "payroll_exports_insert"
  ON payroll_export_files FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_insurance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_read"
  ON employee_insurance FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "insurance_write"
  ON employee_insurance FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

COMMIT;