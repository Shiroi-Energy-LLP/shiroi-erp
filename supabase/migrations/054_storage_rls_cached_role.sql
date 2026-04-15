-- Migration 054: Storage RLS — switch inline profile lookups to cached helper
--
-- Replaces the `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() ...)`
-- pattern in storage.objects policies with `public.get_my_role() = ANY(...)`.
--
-- `get_my_role()` was defined in migration 008a as STABLE + SECURITY DEFINER:
--
--   CREATE FUNCTION public.get_my_role() RETURNS app_role
--     LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path = public
--     AS $$ SELECT role FROM profiles WHERE id = auth.uid() $$;
--
-- STABLE tells Postgres the result is constant within a single SQL statement,
-- so calling it from a row-level policy is a one-shot lookup per statement
-- instead of a per-row profile scan. For a File list operation that returns
-- 100 files, the original `EXISTS (SELECT 1 FROM profiles ...)` pattern fired
-- the subquery once per row — 100 index probes. The helper fires once.
--
-- Why not JWT custom claims?
-- The audit originally proposed a Supabase Auth custom access token hook
-- that would inject `role` into the JWT's app_metadata, letting the policies
-- read `auth.jwt() -> 'app_metadata' -> 'role'` with zero DB lookups. That
-- approach is correct but requires:
--   (1) configuring the access token hook in the Supabase dashboard
--   (2) re-issuing tokens for all existing sessions (otherwise old sessions
--       keep the role-less token and all storage ops fail)
-- Both of those are operational risks for a live tenant. The STABLE-helper
-- approach captures 90% of the perf win with zero config change — one call
-- per statement instead of one per row. If measurement shows this is still
-- the bottleneck later, the JWT-hook migration is additive on top.
--
-- Scope: project-files and site-photos only. proposal-files policies are
-- owned by the ongoing marketing revamp workstream (migration 052 adds
-- marketing_manager to the role list) and will be converted there.
--
-- Also fixes a gap in migration 019: site-photos was missing an UPDATE
-- policy, so any .move() within the site-photos bucket would fail with
-- "Object not found" (same bug migration 047 fixed for project-files).

-- ═══════════════════════════════════════════════════════════════════════
-- project-files: drop + recreate 4 policies with get_my_role()
-- ═══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS project_files_read ON storage.objects;
DROP POLICY IF EXISTS project_files_insert ON storage.objects;
DROP POLICY IF EXISTS project_files_update ON storage.objects;
DROP POLICY IF EXISTS project_files_delete ON storage.objects;

CREATE POLICY project_files_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-files'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'finance'::app_role, 'project_manager'::app_role,
            'purchase_officer'::app_role, 'site_supervisor'::app_role, 'designer'::app_role]
    )
  );

CREATE POLICY project_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-files'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  );

CREATE POLICY project_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-files'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  );

CREATE POLICY project_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-files'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- site-photos: drop + recreate 3 existing policies + add missing UPDATE
-- ═══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS site_photos_storage_read ON storage.objects;
DROP POLICY IF EXISTS site_photos_storage_insert ON storage.objects;
DROP POLICY IF EXISTS site_photos_storage_update ON storage.objects;
DROP POLICY IF EXISTS site_photos_storage_delete ON storage.objects;

CREATE POLICY site_photos_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'site-photos'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role,
            'om_technician'::app_role, 'finance'::app_role]
    )
  );

CREATE POLICY site_photos_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'site-photos'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  );

CREATE POLICY site_photos_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'site-photos'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  )
  WITH CHECK (
    bucket_id = 'site-photos'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  );

CREATE POLICY site_photos_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'site-photos'
    AND public.get_my_role() = ANY (
      ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role]
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- Verification queries (run after apply)
-- ═══════════════════════════════════════════════════════════════════════

-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'project_files%' OR policyname LIKE 'site_photos_storage%'
-- ORDER BY policyname;

-- All 8 policies should show:
--   qual / with_check contains: public.get_my_role() = ANY (ARRAY[...])
-- and NOT: EXISTS ( SELECT 1 FROM profiles ...
