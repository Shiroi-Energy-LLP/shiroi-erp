-- Migration 027: Expand project-files bucket allowed mime types
-- ────────────────────────────────────────────────────────────
-- The bucket originally only allowed PDF + images. Project folders in Google Drive
-- also contain DWG, DOCX, XLSX, PPTX, MP4, SketchUp files that need to be synced.
-- The upload UI already accepts these extensions — this aligns the bucket config.

BEGIN;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  -- Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  -- Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  -- CAD
  'application/acad',
  'application/x-autocad',
  'application/dwg',
  'image/vnd.dwg',
  'image/x-dwg',
  'application/dxf',
  -- Video
  'video/mp4',
  'video/quicktime',
  -- SketchUp
  'application/vnd.sketchup.skp',
  'application/octet-stream'
],
file_size_limit = 104857600  -- 100MB (was 50MB) for videos/SketchUp
WHERE id = 'project-files';

COMMIT;
