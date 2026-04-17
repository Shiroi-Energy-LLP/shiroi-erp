-- Migration 072: claim_next_sync_batch RPC for Zoho sync worker
-- Atomically dequeues up to N rows from zoho_sync_queue for a given entity type.
-- The worker calls this, processes the batch, then calls ack_sync_batch to mark done/failed.

CREATE OR REPLACE FUNCTION claim_next_sync_batch(
  p_entity_type  TEXT,
  p_batch_size   INTEGER DEFAULT 50
)
RETURNS TABLE (
  id             UUID,
  entity_type    TEXT,
  entity_id      UUID,
  operation      TEXT,
  payload        JSONB,
  attempt_count  INTEGER,
  created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM   zoho_sync_queue q
    WHERE  q.entity_type = p_entity_type
      AND  q.status      = 'pending'
      AND  (q.retry_after IS NULL OR q.retry_after <= NOW())
    ORDER  BY q.created_at
    LIMIT  p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE zoho_sync_queue q
  SET    status     = 'in_progress',
         claimed_at = NOW()
  FROM   claimed
  WHERE  q.id = claimed.id
  RETURNING
    q.id,
    q.entity_type,
    q.entity_id,
    q.operation,
    q.payload,
    q.attempt_count,
    q.created_at;
END;
$$;

-- Acknowledge a processed batch: mark each row as done or failed
CREATE OR REPLACE FUNCTION ack_sync_batch(
  p_results JSONB  -- array of {id, success, error_message, zoho_id}
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r       JSONB;
  v_id    UUID;
  v_ok    BOOLEAN;
  v_msg   TEXT;
  v_zhid  TEXT;
BEGIN
  FOR r IN SELECT jsonb_array_elements(p_results)
  LOOP
    v_id   := (r->>'id')::UUID;
    v_ok   := (r->>'success')::BOOLEAN;
    v_msg  := r->>'error_message';
    v_zhid := r->>'zoho_id';

    IF v_ok THEN
      UPDATE zoho_sync_queue
      SET    status      = 'done',
             zoho_id     = COALESCE(v_zhid, zoho_id),
             resolved_at = NOW()
      WHERE  id = v_id;
    ELSE
      UPDATE zoho_sync_queue
      SET    status        = CASE WHEN attempt_count + 1 >= max_attempts THEN 'dead' ELSE 'pending' END,
             attempt_count = attempt_count + 1,
             last_error    = v_msg,
             retry_after   = NOW() + INTERVAL '5 minutes' * POWER(2, attempt_count)
      WHERE  id = v_id;
    END IF;
  END LOOP;
END;
$$;

-- Grant execute to authenticated users (finance/founder roles will call via service key from worker)
GRANT EXECUTE ON FUNCTION claim_next_sync_batch(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION ack_sync_batch(JSONB) TO authenticated;

COMMENT ON FUNCTION claim_next_sync_batch IS
  'Atomically claims up to N pending sync queue rows for a given entity type. Uses SKIP LOCKED for concurrent-safe dequeue.';
COMMENT ON FUNCTION ack_sync_batch IS
  'Acknowledges a processed sync batch: marks rows done or increments retry with exponential backoff.';
