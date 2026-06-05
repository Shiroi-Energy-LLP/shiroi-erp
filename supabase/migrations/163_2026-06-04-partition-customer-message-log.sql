-- Migration 158: Convert customer_message_log to declarative range partitioning by created_at (month).
--
-- WHY:
--   customer_message_log (mig 129) is the destination for the 8 customer drip
--   workflows (n8n 40-47, currently pending Meta template approval). Per the
--   Shiroi master reference §4 ("Time-series data uses declarative partitioning
--   from day 1"), this table must be partitioned by created_at month BEFORE the
--   drips activate; once a steady stream of WhatsApp send events lands here it
--   becomes painful to convert in-place.
--
-- STRATEGY (same pattern as mig 158/rag_query_log):
--   1. Build customer_message_log_new with LIKE ... INCLUDING ALL EXCLUDING
--      CONSTRAINTS EXCLUDING INDEXES.
--   2. Partition BY RANGE (created_at). PK rebuilt as (id, created_at) — the
--      partition key must be part of every UNIQUE constraint, so created_at
--      joins the PK.
--   3. Create monthly partitions covering current month + next 3 months, plus
--      a DEFAULT partition for out-of-range inserts (also catches any backfill).
--   4. Copy data: source is empty (0 rows verified pre-migration on 2026-06-05),
--      so the INSERT is a no-op; retained for correctness on replicas/replays.
--   5. Rename original to *_unpartitioned_backup, rename new into place.
--   6. Re-add FKs (project_id, lead_id), CHECK on status, secondary indexes,
--      RLS policies (from mig 134), ENABLE RLS.
--
-- ROLLBACK (manual, if verification fails before deploy):
--   ALTER TABLE customer_message_log RENAME TO customer_message_log_failed;
--   ALTER TABLE customer_message_log_unpartitioned_backup RENAME TO customer_message_log;
--
-- TODO (pg_cron — deferred to a later migration, mirrors rag_query_log sketch):
--   SELECT cron.schedule(
--     'customer_message_log_create_next_partition',
--     '0 0 25 * *',  -- 25th of each month, create partition for next month
--     $$
--       DO $do$
--       DECLARE
--         next_month DATE := date_trunc('month', now()) + INTERVAL '1 month';
--         part_name TEXT := 'customer_message_log_y' || to_char(next_month, 'YYYY') || 'm' || to_char(next_month, 'MM');
--         start_ts TEXT := to_char(next_month, 'YYYY-MM-DD');
--         end_ts   TEXT := to_char(next_month + INTERVAL '1 month', 'YYYY-MM-DD');
--       BEGIN
--         EXECUTE format(
--           'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.customer_message_log FOR VALUES FROM (%L) TO (%L)',
--           part_name, start_ts, end_ts
--         );
--       END
--       $do$;
--     $$
--   );

BEGIN;

-- 1. New partitioned table — same shape, no constraints/indexes yet.
CREATE TABLE public.customer_message_log_new (
  LIKE public.customer_message_log INCLUDING ALL EXCLUDING CONSTRAINTS EXCLUDING INDEXES
) PARTITION BY RANGE (created_at);

-- Primary key — must include the partition key column.
-- Built under a temp constraint name to avoid colliding with the original
-- table's customer_message_log_pkey; renamed post-swap (see step 5b).
ALTER TABLE public.customer_message_log_new
  ADD CONSTRAINT customer_message_log_new_pkey PRIMARY KEY (id, created_at);

-- created_at must be NOT NULL for partition routing. The original table had
-- created_at TIMESTAMPTZ DEFAULT NOW() but nullable; tighten on the new table.
ALTER TABLE public.customer_message_log_new
  ALTER COLUMN created_at SET NOT NULL;

-- CHECK constraint on status — recreated explicitly under a temp name; renamed
-- post-swap. The original table still holds customer_message_log_status_check
-- until the rename.
ALTER TABLE public.customer_message_log_new
  ADD CONSTRAINT customer_message_log_new_status_check
  CHECK (status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text]));

-- 2. Monthly partitions: current month (Jun 2026) + next 3 months (Jul/Aug/Sep 2026).
--    Source table is empty (0 rows verified pre-migration on 2026-06-05), so no
--    historical partitions are required. Default partition catches any out-of-range
--    inserts (including backfill if it ever occurs).
CREATE TABLE public.customer_message_log_y2026m06 PARTITION OF public.customer_message_log_new
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE public.customer_message_log_y2026m07 PARTITION OF public.customer_message_log_new
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE public.customer_message_log_y2026m08 PARTITION OF public.customer_message_log_new
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE public.customer_message_log_y2026m09 PARTITION OF public.customer_message_log_new
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE public.customer_message_log_default PARTITION OF public.customer_message_log_new DEFAULT;

-- 3. Copy any existing data (empty today, but safe to run on replicas/replays).
INSERT INTO public.customer_message_log_new
SELECT * FROM public.customer_message_log;

-- 4. Swap names. After this, *_unpartitioned_backup can be dropped once the new
--    table is verified in production. Keep it around for now as a safety net.
ALTER TABLE public.customer_message_log RENAME TO customer_message_log_unpartitioned_backup;
ALTER TABLE public.customer_message_log_new RENAME TO customer_message_log;

-- 5a. Rename the backup's PK, CHECK, and FKs to free the canonical names, then
--     promote the new table's temp constraint names to canonical. Constraint
--     names share a per-namespace identity for some kinds (PK/CHECK/FK), so we
--     rename rather than drop — the backup keeps full schema fidelity.
ALTER TABLE public.customer_message_log_unpartitioned_backup
  RENAME CONSTRAINT customer_message_log_pkey TO customer_message_log_backup_pkey;
ALTER TABLE public.customer_message_log_unpartitioned_backup
  RENAME CONSTRAINT customer_message_log_status_check TO customer_message_log_backup_status_check;
ALTER TABLE public.customer_message_log_unpartitioned_backup
  RENAME CONSTRAINT customer_message_log_project_id_fkey TO customer_message_log_backup_project_id_fkey;
ALTER TABLE public.customer_message_log_unpartitioned_backup
  RENAME CONSTRAINT customer_message_log_lead_id_fkey TO customer_message_log_backup_lead_id_fkey;

ALTER TABLE public.customer_message_log
  RENAME CONSTRAINT customer_message_log_new_pkey TO customer_message_log_pkey;
ALTER TABLE public.customer_message_log
  RENAME CONSTRAINT customer_message_log_new_status_check TO customer_message_log_status_check;

-- Free up the canonical secondary index names by renaming the backup's copies
-- (they would otherwise collide when we recreate idx_customer_msg_log_* below).
ALTER INDEX public.idx_customer_msg_log_project
  RENAME TO idx_customer_msg_log_backup_project;
ALTER INDEX public.idx_customer_msg_log_meta_wamid
  RENAME TO idx_customer_msg_log_backup_meta_wamid;
ALTER INDEX public.idx_customer_msg_log_status
  RENAME TO idx_customer_msg_log_backup_status;

-- 5b. Foreign keys — recreated post-swap (LIKE ... EXCLUDING CONSTRAINTS dropped them).
ALTER TABLE public.customer_message_log
  ADD CONSTRAINT customer_message_log_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id);

ALTER TABLE public.customer_message_log
  ADD CONSTRAINT customer_message_log_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id);

-- 6. Secondary indexes (mirror mig 129).
--    The PK already covers (id, created_at). These three add the lookup paths
--    used by the n8n drips and the digest dashboards.
CREATE INDEX idx_customer_msg_log_project
  ON public.customer_message_log USING btree (project_id);

CREATE INDEX idx_customer_msg_log_meta_wamid
  ON public.customer_message_log USING btree (meta_wamid);

CREATE INDEX idx_customer_msg_log_status
  ON public.customer_message_log USING btree (status, created_at);

-- 7. RLS — re-enable and recreate the two policies from mig 134 (review-fixes).
ALTER TABLE public.customer_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_message_log_select ON public.customer_message_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'marketing_manager', 'om_technician')
    )
  );

-- Inserts come from the service role (n8n, edge functions); deny authenticated.
CREATE POLICY customer_message_log_service_only_write ON public.customer_message_log
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- 8. No triggers existed on the original table (verified pre-migration) and
--    created_at uses DEFAULT now() with no updated_at column, so no trigger
--    re-creation is required.

-- 9. Documentation comment.
COMMENT ON TABLE public.customer_message_log IS
  'Outbound customer WhatsApp template message log (Meta API). Pairs with n8n '
  'workflows 40-47 (F1 customer drip sequences). Declaratively partitioned by '
  'RANGE(created_at) — one partition per calendar month. Partitions are named '
  'customer_message_log_yYYYYmMM. A default partition catches out-of-range '
  'inserts. TODO: schedule monthly partition auto-creation via pg_cron (see '
  'migration header for sketch).';

COMMIT;
