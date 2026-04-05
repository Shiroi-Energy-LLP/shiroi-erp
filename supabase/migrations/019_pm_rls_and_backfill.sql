-- Migration 019: PM RLS blanket access + project_manager_id backfill
-- Applied: April 5, 2026 (dev)
--
-- Root cause: HubSpot migration did not populate project_manager_id on projects.
-- All 314 projects had NULL PM, making PM role see empty table due to RLS.
--
-- Changes:
-- 1. Add project_manager to blanket read access roles in projects RLS
-- 2. Backfill Manivel Marimuthu as PM on all projects (only PM in system)

-- 1. Update RLS policy: project_manager gets blanket read access
DROP POLICY IF EXISTS projects_read ON projects;

CREATE POLICY projects_read ON projects FOR SELECT USING (
  (get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'finance'::app_role,
    'hr_manager'::app_role,
    'project_manager'::app_role
  ]))
  OR (project_manager_id = get_my_employee_id())
  OR (site_supervisor_id = get_my_employee_id())
  OR (EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = projects.id
      AND pa.employee_id = get_my_employee_id()
      AND pa.unassigned_at IS NULL
  ))
  OR (get_my_role() = 'customer'::app_role AND customer_profile_id = auth.uid())
);

-- 2. Backfill: set Manivel as PM on all projects without a PM
-- Employee ID: 89b79ffe-45fc-4408-b34b-403302b00f1b (Manivel Marimuthu)
UPDATE projects
SET project_manager_id = '89b79ffe-45fc-4408-b34b-403302b00f1b'
WHERE deleted_at IS NULL
  AND project_manager_id IS NULL;
