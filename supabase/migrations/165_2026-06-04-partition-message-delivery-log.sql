-- Migration 159: Convert message_delivery_log to declarative range partitioning by created_at (month).
--
-- WHY:
--   message_delivery_log (mig 007c) is the audit trail for every WhatsApp message sent via
--   the n8n employee-forward path (Phase 1) or direct API (Phase 2). One row per outbound
--   message. Per the Shiroi master reference §4 ("Time-series data uses declarative
--   partitioning from day 1"), this table must be partitioned by created_at month —
--   every outbound WhatsApp logs here, so volume will grow quickly once campaigns and
--   drip sequences ramp.
--
-- STRATEGY:
--   1. Build message_delivery_log_new with LIKE ... INCLUDING ALL EXCLUDING CONSTRAINTS
--      EXCLUDING INDEXES.
--   2. Partition BY RANGE (created_at). PK rebuilt as (id, created_at) — partition key
--      must be part of every UNIQUE constraint, so created_at joins the PK.
--   3. Create monthly partitions covering current month + next 3 months, plus a default
--      partition to catch out-of-range inserts (including any past data if backfilled).
--   4. Copy data: source is empty today (verified: 0 rows pre-migration on 2026-06-05),
--      so the INSERT is a no-op, but we keep the statement for correctness if this
--      migration is ever replayed on a non-empty replica.
--   5. Rename original to *_unpartitioned_backup, rename new into place.
--   6. Re-add FKs, CHECK constraints, secondary indexes, RLS policies, ENABLE RLS.
--
-- ROLLBACK (manual, if verification fails before deploy):
--   ALTER TABLE message_delivery_log RENAME TO message_delivery_log_failed;
--   ALTER TABLE message_delivery_log_unpartitioned_backup RENAME TO message_delivery_log;
--
-- TODO (pg_cron — deferred to a later migration):
--   Schedule monthly partition auto-creation. Sketch:
--     SELECT cron.schedule(
--       'message_delivery_log_create_next_partition',
--       '0 0 25 * *',  -- 25th of each month, create partition for next month
--       $$
--         DO $do$
--         DECLARE
--           next_month DATE := date_trunc('month', now()) + INTERVAL '1 month';
--           part_name TEXT := 'message_delivery_log_y' || to_char(next_month, 'YYYY') || 'm' || to_char(next_month, 'MM');
--           start_ts TEXT := to_char(next_month, 'YYYY-MM-DD');
--           end_ts   TEXT := to_char(next_month + INTERVAL '1 month', 'YYYY-MM-DD');
--         BEGIN
--           EXECUTE format(
--             'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.message_delivery_log FOR VALUES FROM (%L) TO (%L)',
--             part_name, start_ts, end_ts
--           );
--         END
--         $do$;
--       $$
--     );
--   pg_cron must be enabled in the postgres extension list (it already is on dev).

BEGIN;

-- 1. New partitioned table — same shape, no constraints/indexes yet.
--    Note: the PK is added with a temporary name (message_delivery_log_new_pkey) to
--    avoid colliding with the original table's PK constraint (constraint names are
--    schema-scoped, and `ALTER TABLE ... RENAME` does NOT rename dependent constraints,
--    so the backup table will continue to own `message_delivery_log_pkey` after the
--    swap below). We rename the constraint back to the canonical name after we've
--    freed it up by renaming the backup's PK.
CREATE TABLE public.message_delivery_log_new (
  LIKE public.message_delivery_log INCLUDING ALL EXCLUDING CONSTRAINTS EXCLUDING INDEXES
) PARTITION BY RANGE (created_at);

-- Primary key — must include the partition key column. Temp name to avoid collision.
ALTER TABLE public.message_delivery_log_new
  ADD CONSTRAINT message_delivery_log_new_pkey PRIMARY KEY (id, created_at);

-- 2. Monthly partitions: current month (Jun 2026) + next 3 months (Jul/Aug/Sep 2026).
--    Source table is empty (0 rows verified pre-migration on 2026-06-05), so no
--    historical partitions are required. Default partition catches any out-of-range
--    inserts (including backfill if it ever occurs).
CREATE TABLE public.message_delivery_log_y2026m06 PARTITION OF public.message_delivery_log_new
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE public.message_delivery_log_y2026m07 PARTITION OF public.message_delivery_log_new
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE public.message_delivery_log_y2026m08 PARTITION OF public.message_delivery_log_new
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE public.message_delivery_log_y2026m09 PARTITION OF public.message_delivery_log_new
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE public.message_delivery_log_default PARTITION OF public.message_delivery_log_new DEFAULT;

-- 3. Copy any existing data (empty today, but safe to run).
INSERT INTO public.message_delivery_log_new
SELECT * FROM public.message_delivery_log;

-- 4. Swap names. After this, *_unpartitioned_backup can be dropped once the new
--    table is verified in production. Keep it around for now as a safety net.
ALTER TABLE public.message_delivery_log RENAME TO message_delivery_log_unpartitioned_backup;
ALTER TABLE public.message_delivery_log_new RENAME TO message_delivery_log;

-- 4a. Rename PK + secondary indexes on the backup so the new (now-canonical) table
--     can own the canonical names. ALTER TABLE RENAME above doesn't rename dependent
--     indexes; index names are schema-scoped, so without this the CREATE INDEX
--     statements below would collide.
ALTER INDEX public.message_delivery_log_pkey       RENAME TO message_delivery_log_unpartitioned_backup_pkey;
ALTER INDEX public.idx_msg_log_entity              RENAME TO idx_msg_log_entity_unpartitioned_backup;
ALTER INDEX public.idx_msg_log_employee            RENAME TO idx_msg_log_employee_unpartitioned_backup;
ALTER INDEX public.idx_msg_log_unforwarded         RENAME TO idx_msg_log_unforwarded_unpartitioned_backup;
ALTER INDEX public.idx_msg_log_date                RENAME TO idx_msg_log_date_unpartitioned_backup;
ALTER INDEX public.idx_msg_log_campaign            RENAME TO idx_msg_log_campaign_unpartitioned_backup;
ALTER INDEX public.idx_msg_log_drip                RENAME TO idx_msg_log_drip_unpartitioned_backup;

-- Rename the new table's PK (currently message_delivery_log_new_pkey) to the canonical name.
ALTER INDEX public.message_delivery_log_new_pkey RENAME TO message_delivery_log_pkey;

-- 4b. Rename constraints on the backup so the canonical names are free for the new table.
--     CHECK/FK constraint names are schema-scoped and ALTER TABLE RENAME doesn't touch them.
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_campaign_delivery_id_fkey TO message_delivery_log_ub_campaign_delivery_id_fkey;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_campaign_id_fkey TO message_delivery_log_ub_campaign_id_fkey;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_drip_sequence_id_fkey TO message_delivery_log_ub_drip_sequence_id_fkey;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_drip_step_id_fkey TO message_delivery_log_ub_drip_step_id_fkey;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_enrollment_id_fkey TO message_delivery_log_ub_enrollment_id_fkey;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_sent_to_employee_id_fkey TO message_delivery_log_ub_sent_to_employee_id_fkey;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_entity_type_check TO message_delivery_log_ub_entity_type_check;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_delivery_method_check TO message_delivery_log_ub_delivery_method_check;
ALTER TABLE public.message_delivery_log_unpartitioned_backup
  RENAME CONSTRAINT message_delivery_log_n8n_delivery_status_check TO message_delivery_log_ub_n8n_delivery_status_check;

-- 5. Foreign keys — recreated post-swap (LIKE ... EXCLUDING CONSTRAINTS dropped them).
ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_campaign_delivery_id_fkey
  FOREIGN KEY (campaign_delivery_id) REFERENCES public.marketing_campaign_deliveries(id);

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id);

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_drip_sequence_id_fkey
  FOREIGN KEY (drip_sequence_id) REFERENCES public.drip_sequences(id);

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_drip_step_id_fkey
  FOREIGN KEY (drip_step_id) REFERENCES public.drip_sequence_steps(id);

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_enrollment_id_fkey
  FOREIGN KEY (enrollment_id) REFERENCES public.drip_sequence_enrollments(id);

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_sent_to_employee_id_fkey
  FOREIGN KEY (sent_to_employee_id) REFERENCES public.employees(id);

-- 6. CHECK constraints — recreated to match the original definition.
ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY['lead'::text, 'project'::text, 'om_contract'::text, 'campaign'::text, 'drip_sequence'::text]));

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_delivery_method_check
  CHECK (delivery_method = ANY (ARRAY['employee_forward'::text, 'direct_api'::text]));

ALTER TABLE public.message_delivery_log
  ADD CONSTRAINT message_delivery_log_n8n_delivery_status_check
  CHECK (n8n_delivery_status = ANY (ARRAY['sent'::text, 'delivered'::text, 'failed'::text]));

-- 7. Secondary indexes — recreated to match the original definitions.
--    The PK provides the (id, created_at) index automatically.
CREATE INDEX idx_msg_log_entity
  ON public.message_delivery_log USING btree (entity_type, entity_id);

CREATE INDEX idx_msg_log_employee
  ON public.message_delivery_log USING btree (sent_to_employee_id);

CREATE INDEX idx_msg_log_unforwarded
  ON public.message_delivery_log USING btree (employee_forwarded)
  WHERE employee_forwarded = false AND delivery_method = 'employee_forward'::text;

CREATE INDEX idx_msg_log_date
  ON public.message_delivery_log USING btree (n8n_sent_at DESC);

CREATE INDEX idx_msg_log_campaign
  ON public.message_delivery_log USING btree (campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX idx_msg_log_drip
  ON public.message_delivery_log USING btree (drip_sequence_id)
  WHERE drip_sequence_id IS NOT NULL;

-- 8. RLS — re-enable and recreate the two policies from the original table.
ALTER TABLE public.message_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY msg_log_read ON public.message_delivery_log
  FOR SELECT
  USING (
    (get_my_role() = ANY (ARRAY['founder'::app_role, 'sales_engineer'::app_role, 'project_manager'::app_role]))
    OR (sent_to_employee_id = get_my_employee_id())
  );

CREATE POLICY msg_log_insert ON public.message_delivery_log
  FOR INSERT
  WITH CHECK (
    (SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid())
      = ANY (ARRAY['founder'::app_role, 'sales_engineer'::app_role, 'project_manager'::app_role])
  );

-- 9. No triggers existed on the original table — created_at uses DEFAULT now() and the
--    table is immutable (no updated_at column), so no trigger re-creation is required.

-- 10. Documentation comment.
COMMENT ON TABLE public.message_delivery_log IS
  'WhatsApp delivery audit trail (mig 007c). Declaratively partitioned by RANGE(created_at) '
  '— one partition per calendar month. Partitions are named message_delivery_log_yYYYYmMM. '
  'A default partition catches out-of-range inserts. Every outbound WhatsApp logs here '
  '(employee forward + direct API), so volume will grow quickly once campaigns and drip '
  'sequences ramp. TODO: schedule monthly partition auto-creation via pg_cron (see '
  'migration header for sketch).';

COMMIT;
