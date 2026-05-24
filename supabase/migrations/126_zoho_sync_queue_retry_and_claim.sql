-- Migration 126: Zoho sync queue — add claimed_at for n8n idempotent polling
-- The n8n 15-minute workflow needs claimed_at to atomically claim rows
-- and processed_at to track completion.

BEGIN;

ALTER TABLE zoho_sync_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Index for the n8n poll query: WHERE claimed_at IS NULL LIMIT 50
CREATE INDEX IF NOT EXISTS idx_zoho_sync_queue_unclaimed
  ON zoho_sync_queue (created_at)
  WHERE claimed_at IS NULL;

COMMENT ON COLUMN zoho_sync_queue.claimed_at IS
  'Set atomically by n8n when it picks up the row. NULL = unclaimed.';
COMMENT ON COLUMN zoho_sync_queue.processed_at IS
  'Set by n8n after Zoho API call succeeds.';
COMMENT ON COLUMN zoho_sync_queue.retry_count IS
  'Number of retry attempts. Incremented on each failed attempt.';

COMMIT;
