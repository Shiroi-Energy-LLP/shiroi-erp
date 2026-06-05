-- Migration 158: Convert rag_query_log to declarative range partitioning by created_at (month).
--
-- WHY:
--   rag_query_log is a time-series log of every RAG query (one row per question).
--   Per the Shiroi master reference §4 ("Time-series data uses declarative partitioning
--   from day 1"), this table must be partitioned by created_at month. The original
--   table in migration 138 was created as a normal table; this migration converts it
--   in-place via the rename-swap pattern.
--
-- STRATEGY:
--   1. Build rag_query_log_new with LIKE ... INCLUDING ALL EXCLUDING CONSTRAINTS EXCLUDING INDEXES
--   2. Partition BY RANGE (created_at). PK rebuilt as (id, created_at) — partition key
--      must be part of every UNIQUE constraint, so created_at joins the PK.
--   3. Create monthly partitions covering current month + next 3 months, plus a default
--      partition to catch out-of-range inserts (including any past data if backfilled).
--   4. Copy data: source is empty today (verified: 0 rows pre-migration), so the INSERT
--      is a no-op, but we keep the statement for correctness if this migration is ever
--      replayed on a non-empty replica.
--   5. Rename original to *_unpartitioned_backup, rename new into place.
--   6. Re-add FK to profiles, secondary index, RLS policies, ENABLE RLS.
--
-- ROLLBACK (manual, if verification fails before deploy):
--   ALTER TABLE rag_query_log RENAME TO rag_query_log_failed;
--   ALTER TABLE rag_query_log_unpartitioned_backup RENAME TO rag_query_log;
--
-- TODO (pg_cron — deferred to a later migration):
--   Schedule monthly partition auto-creation. Sketch:
--     SELECT cron.schedule(
--       'rag_query_log_create_next_partition',
--       '0 0 25 * *',  -- 25th of each month, create partition for next month
--       $$
--         DO $do$
--         DECLARE
--           next_month DATE := date_trunc('month', now()) + INTERVAL '1 month';
--           part_name TEXT := 'rag_query_log_y' || to_char(next_month, 'YYYY') || 'm' || to_char(next_month, 'MM');
--           start_ts TEXT := to_char(next_month, 'YYYY-MM-DD');
--           end_ts   TEXT := to_char(next_month + INTERVAL '1 month', 'YYYY-MM-DD');
--         BEGIN
--           EXECUTE format(
--             'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.rag_query_log FOR VALUES FROM (%L) TO (%L)',
--             part_name, start_ts, end_ts
--           );
--         END
--         $do$;
--       $$
--     );
--   pg_cron must be enabled in the postgres extension list (it already is on dev).

BEGIN;

-- 1. New partitioned table — same shape, no constraints/indexes yet.
CREATE TABLE public.rag_query_log_new (
  LIKE public.rag_query_log INCLUDING ALL EXCLUDING CONSTRAINTS EXCLUDING INDEXES
) PARTITION BY RANGE (created_at);

-- Primary key — must include the partition key column. Uses a temporary name to
-- avoid collision with the original table's rag_query_log_pkey (Postgres does not
-- rename indexes/constraints automatically when ALTER TABLE ... RENAME TO is run).
-- Renamed to rag_query_log_pkey after the swap below.
ALTER TABLE public.rag_query_log_new
  ADD CONSTRAINT rag_query_log_new_pkey PRIMARY KEY (id, created_at);

-- 2. Monthly partitions: current month (Jun 2026) + next 3 months (Jul/Aug/Sep 2026).
--    Source table is empty (0 rows verified pre-migration on 2026-06-05), so no
--    historical partitions are required. Default partition catches any out-of-range
--    inserts (including backfill if it ever occurs).
CREATE TABLE public.rag_query_log_y2026m06 PARTITION OF public.rag_query_log_new
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE public.rag_query_log_y2026m07 PARTITION OF public.rag_query_log_new
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE public.rag_query_log_y2026m08 PARTITION OF public.rag_query_log_new
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE public.rag_query_log_y2026m09 PARTITION OF public.rag_query_log_new
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE public.rag_query_log_default PARTITION OF public.rag_query_log_new DEFAULT;

-- 3. Copy any existing data (empty today, but safe to run).
INSERT INTO public.rag_query_log_new
SELECT * FROM public.rag_query_log;

-- 4. Swap names. After this, *_unpartitioned_backup can be dropped once the new
--    table is verified in production. Keep it around for now as a safety net.
--    Index/constraint names do not follow ALTER TABLE ... RENAME TO; rename both
--    the backup's pkey AND its secondary index to free the canonical names.
ALTER INDEX public.rag_query_log_pkey RENAME TO rag_query_log_unpartitioned_backup_pkey;
ALTER INDEX public.idx_rag_query_log_caller RENAME TO idx_rag_query_log_unpartitioned_backup_caller;
ALTER TABLE public.rag_query_log RENAME TO rag_query_log_unpartitioned_backup;
ALTER TABLE public.rag_query_log_new RENAME TO rag_query_log;
ALTER INDEX public.rag_query_log_new_pkey RENAME TO rag_query_log_pkey;

-- 5. Foreign key — caller_id references profiles(id), recreated post-swap.
ALTER TABLE public.rag_query_log
  ADD CONSTRAINT rag_query_log_caller_id_fkey
  FOREIGN KEY (caller_id) REFERENCES public.profiles(id);

-- 6. Secondary index — caller-scoped time-series lookups (matches original definition).
--    The PK provides the (id, created_at) index automatically.
CREATE INDEX idx_rag_query_log_caller
  ON public.rag_query_log USING btree (caller_id, created_at DESC);

-- 7. RLS — re-enable and recreate the two policies from the original table.
ALTER TABLE public.rag_query_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_query_log_own_read ON public.rag_query_log
  FOR SELECT
  TO authenticated
  USING ((caller_id = auth.uid()) OR (get_my_role() = 'founder'::app_role));

CREATE POLICY rag_query_log_service_write ON public.rag_query_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 8. No triggers existed on the original table — created_at uses DEFAULT now() and
--    there is no updated_at column, so no trigger re-creation is required.

-- 9. Documentation comment.
COMMENT ON TABLE public.rag_query_log IS
  'RAG query log. Declaratively partitioned by RANGE(created_at) — one partition per calendar month. '
  'Partitions are named rag_query_log_yYYYYmMM. A default partition catches out-of-range inserts. '
  'TODO: schedule monthly partition auto-creation via pg_cron (see migration header for sketch).';

COMMIT;
