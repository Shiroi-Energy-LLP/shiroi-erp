-- ============================================================
-- Migration 001 — Foundation Tables
-- File: supabase/migrations/001_foundation.sql
-- Description: Core auth profiles, role enum, and employee master.
--              Every other table in the system references these.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS employees CASCADE;
--   DROP TABLE IF EXISTS profiles CASCADE;
--   DROP TYPE  IF EXISTS app_role;
-- Dependencies: None — this is the first migration.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Role enum
-- All 8 roles are locked. No new roles without a migration.
-- ------------------------------------------------------------
CREATE TYPE app_role AS ENUM (
  'founder',
  'hr_manager',
  'sales_engineer',
  'project_manager',
  'site_supervisor',
  'om_technician',
  'finance',
  'customer'
);


-- ------------------------------------------------------------
-- 2. profiles
-- One row per Supabase Auth user (employee or customer).
-- Created automatically via trigger when auth.users gets a new row.
-- Every RLS policy in the system does:
--   (SELECT role FROM profiles WHERE id = auth.uid())
-- ------------------------------------------------------------
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          app_role NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, email, phone)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'role')::app_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_profiles_role     ON profiles(role);
CREATE INDEX idx_profiles_active   ON profiles(is_active) WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 3. employees
-- HR master record. One row per Shiroi staff member.
-- Customers do NOT have a row here — they only have profiles.
-- ------------------------------------------------------------
CREATE TABLE employees (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
  employee_code         TEXT NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  date_of_birth         DATE,
  gender                TEXT CHECK (gender IN ('male', 'female', 'other')),
  personal_email        TEXT,
  personal_phone        TEXT NOT NULL,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  state                 TEXT,
  pincode               TEXT,
  designation           TEXT NOT NULL,
  department            TEXT NOT NULL CHECK (department IN (
    'sales', 'projects', 'operations', 'finance', 'hr', 'management', 'om'
  )),
  employment_type       TEXT NOT NULL DEFAULT 'full_time' CHECK (employment_type IN (
    'full_time', 'part_time', 'contract', 'intern'
  )),
  date_of_joining       DATE NOT NULL,
  probation_end_date    DATE,
  reporting_to_id       UUID REFERENCES employees(id),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_working_day      DATE,
  exit_reason           TEXT CHECK (exit_reason IN (
    'resignation', 'termination', 'contract_end', 'retirement', 'other'
  )),
  aadhar_number         TEXT,
  pan_number            TEXT,
  bank_account_number   TEXT,
  bank_ifsc             TEXT,
  uan_number            TEXT,
  esic_number           TEXT,
  pf_applicable         BOOLEAN NOT NULL DEFAULT TRUE,
  esic_applicable       BOOLEAN NOT NULL DEFAULT FALSE,
  professional_tax_applicable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_employees_profile     ON employees(profile_id);
CREATE INDEX idx_employees_active      ON employees(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_employees_department  ON employees(department);
CREATE INDEX idx_employees_reporting   ON employees(reporting_to_id);
CREATE INDEX idx_employees_code        ON employees(employee_code);


-- ------------------------------------------------------------
-- 4. RLS policies
-- ------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_read_own"
  ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employees_read"
  ON employees FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR profile_id = auth.uid()
    OR reporting_to_id = (
      SELECT e.id FROM employees e WHERE e.profile_id = auth.uid()
    )
  );

CREATE POLICY "employees_insert"
  ON employees FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

CREATE POLICY "employees_update"
  ON employees FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

COMMIT;