-- ============================================================================
-- Migration 110 — backfill leads.drive_folder_id + drive_folder_url from notes
-- Date: 2026-05-03
-- Why: The 2026-04-03 Drive→DB migration (1,074 leads on dev) wrote Drive
--      folder URLs into `leads.notes` as bracketed strings. Now that we have
--      structured `drive_folder_id` + `drive_folder_url` columns (mig 109),
--      extract the IDs out of notes so every historical lead's Drive folder
--      is one click away on /sales/[id].
--
--      Idempotent: skips leads that already have drive_folder_id set.
--      Non-destructive: notes are left intact (don't break anything that
--      grep-searches for the URL pattern).
--
-- Spec: docs/superpowers/specs/2026-05-02-documents-drive-lifecycle-design.md
-- ============================================================================

UPDATE public.leads
SET
  drive_folder_id  = substring(notes from 'drive\.google\.com/drive/folders/([a-zA-Z0-9_-]+)'),
  drive_folder_url = 'https://drive.google.com/drive/folders/' ||
                     substring(notes from 'drive\.google\.com/drive/folders/([a-zA-Z0-9_-]+)')
WHERE notes ~ 'drive\.google\.com/drive/folders/[a-zA-Z0-9_-]+'
  AND drive_folder_id IS NULL
  AND deleted_at IS NULL;
