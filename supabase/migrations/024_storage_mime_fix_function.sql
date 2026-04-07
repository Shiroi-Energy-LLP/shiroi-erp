-- Migration 024: Create helper function to fix storage object mime types
-- Applied: 2026-04-07
-- Purpose: The fix-octet-stream script needs to update storage.objects metadata
--   which isn't accessible via the REST API. This function allows updating
--   the mimetype in the metadata JSONB column.

CREATE OR REPLACE FUNCTION update_storage_mime_type(
  p_bucket TEXT,
  p_path TEXT,
  p_mime TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE storage.objects
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{mimetype}',
    to_jsonb(p_mime)
  )
  WHERE bucket_id = p_bucket
    AND name = p_path;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (script runs with service_role key)
GRANT EXECUTE ON FUNCTION update_storage_mime_type(TEXT, TEXT, TEXT) TO service_role;
