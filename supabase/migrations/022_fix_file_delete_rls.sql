-- ============================================================
-- Migration 022 — Fix File Delete RLS Policies
-- File: supabase/migrations/022_fix_file_delete_rls.sql
-- Date: 2026-04-07
--
-- Problem: DELETE policies on project-files and site-photos
--          storage buckets only allow 'founder' role. PMs and
--          site supervisors cannot delete files they uploaded.
--
-- Fix: Expand DELETE policies to include project_manager and
--      site_supervisor roles (same as INSERT policy).
-- ============================================================

BEGIN;

-- ── Fix project-files DELETE policy ─────────────────────────
DROP POLICY IF EXISTS "project_files_delete" ON storage.objects;

CREATE POLICY "project_files_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

-- ── Fix site-photos DELETE policy ───────────────────────────
DROP POLICY IF EXISTS "site_photos_storage_delete" ON storage.objects;

CREATE POLICY "site_photos_storage_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

COMMIT;
