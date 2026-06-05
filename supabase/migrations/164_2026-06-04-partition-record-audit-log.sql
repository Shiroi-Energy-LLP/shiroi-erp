-- Migration 159: Convert record_audit_log to declarative range partitioning by changed_at (month).
--
-- WHY:
--   record_audit_log is the universal Tier 3 audit log for all Tier 1 edits across the
--   ERP (lead status, proposal status, project status, financial mutations, etc.).
--   Per migration 006c it is "Immutable forever, never deleted" — which makes it the
--   classic time-series append-only workload the master reference (§4) requires to be
--   declaratively partitioned from day 1. Original 006c created it as a normal table;
--   this migration converts it in-place via the rename-swap pattern.
--
--   NOTE on partition key: 006c uses `changed_at` (TIMESTAMPTZ DEFAULT NOW()) as the
--   row-time column. There is no `created_at` on this table. Partitioning by
--   `changed_at` is the natural choice — every secondary index already orders by it.
--
-- STRATEGY:
--   1. Build record_audit_log_new with LIKE ... INCLUDING ALL EXCLUDING CONSTRAINTS EXCLUDING INDEXES.
--   2. Partition BY RANGE (changed_at). PK rebuilt as (id, changed_at) — Postgres
--      requires the partition key to be part of every UNIQUE constraint.
--   3. Create monthly partitions covering current month (Jun 2026) + next 3 months,
--      plus a default partition to catch out-of-range inserts (incl. any backfill).
--      Source table is empty (0 rows verified 2026-06-05), so no historical partitions
--      are required.
--   4. Copy data — currently a no-op (0 rows), but kept for replay safety.
--   5. VERIFY count match before swap (RAISE EXCEPTION if mismatch — auto-rollback).
--   6. Rename original to *_unpartitioned_backup, rename new into place.
--   7. Re-add FK to profiles, secondary indexes, RLS policies, ENABLE RLS.
--
-- TRIGGER / FUNCTION SAFETY:
--   No trigger writes to record_audit_log today — domain status changes go to
--   dedicated *_status_history tables (lead_status_history, proposal_status_history,
--   project_status_history). Verified via:
--     SELECT proname FROM pg_proc WHERE prosrc ILIKE '%record_audit_log%';
--     -> 0 rows
--   When app code or future triggers begin writing to this table by name, Postgres
--   resolves the table name at execution time, so writes will land in the new
--   partitioned table automatically.
--
-- ROLLBACK (manual, if verification fails before deploy):
--   ALTER TABLE record_audit_log RENAME TO record_audit_log_failed;
--   ALTER TABLE record_audit_log_unpartitioned_backup RENAME TO record_audit_log;
--
-- TODO (pg_cron — deferred to a later migration):
--   Schedule monthly partition auto-creation. Sketch:
--     SELECT cron.schedule(
--       'record_audit_log_create_next_partition',
--       '0 0 25 * *',  -- 25th of each month, create partition for next month
--       $$
--         DO $do$
--         DECLARE
--           next_month DATE := date_trunc('month', now()) + INTERVAL '1 month';
--           part_name TEXT := 'record_audit_log_y' || to_char(next_month, 'YYYY') || 'm' || to_char(next_month, 'MM');
--           start_ts TEXT := to_char(next_month, 'YYYY-MM-DD');
--           end_ts   TEXT := to_char(next_month + INTERVAL '1 month', 'YYYY-MM-DD');
--         BEGIN
--           EXECUTE format(
--             'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.record_audit_log FOR VALUES FROM (%L) TO (%L)',
--             part_name, start_ts, end_ts
--           );
--         END
--         $do$;
--       $$
--     );
--   pg_cron must be enabled in the postgres extension list (already enabled on dev).

BEGIN;

-- 1. New partitioned table — same shape, no constraints/indexes yet.
CREATE TABLE public.record_audit_log_new (
  LIKE public.record_audit_log INCLUDING ALL EXCLUDING CONSTRAINTS EXCLUDING INDEXES
) PARTITION BY RANGE (changed_at);

-- 2. Primary key — must include the partition key column. Named with `_new` suffix
--    while the original table still exists (index names are schema-wide, so reusing
--    `record_audit_log_pkey` here would collide with the original PK index). The
--    constraint and its underlying index are renamed to their final names in step 7
--    after the original table has been renamed out of the way.
ALTER TABLE public.record_audit_log_new
  ADD CONSTRAINT record_audit_log_new_pkey PRIMARY KEY (id, changed_at);

-- 3. Check constraint on `operation` — same name-collision rule applies to CHECK
--    constraints; use a `_new` name and rename after the swap.
ALTER TABLE public.record_audit_log_new
  ADD CONSTRAINT record_audit_log_new_operation_check
  CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'));

-- 4. Monthly partitions: current month (Jun 2026) + next 3 months.
CREATE TABLE public.record_audit_log_y2026m06 PARTITION OF public.record_audit_log_new
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE public.record_audit_log_y2026m07 PARTITION OF public.record_audit_log_new
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE public.record_audit_log_y2026m08 PARTITION OF public.record_audit_log_new
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE public.record_audit_log_y2026m09 PARTITION OF public.record_audit_log_new
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE public.record_audit_log_default PARTITION OF public.record_audit_log_new DEFAULT;

-- 5. Copy any existing data (empty today, but safe to run for replay correctness).
INSERT INTO public.record_audit_log_new
SELECT * FROM public.record_audit_log;

-- 6. Verify row counts match BEFORE swap — abort transaction on mismatch.
--    CRITICAL: master reference flags record_audit_log as "Immutable forever, never deleted".
--    A row-count drift here means we lose audit history. Raise to rollback.
DO $verify$
DECLARE
  src_count BIGINT;
  dst_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO src_count FROM public.record_audit_log;
  SELECT COUNT(*) INTO dst_count FROM public.record_audit_log_new;
  IF src_count <> dst_count THEN
    RAISE EXCEPTION
      'record_audit_log row count mismatch — aborting partition swap. source=%, new=%',
      src_count, dst_count;
  END IF;
END
$verify$;

-- 7. Swap names. After this, *_unpartitioned_backup can be dropped once the new
--    table is verified in production. Keep it around for now as a safety net.
ALTER TABLE public.record_audit_log RENAME TO record_audit_log_unpartitioned_backup;
ALTER TABLE public.record_audit_log_new RENAME TO record_audit_log;

-- 7a. Rename constraints/indexes to clear the canonical names from the backup table
--     and re-claim them on the new partitioned table. Renaming a table does not
--     rename its indexes or constraints, so both names are still in the backup's
--     namespace after step 7. We move them aside first, then promote the `_new`
--     names to canonical.

-- Backup table PK: rename constraint (renames the underlying index automatically).
ALTER TABLE public.record_audit_log_unpartitioned_backup
  RENAME CONSTRAINT record_audit_log_pkey
  TO record_audit_log_unpartitioned_backup_pkey;

-- Backup table operation CHECK.
ALTER TABLE public.record_audit_log_unpartitioned_backup
  RENAME CONSTRAINT record_audit_log_operation_check
  TO record_audit_log_unpartitioned_backup_operation_check;

-- Backup table FK (changed_by → profiles).
ALTER TABLE public.record_audit_log_unpartitioned_backup
  RENAME CONSTRAINT record_audit_log_changed_by_fkey
  TO record_audit_log_unpartitioned_backup_changed_by_fkey;

-- Now the canonical names are free — promote the new table's `_new`-suffixed names.
ALTER TABLE public.record_audit_log
  RENAME CONSTRAINT record_audit_log_new_pkey
  TO record_audit_log_pkey;

ALTER TABLE public.record_audit_log
  RENAME CONSTRAINT record_audit_log_new_operation_check
  TO record_audit_log_operation_check;

-- 8. Foreign key — changed_by references profiles(id), recreated post-swap.
ALTER TABLE public.record_audit_log
  ADD CONSTRAINT record_audit_log_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES public.profiles(id);

-- 9. Secondary indexes — recreate the three from 006c.
--    The PK already provides (id, changed_at), so we rebuild the lookup indexes only.
--    First, move the backup table's same-named indexes aside (index names are
--    schema-wide, so we can't reuse them until they're renamed).
ALTER INDEX public.idx_audit_log_table   RENAME TO idx_audit_log_table_unpartitioned_backup;
ALTER INDEX public.idx_audit_log_changed RENAME TO idx_audit_log_changed_unpartitioned_backup;
ALTER INDEX public.idx_audit_log_date    RENAME TO idx_audit_log_date_unpartitioned_backup;

CREATE INDEX idx_audit_log_table ON public.record_audit_log
  USING btree (table_name, record_id);

CREATE INDEX idx_audit_log_changed ON public.record_audit_log
  USING btree (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

CREATE INDEX idx_audit_log_date ON public.record_audit_log
  USING btree (changed_at DESC);

-- 10. RLS — re-enable and recreate the two policies from the original table.
ALTER TABLE public.record_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_read" ON public.record_audit_log
  FOR SELECT
  USING (
    (get_my_role() = ANY (ARRAY['founder'::app_role, 'hr_manager'::app_role]))
    OR (changed_by = auth.uid())
  );

CREATE POLICY "audit_log_insert" ON public.record_audit_log
  FOR INSERT
  WITH CHECK (TRUE);

-- 11. Documentation comment.
COMMENT ON TABLE public.record_audit_log IS
  'Universal Tier 3 audit log for all Tier 1 edits. Immutable, never deleted. '
  'Declaratively partitioned by RANGE(changed_at) — one partition per calendar month. '
  'Partitions are named record_audit_log_yYYYYmMM. A default partition catches '
  'out-of-range inserts. '
  'TODO: schedule monthly partition auto-creation via pg_cron (see migration header for sketch).';

COMMIT;
