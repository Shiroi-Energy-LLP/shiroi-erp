-- ============================================================
-- Migration 160 — Partition lead_activities by created_at month
-- File: supabase/migrations/160_2026-06-04-partition-lead-activities.sql
-- Date: 2026-06-04
-- Dependencies: 002a_leads_core.sql
--
-- Background
-- ----------
-- lead_activities was created in 002a as a regular (non-partitioned) table.
-- It stores every touchpoint on a lead (call/email/whatsapp/visit/meeting)
-- and grows monotonically with sales activity. CLAUDE.md NEVER-DO #16
-- requires declarative partitioning for time-series tables, so we are
-- migrating before the table accumulates real volume.
--
-- Partition strategy
-- ------------------
--   - PARTITION BY RANGE (created_at), monthly buckets
--   - Composite PK (id, created_at) — Postgres requires the partition key
--     to be part of the PK
--   - One partition per month from 2026-04 (earliest existing row) through
--     2026-08 (current + 2 future months so we never miss a write)
--   - DEFAULT partition catches any stray write outside those bounds
--   - pg_cron job creates next-month partition on the 28th of each month
--
-- Foreign keys
-- ------------
--   - Outgoing: lead_id → leads(id) ON DELETE CASCADE, performed_by → employees(id)
--   - Incoming: NONE (verified via pg_constraint pre-migration)
--   - No other table references lead_activities.id, so changing the PK to
--     (id, created_at) is safe.
--
-- RLS / triggers
-- --------------
--   - Live policies use get_my_role() / get_my_employee_id() — those are the
--     authoritative definitions and are recreated here (NOT the original 002a
--     "(SELECT role FROM profiles ...)" form, which was superseded by a later
--     refactor).
--   - The updated_at BEFORE-UPDATE trigger is recreated on the new parent.
--     Postgres automatically propagates row triggers to partitions.
--
-- Migration mechanics
-- -------------------
--   1. Rename old table to lead_activities_old (keeps data, FKs, indexes).
--   2. Create new partitioned parent + per-month partitions + default.
--   3. INSERT-copy from old table; verify row count matches.
--   4. Recreate indexes, FKs, RLS, policies, trigger on new parent.
--   5. Drop the old table.
--   6. Schedule pg_cron for next-month partition creation.
--
-- Rollback (manual)
-- -----------------
--   If anything goes wrong before COMMIT, the BEGIN/ROLLBACK takes care of
--   it. After commit, manual rollback would be:
--     DROP TABLE lead_activities CASCADE;
--     ALTER TABLE lead_activities_old RENAME TO lead_activities;
--     -- recreate trigger, then re-apply original RLS policies
--   But there is no _old table after this migration completes — it is
--   dropped at the end. Restore from a Supabase point-in-time backup if
--   needed.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Rename existing table + its indexes to preserve data during the swap
-- ------------------------------------------------------------
-- Postgres does not rename indexes when a table is renamed, so we have to
-- rename the original indexes explicitly. Otherwise the new indexes on the
-- partitioned parent would collide on idx_lead_activities_lead /
-- idx_lead_activities_by / lead_activities_pkey.
ALTER INDEX public.lead_activities_pkey       RENAME TO lead_activities_old_pkey;
ALTER INDEX public.idx_lead_activities_lead   RENAME TO idx_lead_activities_old_lead;
ALTER INDEX public.idx_lead_activities_by     RENAME TO idx_lead_activities_old_by;

-- The rag_chunks_read policy on public.rag_chunks contains a subquery against
-- lead_activities. Postgres tracks that dependency by oid, so after the
-- rename the policy would pin lead_activities_old in place and block the
-- DROP at the end of this migration. We drop the policy here and recreate
-- it after the new parent exists, rebinding the reference.
DROP POLICY IF EXISTS rag_chunks_read ON public.rag_chunks;

ALTER TABLE public.lead_activities RENAME TO lead_activities_old;

-- Drop the trigger on the old table — we'll recreate on the new parent.
-- (Trigger name will collide with the new one otherwise.)
DROP TRIGGER IF EXISTS lead_activities_updated_at ON public.lead_activities_old;

-- ------------------------------------------------------------
-- 2. Create the partitioned parent table
-- ------------------------------------------------------------
-- Column definitions mirror 002a exactly. The only change is the PK,
-- which becomes composite (id, created_at) to satisfy Postgres's
-- requirement that the partition key be part of every unique constraint.
CREATE TABLE public.lead_activities (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL,
  performed_by    UUID NOT NULL,

  activity_type   TEXT NOT NULL CHECK (activity_type IN (
    'call', 'whatsapp', 'email', 'site_visit',
    'meeting', 'proposal_sent', 'follow_up', 'note'
  )),

  summary         TEXT NOT NULL,
  outcome         TEXT,

  activity_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  duration_minutes INT,

  next_action     TEXT,
  next_action_date DATE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ------------------------------------------------------------
-- 3. Create initial partitions
-- ------------------------------------------------------------
-- Range: 2026-04 (earliest row in data: 2026-04-28) through 2026-08 (current
-- month + 2 future months). Plus a DEFAULT partition for safety.
DO $$
DECLARE
  month_start DATE := DATE '2026-04-01';
  upper_bound DATE := date_trunc('month', NOW())::date + INTERVAL '3 months';
  cur DATE;
  partition_name TEXT;
BEGIN
  cur := month_start;
  WHILE cur < upper_bound LOOP
    partition_name := 'lead_activities_' || to_char(cur, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.lead_activities FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      cur,
      cur + INTERVAL '1 month'
    );
    cur := cur + INTERVAL '1 month';
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.lead_activities_default
  PARTITION OF public.lead_activities DEFAULT;

-- ------------------------------------------------------------
-- 4. Copy data from the old table
-- ------------------------------------------------------------
INSERT INTO public.lead_activities (
  id, lead_id, performed_by, activity_type, summary, outcome,
  activity_date, duration_minutes, next_action, next_action_date,
  created_at, updated_at
)
SELECT
  id, lead_id, performed_by, activity_type, summary, outcome,
  activity_date, duration_minutes, next_action, next_action_date,
  created_at, updated_at
FROM public.lead_activities_old;

-- Verify the row counts match. Abort the migration if they don't.
DO $$
DECLARE
  old_count BIGINT;
  new_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO old_count FROM public.lead_activities_old;
  SELECT COUNT(*) INTO new_count FROM public.lead_activities;
  IF old_count <> new_count THEN
    RAISE EXCEPTION
      'lead_activities partition migration row-count mismatch: old=%, new=%',
      old_count, new_count;
  END IF;
  RAISE NOTICE 'lead_activities row count verified: % rows', new_count;
END $$;

-- ------------------------------------------------------------
-- 5. Recreate foreign keys
-- ------------------------------------------------------------
ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES public.employees(id);

-- ------------------------------------------------------------
-- 6. Recreate indexes (CLAUDE.md NEVER-DO #17 — every filterable column
--    gets an index in the same migration as the column lives in)
-- ------------------------------------------------------------
CREATE INDEX idx_lead_activities_lead
  ON public.lead_activities (lead_id, activity_date DESC);

CREATE INDEX idx_lead_activities_by
  ON public.lead_activities (performed_by);

-- ------------------------------------------------------------
-- 7. Recreate the updated_at trigger
-- ------------------------------------------------------------
CREATE TRIGGER lead_activities_updated_at
  BEFORE UPDATE ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 8. RLS — recreate the LIVE policies (using get_my_role/get_my_employee_id,
--    which superseded the 002a form in a later refactor)
-- ------------------------------------------------------------
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_activities_read
  ON public.lead_activities FOR SELECT
  USING (
    (get_my_role() = ANY (ARRAY[
      'founder'::app_role,
      'hr_manager'::app_role,
      'finance'::app_role,
      'sales_engineer'::app_role,
      'project_manager'::app_role,
      'marketing_manager'::app_role,
      'designer'::app_role
    ]))
    OR performed_by = get_my_employee_id()
  );

CREATE POLICY lead_activities_write
  ON public.lead_activities FOR ALL
  USING (
    get_my_role() = ANY (ARRAY[
      'founder'::app_role,
      'sales_engineer'::app_role,
      'project_manager'::app_role,
      'marketing_manager'::app_role
    ])
  )
  WITH CHECK (
    get_my_role() = ANY (ARRAY[
      'founder'::app_role,
      'sales_engineer'::app_role,
      'project_manager'::app_role,
      'marketing_manager'::app_role
    ])
  );

-- ------------------------------------------------------------
-- 9. Recreate the rag_chunks_read policy (now pointing at the new parent)
-- ------------------------------------------------------------
-- Verbatim restoration of the live definition — only difference is that the
-- subquery now resolves to the new partitioned lead_activities.
CREATE POLICY rag_chunks_read
  ON public.rag_chunks FOR SELECT
  USING (
    (source_type = ANY (ARRAY[
      'module_doc'::text,
      'master_reference'::text,
      'claude_md'::text,
      'spec'::text,
      'plan'::text,
      'review'::text,
      'changelog'::text,
      'price_book_item'::text,
      'project_decision'::text
    ]))
    OR (source_type = 'proposal'::text AND EXISTS (
      SELECT 1 FROM public.proposals p WHERE p.id::text = rag_chunks.source_id
    ))
    OR (source_type = 'service_ticket'::text AND EXISTS (
      SELECT 1 FROM public.om_service_tickets t WHERE t.id::text = rag_chunks.source_id
    ))
    OR (source_type = 'lead_activity'::text AND EXISTS (
      SELECT 1 FROM public.lead_activities la WHERE la.id::text = rag_chunks.source_id
    ))
  );

-- ------------------------------------------------------------
-- 10. Drop the old table (data already copied + verified above)
-- ------------------------------------------------------------
DROP TABLE public.lead_activities_old;

-- ------------------------------------------------------------
-- 11. Partition-management function + pg_cron schedule
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_lead_activities_partition_for_month(target_month DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  month_start DATE := date_trunc('month', target_month)::date;
  partition_name TEXT := 'lead_activities_' || to_char(month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.lead_activities FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    month_start,
    month_start + interval '1 month'
  );
END;
$$;

-- Schedule: 03:05 local on the 28th of each month, create next month's partition.
-- Offset by a few minutes from inverter-create-next-month-partition (03:00) to
-- avoid two DDL jobs hitting at the same instant.
SELECT cron.schedule(
  'lead-activities-create-next-month-partition',
  '5 3 28 * *',
  $$ SELECT public.create_lead_activities_partition_for_month((NOW() + interval '1 month')::date); $$
);

-- ------------------------------------------------------------
-- 12. Comments
-- ------------------------------------------------------------
COMMENT ON TABLE public.lead_activities IS
  'Every touchpoint on a lead (call/email/whatsapp/visit/meeting). Partitioned monthly by created_at (mig 160). PK is composite (id, created_at) because the partition key must be part of every unique constraint. No incoming FKs reference this table''s id, so the composite PK is safe.';

COMMENT ON FUNCTION public.create_lead_activities_partition_for_month(DATE) IS
  'Creates a monthly partition of public.lead_activities for the given month. Called by pg_cron on the 28th of each month to create next month''s partition.';

COMMIT;
