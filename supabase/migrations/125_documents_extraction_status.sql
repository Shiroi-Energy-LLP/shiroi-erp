-- Migration 125: Documents AI extraction status columns
-- Adds extracted_at and extraction_status to documents table
-- so process-document edge function can track idempotent extraction state.

BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_status TEXT
    CHECK (extraction_status IN ('pending', 'processing', 'done', 'failed', 'skipped'));

-- Index on extraction_status so the backfill script can efficiently
-- query WHERE extraction_status IS NULL OR extraction_status = 'pending'
CREATE INDEX IF NOT EXISTS idx_documents_extraction_status
  ON documents (extraction_status)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN documents.extracted_at IS
  'When text extraction + embedding was last successfully completed.';
COMMENT ON COLUMN documents.extraction_status IS
  'Extraction pipeline state: pending → processing → done/failed/skipped. NULL = not yet queued.';

COMMIT;
