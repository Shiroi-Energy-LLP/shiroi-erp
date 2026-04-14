-- ============================================================
-- Migration 047 — Add UPDATE RLS policy for project-files bucket
-- File: supabase/migrations/047_project_files_update_rls.sql
-- Date: 2026-04-14
--
-- Problem:
--   Drag-and-drop file recategorization on the project detail
--   Documents tab fails with "Move failed - Object not found".
--
-- Root cause:
--   Supabase Storage `.move(from, to)` is implemented as an
--   UPDATE on storage.objects (it rewrites the `name` column).
--   Migration 010 created project_files_read (SELECT),
--   project_files_insert (INSERT), and project_files_delete
--   (DELETE) policies — but NO UPDATE policy. With RLS enabled
--   and no UPDATE policy, every UPDATE is denied. The Storage
--   API surfaces this denial as "Object not found" because the
--   row appears invisible to the post-update visibility check.
--
-- Fix:
--   Add project_files_update policy mirroring project_files_insert
--   (founder, project_manager, site_supervisor). This unblocks
--   drag-and-drop recategorization and any future rename/move
--   workflows on the project-files bucket.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "project_files_update" ON storage.objects;

CREATE POLICY "project_files_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

COMMIT;
