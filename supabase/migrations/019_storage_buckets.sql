-- Migration 019: Create site-photos storage bucket
-- proposal-files bucket already existed from migration 013 (applied manually).
-- This migration only creates the site-photos bucket + RLS policies.

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
CREATE POLICY "site_photos_storage_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance')
    )
  );

CREATE POLICY "site_photos_storage_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );

CREATE POLICY "site_photos_storage_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'site-photos'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'founder'
    )
  );
