-- ============================================================================
-- 201: employee_directory — safe company-wide name directory (view)
-- ----------------------------------------------------------------------------
-- Root cause: employees_read RLS (mig 007b, restated in 052) limits SELECT on
-- employees to founder/hr_manager, self, and direct reports. Every other role
-- therefore saw only themselves in assignee dropdowns (tasks quick-add, create
-- dialog, OM tickets, AMC, milestones, execution stepper) and got blank
-- assignee names in task lists. Concretely: Manivel (project_manager) and
-- Prem (marketing_manager) could not assign tasks to each other or to Vivek.
--
-- employees carries Aadhar/PAN/bank/personal columns, so broadening the RLS
-- policy is NOT an option. Instead: a postgres-owned view (security-definer
-- semantics — intentionally bypasses employees RLS; the Supabase
-- security_definer_view advisor warning on this view is accepted) exposing
-- ONLY id, full_name, is_active. Any authenticated employee may read names;
-- nothing else. PostgREST can also embed it through the base-table FKs
-- (e.g. assignee:employee_directory!project_tasks_assigned_to_fkey(full_name)).
-- ============================================================================

CREATE OR REPLACE VIEW public.employee_directory AS
  SELECT id, full_name, is_active
  FROM public.employees;

COMMENT ON VIEW public.employee_directory IS
  'Names-only employee directory for dropdowns/embeds. Bypasses employees RLS by design (postgres-owned view); exposes no sensitive columns.';

REVOKE ALL ON public.employee_directory FROM anon, public;
GRANT SELECT ON public.employee_directory TO authenticated, service_role;
