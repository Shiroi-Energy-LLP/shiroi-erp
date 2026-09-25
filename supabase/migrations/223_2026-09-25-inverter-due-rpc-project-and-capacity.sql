-- ═══════════════════════════════════════════════════════════════════════
-- Migration 223 — get_inverters_due_for_poll() gains project_id, rated_capacity_kw,
--                 last_poll_at
-- Date: 2026-09-25
-- Module: O&M (plant monitoring)
--
-- WHY
-- ---
-- The `inverter-poll` Edge Function bypassed this RPC and hand-rolled its due
-- filter in PostgREST because the RPC did not expose `project_id` or
-- `rated_capacity_kw` (both required to write `inverter_readings` rows and to
-- generate synthetic readings). PostgREST cannot compare two columns in a
-- filter, so the hand-rolled version hardcoded a 5-minute staleness threshold:
--
--   .or('last_poll_at.is.null,last_poll_at.lt.' + <now - 5 min>)
--
-- Consequences, measured 2026-09-25 (see
-- docs/reviews/2026-09-25-inverter-poll-522-alert-flood.md §5):
--   1. `inverters.polling_interval_minutes` was dead configuration — changing
--      it had no effect on when an inverter was actually polled.
--   2. The cron fires every 5 min and the threshold was also 5 min, so whenever
--      the fleet was swept in a single cycle the *next* cycle found nothing due
--      and returned `processed: 0` in ~1.6 s. Real cadence was 10 min, not the
--      5 min the file header advertised.
--
-- Adding the two columns here lets the function call the RPC, which does the
-- per-inverter `last_poll_at + polling_interval_minutes < NOW()` comparison in
-- SQL where it belongs.
--
-- Ordering (`last_poll_at ASC NULLS FIRST`) is unchanged and load-bearing: the
-- Edge Function's POLL_BUDGET_MS deferral relies on deferred inverters keeping
-- their old `last_poll_at` and therefore sorting first on the next cycle.
--
-- DROP + CREATE (not CREATE OR REPLACE) because the RETURNS TABLE signature
-- changes. Re-applies `SET search_path = public, pg_temp` from migration 141.
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_inverters_due_for_poll(INT);

CREATE FUNCTION get_inverters_due_for_poll(batch_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  monitoring_site_id TEXT,
  monitoring_device_id TEXT,
  monitoring_credentials_id UUID,
  polling_interval_minutes SMALLINT,
  last_poll_at TIMESTAMPTZ,
  last_reading_at TIMESTAMPTZ,
  rated_capacity_kw NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    i.id,
    i.project_id,
    i.brand,
    i.model,
    i.serial_number,
    i.monitoring_site_id,
    i.monitoring_device_id,
    i.monitoring_credentials_id,
    i.polling_interval_minutes,
    i.last_poll_at,
    i.last_reading_at,
    i.rated_capacity_kw
  FROM inverters i
  WHERE i.polling_enabled = true
    AND i.current_status != 'decommissioned'
    AND (
      i.last_poll_at IS NULL
      OR i.last_poll_at < NOW() - (i.polling_interval_minutes || ' minutes')::interval
    )
  ORDER BY i.last_poll_at ASC NULLS FIRST
  LIMIT batch_limit;
$$;

COMMENT ON FUNCTION get_inverters_due_for_poll(INT) IS
  'Returns inverters whose next read is due (last_poll_at + polling_interval_minutes < NOW). Called by the inverter-poll Edge Function every 5 minutes. Ordered by last_poll_at ASC NULLS FIRST so the longest-overdue inverters — including those the poller deferred when it hit POLL_BUDGET_MS — are polled first. Batch limit protects against runaway scans. project_id + rated_capacity_kw added in migration 223 so the poller no longer has to hand-roll the due filter (PostgREST cannot compare two columns).';

-- ═══════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════
--   SELECT id, project_id, rated_capacity_kw, polling_interval_minutes,
--          last_poll_at, last_reading_at
--     FROM get_inverters_due_for_poll(100);
--   -- must return 12 columns; compare its row count against:
--   SELECT count(*) FROM inverters
--     WHERE polling_enabled AND current_status <> 'decommissioned'
--       AND (last_poll_at IS NULL
--            OR last_poll_at < NOW() - (polling_interval_minutes || ' minutes')::interval);
