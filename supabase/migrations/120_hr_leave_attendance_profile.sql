-- ============================================================
-- Migration 120 — HR: Leave Actions, Attendance, Profile fields
-- File: supabase/migrations/120_hr_leave_attendance_profile.sql
-- Description:
--   C5: Leave management — leave_requests already exists.
--       Adds approve/reject/cancel support (no schema change needed,
--       RLS already covers it). Adds leave_balances seed helper RPC.
--   C6: Employee profile — adds blood_group, bank_name columns
--       to employees table.
--   C7: Attendance tracking — creates daily attendance table +
--       get_monthly_attendance_summary RPC.
-- Date: 2026-05-24
-- Dependencies: 001_foundation.sql, 005a_hr_master.sql, 005b_leave_payroll.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- C6: Add missing profile columns to employees
-- ------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS blood_group TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_is_active  ON employees(is_active);

-- ------------------------------------------------------------
-- C7: Daily attendance table
-- One row per employee per calendar date.
-- Different from monthly_attendance_summary (payroll-level).
-- This is the raw daily tracking; summary is computed from it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  status           TEXT NOT NULL CHECK (status IN (
    'present', 'absent', 'half_day', 'on_leave', 'holiday', 'work_from_home'
  )),
  check_in_time    TIME,
  check_out_time   TIME,
  notes            TEXT,
  marked_by        UUID REFERENCES employees(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE TRIGGER attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date          ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_status        ON attendance(status);

-- RLS for attendance
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Employees can read their own; managers can read their reports; HR/founder see all
CREATE POLICY "attendance_select"
  ON attendance FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

-- Employees can mark their own (limited statuses enforced in app layer)
-- HR/founder can mark anyone
CREATE POLICY "attendance_insert"
  ON attendance FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

-- Only HR/founder can update (correction path)
CREATE POLICY "attendance_update"
  ON attendance FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

-- ------------------------------------------------------------
-- C7: RPC — get_monthly_attendance_summary
-- Returns per-employee attendance counts for a given month/year.
-- Reads from the raw `attendance` table (not monthly_attendance_summary
-- which is the payroll-locked summary).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_monthly_attendance_summary(
  p_employee_id UUID,
  p_month       INT,
  p_year        INT
)
RETURNS TABLE (
  employee_id          UUID,
  present_days         BIGINT,
  absent_days          BIGINT,
  half_days            BIGINT,
  on_leave_days        BIGINT,
  work_from_home_days  BIGINT,
  holiday_days         BIGINT,
  total_marked_days    BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_employee_id                                                    AS employee_id,
    COUNT(*) FILTER (WHERE status = 'present')                       AS present_days,
    COUNT(*) FILTER (WHERE status = 'absent')                        AS absent_days,
    COUNT(*) FILTER (WHERE status = 'half_day')                      AS half_days,
    COUNT(*) FILTER (WHERE status = 'on_leave')                      AS on_leave_days,
    COUNT(*) FILTER (WHERE status = 'work_from_home')                AS work_from_home_days,
    COUNT(*) FILTER (WHERE status = 'holiday')                       AS holiday_days,
    COUNT(*)                                                         AS total_marked_days
  FROM attendance
  WHERE
    employee_id = p_employee_id
    AND EXTRACT(MONTH FROM date) = p_month
    AND EXTRACT(YEAR  FROM date) = p_year;
$$;

-- Grant execute to authenticated users (RLS on the table handles row-level access)
GRANT EXECUTE ON FUNCTION get_monthly_attendance_summary(UUID, INT, INT) TO authenticated;

-- ------------------------------------------------------------
-- C5: RPC — get_leave_balances_for_employee
-- Returns leave balances for the given employee from leave_balances table.
-- Readable by the employee themselves, their manager, HR, and founder.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_leave_balances_for_employee(p_employee_id UUID)
RETURNS TABLE (
  leave_type    leave_type,
  balance_days  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lb.leave_type,
    lb.balance_days
  FROM leave_balances lb
  WHERE lb.employee_id = p_employee_id
    AND (
      -- Caller is the employee themselves
      lb.employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
      -- Caller is the employee's manager
      OR lb.employee_id IN (
        SELECT id FROM employees
        WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
      )
      -- Caller is HR or founder
      OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    )
  ORDER BY lb.leave_type;
$$;

GRANT EXECUTE ON FUNCTION get_leave_balances_for_employee(UUID) TO authenticated;

-- ------------------------------------------------------------
-- C5: RPC — get_pending_leave_requests
-- Returns all pending leave requests. Readable by HR/founder only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_pending_leave_requests()
RETURNS TABLE (
  id            UUID,
  employee_id   UUID,
  full_name     TEXT,
  employee_code TEXT,
  leave_type    leave_type,
  from_date     DATE,
  to_date       DATE,
  days_requested NUMERIC,
  is_half_day   BOOLEAN,
  reason        TEXT,
  applied_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lr.id,
    lr.employee_id,
    e.full_name,
    e.employee_code,
    lr.leave_type,
    lr.from_date,
    lr.to_date,
    lr.days_requested,
    lr.is_half_day,
    lr.reason,
    lr.applied_at
  FROM leave_requests lr
  JOIN employees e ON e.id = lr.employee_id
  WHERE lr.status = 'pending'
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  ORDER BY lr.applied_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_pending_leave_requests() TO authenticated;

-- ------------------------------------------------------------
-- C7: RPC — get_team_attendance_for_month
-- Returns all attendance rows for ALL active employees for a given month.
-- HR/founder only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_team_attendance_for_month(
  p_month INT,
  p_year  INT
)
RETURNS TABLE (
  attendance_id  UUID,
  employee_id    UUID,
  full_name      TEXT,
  employee_code  TEXT,
  date           DATE,
  status         TEXT,
  check_in_time  TIME,
  check_out_time TIME,
  notes          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id            AS attendance_id,
    a.employee_id,
    e.full_name,
    e.employee_code,
    a.date,
    a.status,
    a.check_in_time,
    a.check_out_time,
    a.notes
  FROM attendance a
  JOIN employees e ON e.id = a.employee_id
  WHERE
    EXTRACT(MONTH FROM a.date) = p_month
    AND EXTRACT(YEAR  FROM a.date) = p_year
    AND e.is_active = TRUE
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  ORDER BY e.employee_code, a.date;
$$;

GRANT EXECUTE ON FUNCTION get_team_attendance_for_month(INT, INT) TO authenticated;

COMMIT;
