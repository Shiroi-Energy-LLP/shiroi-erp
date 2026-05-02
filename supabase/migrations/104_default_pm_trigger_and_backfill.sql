-- ============================================================================
-- Migration 104 — Default project_manager on every INSERT + backfill
-- Date: 2026-05-02
--
-- WHY
-- ---
-- Migration 019 backfilled all NULL-PM projects to Manivel and added
-- project_manager to projects_read RLS. Since then, repeated bulk imports
-- (HubSpot, Zoho, Drive) re-introduced NULL-PM projects because they
-- INSERT directly into the projects table — bypassing the
-- create_project_from_accepted_proposal trigger (which only fires AFTER
-- UPDATE on proposals → 'accepted', not on direct INSERT).
--
-- Symptom user reported (2026-05-02):
--   - 25+ leads imported as 'won' today; their projects had project_manager_id
--     = NULL.
--   - "Edit finance amount in projects" and similar PM-scoped flows
--     stopped working because RLS made these projects invisible to the
--     PM role.
--
-- Manivel is currently the only active project_manager. As long as that's
-- true, every new project should default to him, regardless of which
-- code path inserted it.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Re-backfill: set project_manager_id = Manivel's employee_id on every
--    NULL-PM live project. Same UUID as migration 019.
-- 2. Add a BEFORE INSERT trigger on projects that resolves the latest
--    active project_manager (LIMIT 1, ORDER BY created_at DESC — same rule
--    as create_project_from_accepted_proposal in migs 064/094) and fills
--    project_manager_id if the caller left it NULL. SECURITY DEFINER so
--    the lookup works for non-founder callers without granting employees
--    SELECT to everyone.
--
-- The existing trigger create_project_from_accepted_proposal is left
-- alone — it still does the lookup and INSERT, the BEFORE trigger is
-- a no-op when the column is already populated.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Backfill any NULL-PM projects to Manivel
-- ----------------------------------------------------------------------------

UPDATE projects
SET project_manager_id = '89b79ffe-45fc-4408-b34b-403302b00f1b'  -- Manivel Sellamuthu
WHERE project_manager_id IS NULL
  AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. BEFORE INSERT trigger: default project_manager_id to latest active PM
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_default_project_manager_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF NEW.project_manager_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.id
    INTO NEW.project_manager_id
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  WHERE p.role = 'project_manager'
    AND e.is_active = TRUE
  ORDER BY e.created_at DESC
  LIMIT 1;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_default_project_manager_on_insert ON projects;

CREATE TRIGGER trg_default_project_manager_on_insert
  BEFORE INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_default_project_manager_on_insert();

COMMIT;
