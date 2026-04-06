-- Migration 013: Proposal files storage bucket
-- Already applied to dev. Documenting here as source of truth.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proposal-files',
  'proposal-files',
  false,
  52428800,  -- 50MB max file size
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/msword',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/tiff',
    'application/acad',
    'application/x-acad',
    'application/dwg',
    'image/vnd.dwg',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "proposal_files_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'proposal-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'finance', 'sales_engineer', 'designer', 'project_manager', 'purchase_officer')
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
