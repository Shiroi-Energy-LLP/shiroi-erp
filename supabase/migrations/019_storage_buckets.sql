-- Migration 019: Create missing storage buckets (proposal-files, site-photos)
-- These buckets are referenced in code but were never created in a migration.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Proposal Files storage bucket
-- ────────────────────────────────────────────────────────────
-- Stores proposal attachments and generated PDFs.
-- Path convention: proposal-files/{proposal_id}/{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proposal-files',
  'proposal-files',
  false,
  52428800,  -- 50MB max file size
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for proposal-files
CREATE POLICY "proposal_files_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'proposal-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'sales_engineer', 'project_manager', 'designer')
    )
  );

CREATE POLICY "proposal_files_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'proposal-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'sales_engineer', 'designer')
    )
  );

CREATE POLICY "proposal_files_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'proposal-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'founder'
    )
  );

-- ────────────────────────────────────────────────────────────
-- 2. Site Photos storage bucket
-- ────────────────────────────────────────────────────────────
-- Stores daily report site photos uploaded by site supervisors.
-- Path convention: site-photos/projects/{project_id}/reports/{date}/{timestamp}_{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-photos',
  'site-photos',
  false,
  10485760,  -- 10MB max file size (photos only)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for site-photos
CREATE POLICY "site_photos_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance')
    )
  );

CREATE POLICY "site_photos_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

CREATE POLICY "site_photos_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'founder'
    )
  );

COMMIT;
