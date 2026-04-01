-- Migration 008a: Fix RLS infinite recursion across all tables
-- Date: 2026-03-30
-- Author: Vivek + Claude
--
-- PROBLEM:
-- ~200+ RLS policies used subqueries like:
--   (SELECT role FROM profiles WHERE id = auth.uid())
--   (SELECT id FROM employees WHERE profile_id = auth.uid())
--
-- These caused infinite recursion because:
-- 1. The profiles table's own RLS policy queried profiles → infinite loop
-- 2. The employees table's own RLS policy queried employees → infinite loop
-- 3. Cross-table chains (e.g. proposals → employees → profiles) triggered the same
--
-- FIX:
-- Created SECURITY DEFINER helper functions that bypass RLS:
--   get_my_role()         → returns current user's app_role from profiles
--   get_my_employee_id()  → returns current user's employee UUID
--
-- Then replaced all recursive subqueries in all policies with these functions.
--
-- RULE FOR FUTURE POLICIES:
-- NEVER use (SELECT role FROM profiles WHERE id = auth.uid()) in any RLS policy.
-- NEVER use (SELECT id FROM employees WHERE profile_id = auth.uid()) in any RLS policy.
-- ALWAYS use get_my_role() and get_my_employee_id() instead.

-- ============================================================================
-- STEP 1: Create helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon;

CREATE OR REPLACE FUNCTION public.get_my_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM employees WHERE profile_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_employee_id() TO anon;

-- ============================================================================
-- STEP 2: Fix handle_new_user trigger to handle missing metadata gracefully
-- ============================================================================

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
    COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'customer'::app_role),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$;

-- ============================================================================
-- STEP 3: Bulk replace all policies using (SELECT role FROM profiles ...)
-- Uses exact string match with chr(10) for newlines as PostgreSQL formats them.
-- ============================================================================

DO $$
DECLARE
  pol RECORD;
  new_qual TEXT;
  new_check TEXT;
  cmd_clause TEXT;
  old_text TEXT;
BEGIN
  old_text := '( SELECT profiles.role' || chr(10) || '   FROM profiles' || chr(10) || '  WHERE profiles.id = auth.uid())';

  FOR pol IN
    SELECT
      p.polname AS policyname,
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polcmd,
      pg_get_expr(p.polqual, p.polrelid, true) AS qual_expr,
      pg_get_expr(p.polwithcheck, p.polrelid, true) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pg_get_expr(p.polqual, p.polrelid, true) LIKE '%SELECT profiles.role%FROM profiles%WHERE profiles.id = auth.uid()%'
  LOOP
    new_qual := replace(pol.qual_expr, old_text, 'get_my_role()');

    new_check := NULL;
    IF pol.check_expr IS NOT NULL AND pol.check_expr != '' THEN
      new_check := replace(pol.check_expr, old_text, 'get_my_role()');
    END IF;

    CASE pol.polcmd
      WHEN 'r' THEN cmd_clause := 'SELECT';
      WHEN 'a' THEN cmd_clause := 'INSERT';
      WHEN 'w' THEN cmd_clause := 'UPDATE';
      WHEN 'd' THEN cmd_clause := 'DELETE';
      WHEN '*' THEN cmd_clause := 'ALL';
      ELSE cmd_clause := 'ALL';
    END CASE;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    IF new_check IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd_clause, new_qual, new_check);
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd_clause, new_qual);
    END IF;

    RAISE NOTICE 'Fixed (profiles→get_my_role): %.%', pol.tablename, pol.policyname;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 4: Bulk replace all policies using (SELECT id FROM employees WHERE profile_id = auth.uid())
-- ============================================================================

DO $$
DECLARE
  pol RECORD;
  new_qual TEXT;
  new_check TEXT;
  cmd_clause TEXT;
  old_text TEXT;
BEGIN
  old_text := '( SELECT employees.id' || chr(10) || '   FROM employees' || chr(10) || '  WHERE employees.profile_id = auth.uid())';

  FOR pol IN
    SELECT
      p.polname AS policyname,
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polcmd,
      pg_get_expr(p.polqual, p.polrelid, true) AS qual_expr,
      pg_get_expr(p.polwithcheck, p.polrelid, true) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pg_get_expr(p.polqual, p.polrelid, true) LIKE '%SELECT employees.id%FROM employees%WHERE employees.profile_id = auth.uid()%'
  LOOP
    new_qual := replace(pol.qual_expr, old_text, 'get_my_employee_id()');

    new_check := NULL;
    IF pol.check_expr IS NOT NULL AND pol.check_expr != '' THEN
      new_check := replace(pol.check_expr, old_text, 'get_my_employee_id()');
    END IF;

    CASE pol.polcmd
      WHEN 'r' THEN cmd_clause := 'SELECT';
      WHEN 'a' THEN cmd_clause := 'INSERT';
      WHEN 'w' THEN cmd_clause := 'UPDATE';
      WHEN 'd' THEN cmd_clause := 'DELETE';
      WHEN '*' THEN cmd_clause := 'ALL';
      ELSE cmd_clause := 'ALL';
    END CASE;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    IF new_check IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd_clause, new_qual, new_check);
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd_clause, new_qual);
    END IF;

    RAISE NOTICE 'Fixed (employees→get_my_employee_id): %.%', pol.tablename, pol.policyname;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 5: Fix remaining policies with nested employees_1 alias pattern
-- These are "reporting to me" checks with double-nested subqueries.
-- ============================================================================

-- profiles table
DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
CREATE POLICY "profiles_read_own" ON profiles FOR SELECT USING (
  id = auth.uid() OR get_my_role() IN ('founder', 'hr_manager')
);

-- employees table
DROP POLICY IF EXISTS "employees_read" ON employees;
CREATE POLICY "employees_read" ON employees FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR profile_id = auth.uid()
  OR reporting_to_id = get_my_employee_id()
);

DROP POLICY IF EXISTS "employees_update" ON employees;
CREATE POLICY "employees_update" ON employees FOR UPDATE USING (
  get_my_role() IN ('founder', 'hr_manager')
);

-- leave_requests
DROP POLICY IF EXISTS "leave_requests_read" ON leave_requests;
CREATE POLICY "leave_requests_read" ON leave_requests FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR approved_by = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

DROP POLICY IF EXISTS "leave_requests_update" ON leave_requests;
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR (employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id()))
  OR (employee_id = get_my_employee_id() AND status = 'pending')
);

-- leave_ledger
DROP POLICY IF EXISTS "leave_ledger_read" ON leave_ledger;
CREATE POLICY "leave_ledger_read" ON leave_ledger FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- leave_balances
DROP POLICY IF EXISTS "leave_balances_read" ON leave_balances;
CREATE POLICY "leave_balances_read" ON leave_balances FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- employee_compensation
DROP POLICY IF EXISTS "compensation_read" ON employee_compensation;
CREATE POLICY "compensation_read" ON employee_compensation FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- salary_increment_history
DROP POLICY IF EXISTS "increment_history_read" ON salary_increment_history;
CREATE POLICY "increment_history_read" ON salary_increment_history FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- monthly_attendance_summary
DROP POLICY IF EXISTS "attendance_read" ON monthly_attendance_summary;
CREATE POLICY "attendance_read" ON monthly_attendance_summary FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- employee_question_progress
DROP POLICY IF EXISTS "question_progress_read" ON employee_question_progress;
CREATE POLICY "question_progress_read" ON employee_question_progress FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- onboarding_track_assignments
DROP POLICY IF EXISTS "track_assignments_read" ON onboarding_track_assignments;
CREATE POLICY "track_assignments_read" ON onboarding_track_assignments FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- training_assessment_results
DROP POLICY IF EXISTS "assessment_results_read" ON training_assessment_results;
CREATE POLICY "assessment_results_read" ON training_assessment_results FOR SELECT USING (
  get_my_role() IN ('founder', 'hr_manager')
  OR employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
);

-- projects (has EXISTS with join to employees)
DROP POLICY IF EXISTS "projects_read" ON projects;
CREATE POLICY "projects_read" ON projects FOR SELECT USING (
  get_my_role() IN ('founder', 'finance', 'hr_manager')
  OR project_manager_id = get_my_employee_id()
  OR site_supervisor_id = get_my_employee_id()
  OR EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = projects.id
      AND pa.employee_id = get_my_employee_id()
      AND pa.unassigned_at IS NULL
  )
  OR (get_my_role() = 'customer' AND customer_profile_id = auth.uid())
);

-- daily_site_reports (has nested employee lookup in EXISTS)
DROP POLICY IF EXISTS "dsr_read" ON daily_site_reports;
CREATE POLICY "dsr_read" ON daily_site_reports FOR SELECT USING (
  get_my_role() IN ('founder', 'project_manager', 'finance')
  OR submitted_by = get_my_employee_id()
  OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = daily_site_reports.project_id
      AND (p.project_manager_id = get_my_employee_id()
        OR p.site_supervisor_id = get_my_employee_id())
  )
);

-- ============================================================================
-- VERIFICATION: Run after migration to confirm zero recursive policies remain
-- ============================================================================
-- SELECT count(*) FROM pg_policy p
--   JOIN pg_class c ON c.oid = p.polrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND (pg_get_expr(p.polqual, p.polrelid, true) LIKE '%employees%profile_id%uid%'
--       OR pg_get_expr(p.polqual, p.polrelid, true) LIKE '%profiles%role%uid%');
-- Expected result: 0
