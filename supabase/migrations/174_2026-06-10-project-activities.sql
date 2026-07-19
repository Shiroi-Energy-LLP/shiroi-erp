-- =============================================================================
-- Migration 174 — project_activities (daily site activity log w/ manpower)
-- Spec: docs/superpowers/specs/2026-06-10-project-module-enhancements-design.md
-- SE = Shiroi manpower · OS = outsourced manpower · contractor = contractor crew
-- Stage = execution_milestones_master row. done_by is free text (crews aren't
-- employees). PM + founder write; everyone reads. Soft delete via deleted_at.
-- =============================================================================

CREATE TABLE project_activities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  stage_id          UUID REFERENCES execution_milestones_master(id),
  done_by           TEXT,
  description       TEXT NOT NULL,
  se_count          INT NOT NULL DEFAULT 0 CHECK (se_count >= 0),
  os_count          INT NOT NULL DEFAULT 0 CHECK (os_count >= 0),
  contractor_count  INT NOT NULL DEFAULT 0 CHECK (contractor_count >= 0),
  notes             TEXT,
  created_by        UUID NOT NULL REFERENCES employees(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE TRIGGER project_activities_updated_at
  BEFORE UPDATE ON project_activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every filterable/sortable column gets an index (NEVER-DO #17)
CREATE INDEX idx_project_activities_project ON project_activities(project_id);
CREATE INDEX idx_project_activities_date    ON project_activities(activity_date DESC);
CREATE INDEX idx_project_activities_stage   ON project_activities(stage_id);
CREATE INDEX idx_project_activities_live    ON project_activities(project_id, activity_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE project_activities ENABLE ROW LEVEL SECURITY;

-- All authenticated employees read
CREATE POLICY "project_activities_read" ON project_activities
  FOR SELECT TO authenticated USING (true);

-- PM + founder write (soft delete = UPDATE deleted_at; no DELETE policy)
CREATE POLICY "project_activities_insert" ON project_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('founder', 'project_manager')
    AND created_by = get_my_employee_id()
  );

CREATE POLICY "project_activities_update" ON project_activities
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('founder', 'project_manager'))
  WITH CHECK (get_my_role() IN ('founder', 'project_manager'));

-- Summary counts in SQL (NEVER-DO #12). NULL p_project_id = all projects
-- (global /activities page). SECURITY INVOKER (default) so RLS applies.
CREATE OR REPLACE FUNCTION get_project_activities_summary(
  p_project_id UUID DEFAULT NULL,
  p_from       DATE DEFAULT NULL,
  p_to         DATE DEFAULT NULL,
  p_stage_id   UUID DEFAULT NULL
)
RETURNS TABLE (
  total_activities  BIGINT,
  total_se          BIGINT,
  total_os          BIGINT,
  total_contractor  BIGINT,
  distinct_projects BIGINT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COUNT(*),
         COALESCE(SUM(se_count), 0),
         COALESCE(SUM(os_count), 0),
         COALESCE(SUM(contractor_count), 0),
         COUNT(DISTINCT project_id)
  FROM project_activities
  WHERE deleted_at IS NULL
    AND (p_project_id IS NULL OR project_id    = p_project_id)
    AND (p_from       IS NULL OR activity_date >= p_from)
    AND (p_to         IS NULL OR activity_date <= p_to)
    AND (p_stage_id   IS NULL OR stage_id      = p_stage_id);
$$;

REVOKE ALL ON FUNCTION get_project_activities_summary(UUID, DATE, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_project_activities_summary(UUID, DATE, DATE, UUID) TO authenticated;
