-- =============================================================================
-- Migration 173 — Milestone-weighted project completion %
-- Spec: docs/superpowers/specs/2026-06-10-project-module-enhancements-design.md
-- 1) weight column on execution_milestones_master (10 milestones, sums to 100)
-- 2) get_project_completion_pct rewritten: task-ratio per milestone × weight
--    (replaces the manual project_completion_items checklist — table kept,
--    no longer read; legacy project_milestone_weights table also bypassed)
-- 3) trigger-maintained cache on projects.completion_pct
-- =============================================================================

-- ── 1. Weights on the master table ──────────────────────────────────────────
ALTER TABLE execution_milestones_master
  ADD COLUMN IF NOT EXISTS weight INT NOT NULL DEFAULT 10 CHECK (weight >= 0);

UPDATE execution_milestones_master SET weight = v.weight
FROM (VALUES
  ('material_delivery',       10),
  ('structure_installation',  15),
  ('panel_installation',      20),
  ('electrical_work',         15),
  ('earthing_work',            5),
  ('civil_work',              10),
  ('testing_commissioning',   10),
  ('net_metering',             5),
  ('handover',                 5),
  ('follow_ups',               5)
) AS v(name, weight)
WHERE milestone_name = v.name;

-- ── 2. Rewrite the completion RPC (same name + signature; all callers keep working)
CREATE OR REPLACE FUNCTION get_project_completion_pct(p_project_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH ms AS (
    SELECT pm.id,
           -- Legacy milestone names absent from the master (e.g. old
           -- 'advance_payment' rows) take the column default weight 10.
           COALESCE(emm.weight, 10) AS weight,
           pm.completion_pct        AS stored_pct
    FROM project_milestones pm
    LEFT JOIN execution_milestones_master emm
      ON emm.milestone_name = pm.milestone_name
    WHERE pm.project_id = p_project_id
  ),
  task_counts AS (
    -- Count by milestone_id (not tasks.project_id) so universal-entity tasks
    -- attached to a milestone are included.
    SELECT t.milestone_id,
           COUNT(*)                                AS total,
           COUNT(*) FILTER (WHERE t.is_completed)  AS done
    FROM tasks t
    WHERE t.milestone_id IN (SELECT id FROM ms)
      AND t.deleted_at IS NULL
    GROUP BY t.milestone_id
  ),
  per_ms AS (
    SELECT ms.weight,
           CASE
             WHEN COALESCE(tc.total, 0) > 0
               THEN ROUND(tc.done::NUMERIC / tc.total * 100, 2)
             -- Zero tasks → stored milestone pct (mirrors the Execution step's
             -- existing fallback so manually-tracked milestones aren't zeroed).
             ELSE COALESCE(ms.stored_pct, 0)
           END AS pct
    FROM ms
    LEFT JOIN task_counts tc ON tc.milestone_id = ms.id
  )
  SELECT COALESCE(ROUND(SUM(weight * pct) / NULLIF(SUM(weight), 0), 0), 0)
  FROM per_ms;
$$;

-- ── 3. Cache on projects.completion_pct ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_refresh_project_completion_pct()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[] := '{}';
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || COALESCE(
        NEW.project_id,
        (SELECT project_id FROM project_milestones WHERE id = NEW.milestone_id)
      );
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || COALESCE(
        OLD.project_id,
        (SELECT project_id FROM project_milestones WHERE id = OLD.milestone_id)
      );
    END IF;
  ELSE  -- project_milestones
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_ids := v_ids || NEW.project_id; END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_ids := v_ids || OLD.project_id; END IF;
  END IF;

  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(v_ids) AS x WHERE x IS NOT NULL);
  IF array_length(v_ids, 1) IS NOT NULL THEN
    UPDATE projects
    SET completion_pct = get_project_completion_pct(id)
    WHERE id = ANY (v_ids);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION fn_refresh_project_completion_pct() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_tasks_refresh_completion ON tasks;
CREATE TRIGGER trg_tasks_refresh_completion
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION fn_refresh_project_completion_pct();

DROP TRIGGER IF EXISTS trg_milestones_refresh_completion ON project_milestones;
CREATE TRIGGER trg_milestones_refresh_completion
  AFTER INSERT OR UPDATE OR DELETE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION fn_refresh_project_completion_pct();

-- ── 4. One-time backfill ─────────────────────────────────────────────────────
-- Only projects that HAVE milestones; legacy imports (no milestones, seeded
-- completion_pct) keep their stored value.
UPDATE projects p
SET completion_pct = get_project_completion_pct(p.id)
WHERE EXISTS (SELECT 1 FROM project_milestones pm WHERE pm.project_id = p.id);
