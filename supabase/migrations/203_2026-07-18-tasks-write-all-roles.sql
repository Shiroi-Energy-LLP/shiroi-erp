-- ============================================================================
-- 203: tasks — every employee can create/assign tasks to anyone
-- ----------------------------------------------------------------------------
-- Ask (Vivek, 2026-07-18): anyone should be able to give a task to anyone else.
-- Mig 201 fixed the assignee dropdown (names-only employee_directory view), so
-- Manivel (project_manager) and Prem (marketing_manager) can already assign to
-- each other and to Vivek — their roles are in the mig-052 tasks_write list.
-- The remaining gap is the role list itself: designer, finance and
-- purchase_officer are excluded, so those employees cannot create tasks at all.
--
-- Fix: open tasks_write to every employee role — i.e. any authenticated user
-- who is not a customer and is linked to an employees row. This matches the
-- existing trust model (the 7 previously-listed roles could already write any
-- task row). tasks_read is intentionally unchanged: founder/PM/HR/marketing
-- see all tasks; everyone else sees tasks they are assigned to or created.
-- ============================================================================

DROP POLICY IF EXISTS tasks_write ON public.tasks;
CREATE POLICY tasks_write ON public.tasks FOR ALL USING (
  get_my_role() <> 'customer'::app_role
  AND get_my_employee_id() IS NOT NULL
);
