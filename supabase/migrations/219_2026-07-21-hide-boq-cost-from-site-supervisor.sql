-- =============================================================================
-- Migration 219 — Strip BOM/BOQ cost from site supervisors (data-plane)
-- =============================================================================
-- Resolves the open item explicitly flagged (and deferred) in mig 211 header
-- note #5: the /projects/[id]?tab=bom and ?tab=boq surfaces read
-- project_boq_items with the user-context client, and site_supervisor was in
-- project_boq_items_read, so a site engineer could read unit_price / total_price
-- / gst_rate for their projects — directly via PostgREST, and (on the BOQ tab)
-- rendered on screen. Same server-side-stripping posture as price_book (mig 211)
-- and the /purchase intake flow: cost never leaves the DB for a site engineer.
--
-- Mechanism (all authenticated users share ONE Postgres role, so column-level
-- masking cannot be an RLS predicate — it needs a SECURITY DEFINER RPC):
--
--  1. Remove site_supervisor from project_boq_items_read so raw PostgREST can
--     never return cost columns to a site engineer. The other cost-authorized
--     roles (founder/finance/project_manager/purchase_officer/designer) keep
--     the base policy unchanged.
--     (proposal_bom_lines.bom_lines_read already EXCLUDES site_supervisor, so
--     the proposal-BOM path needs no change — documented here for the reviewer.)
--
--  2. Two SECURITY DEFINER RPCs return project_boq_items rows with the monetary
--     columns (unit_price, gst_rate, total_price, actual_unit_price,
--     actual_total_price, price_book_id) set to NULL for callers whose role is
--     NOT cost-authorized, real cost otherwise. Visibility is gated to the
--     caller's projects by mirroring the projects_read predicate (mig 211) — a
--     DEFINER function bypasses RLS, so it must re-enforce visibility itself.
--       - get_project_boq_items_masked(p_project_id)  → BOQ tab / getStepBoqData
--       - get_boi_boq_items_masked(p_boi_id)          → BOM tab / getBoiItems
--     Masking the full non-cost-visible set (not just site_supervisor) is
--     deliberately STRICTER than the mig-211 base policy: it prevents a
--     widening for roles that projects_read can see but the old
--     project_boq_items_read never granted cost to (e.g. marketing_manager).
--     "site_supervisor → cost NULL, project_manager → cost present" holds.
--
--  3. The app repoints getStepBoqData / getBoiItems to these RPCs for ALL
--     callers (the RPC self-masks by role), and gates the cost columns/summaries
--     in StepBoq behind a showCost flag.
--
-- Types impact: two new RPCs returning SETOF project_boq_items →
-- packages/types/database.ts regenerated in the same commit (NEVER-DO #20).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. project_boq_items_read: drop site_supervisor (data-plane cost stripping).
--    Byte-identical otherwise to the pre-219 policy minus that one role.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS project_boq_items_read ON project_boq_items;
CREATE POLICY project_boq_items_read ON project_boq_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = ANY (ARRAY[
        'founder'::app_role, 'finance'::app_role, 'project_manager'::app_role,
        'purchase_officer'::app_role, 'designer'::app_role
      ])
  ));

-- ---------------------------------------------------------------------------
-- 2a. Private visibility helper — mirrors the projects_read predicate (mig 211).
--     SECURITY DEFINER so it can evaluate the predicate regardless of the base
--     projects RLS; returns TRUE iff the caller may see this project.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._boq_caller_can_view_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND (
        (get_my_role() = ANY (ARRAY[
          'founder'::app_role, 'finance'::app_role, 'hr_manager'::app_role,
          'project_manager'::app_role, 'marketing_manager'::app_role,
          'designer'::app_role, 'purchase_officer'::app_role
        ]))
        OR (p.project_manager_id = get_my_employee_id())
        OR (p.site_supervisor_id = get_my_employee_id())
        OR (EXISTS (
          SELECT 1 FROM project_assignments pa
          WHERE pa.project_id = p.id
            AND pa.employee_id = get_my_employee_id()
            AND pa.unassigned_at IS NULL
        ))
        OR ((get_my_role() = 'customer'::app_role)
            AND (p.customer_profile_id = (SELECT auth.uid())))
      )
  );
$$;
REVOKE ALL ON FUNCTION public._boq_caller_can_view_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._boq_caller_can_view_project(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2b. get_project_boq_items_masked(p_project_id) — all BOQ items for a project.
--     Cost NULL for non-cost-visible roles; visibility-gated. Returns SETOF the
--     table type so the app keeps the exact project_boq_items Row shape.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_boq_items_masked(p_project_id uuid)
RETURNS SETOF project_boq_items
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mask boolean := (get_my_role() <> ALL (ARRAY[
    'founder'::app_role, 'finance'::app_role, 'project_manager'::app_role,
    'purchase_officer'::app_role, 'designer'::app_role
  ]));
  r project_boq_items;
BEGIN
  IF NOT public._boq_caller_can_view_project(p_project_id) THEN
    RETURN;  -- caller cannot see this project → no rows
  END IF;

  FOR r IN
    SELECT * FROM project_boq_items
    WHERE project_id = p_project_id
    ORDER BY line_number ASC
  LOOP
    IF v_mask THEN
      r.unit_price         := NULL;
      r.gst_rate           := NULL;
      r.total_price        := NULL;
      r.actual_unit_price  := NULL;
      r.actual_total_price := NULL;
      r.price_book_id      := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_project_boq_items_masked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_boq_items_masked(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_project_boq_items_masked(uuid) IS
  'Project BOQ items with cost columns (unit_price/gst_rate/total_price/actual_*/price_book_id) NULLed for non-cost-visible roles (anyone except founder/finance/project_manager/purchase_officer/designer — e.g. site_supervisor). Visibility mirrors projects_read (mig 211/219). SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- 2c. get_boi_boq_items_masked(p_boi_id) — items for one BOI version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_boi_boq_items_masked(p_boi_id uuid)
RETURNS SETOF project_boq_items
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mask boolean := (get_my_role() <> ALL (ARRAY[
    'founder'::app_role, 'finance'::app_role, 'project_manager'::app_role,
    'purchase_officer'::app_role, 'designer'::app_role
  ]));
  v_project_id uuid;
  r project_boq_items;
BEGIN
  SELECT project_id INTO v_project_id FROM project_bois WHERE id = p_boi_id;
  IF v_project_id IS NULL THEN
    RETURN;  -- unknown BOI
  END IF;
  IF NOT public._boq_caller_can_view_project(v_project_id) THEN
    RETURN;  -- caller cannot see the parent project
  END IF;

  FOR r IN
    SELECT * FROM project_boq_items
    WHERE boi_id = p_boi_id
    ORDER BY line_number ASC
  LOOP
    IF v_mask THEN
      r.unit_price         := NULL;
      r.gst_rate           := NULL;
      r.total_price        := NULL;
      r.actual_unit_price  := NULL;
      r.actual_total_price := NULL;
      r.price_book_id      := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_boi_boq_items_masked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boi_boq_items_masked(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_boi_boq_items_masked(uuid) IS
  'BOQ items for a single BOI version, cost columns NULLed for non-cost-visible roles (see get_project_boq_items_masked). Resolves the parent project from project_bois and gates visibility via projects_read mirror. SECURITY DEFINER.';

COMMIT;

-- =============================================================================
-- Verification (run after applying)
-- =============================================================================
--  SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname='project_boq_items_read';
--    -- must NOT contain site_supervisor
--  SELECT prosecdef FROM pg_proc WHERE proname IN
--    ('get_project_boq_items_masked','get_boi_boq_items_masked','_boq_caller_can_view_project'); -- all true
-- =============================================================================
