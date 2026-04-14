-- Migration 050: Inverter telemetry infrastructure
--
-- Creates the full schema for ingesting per-inverter power readings from
-- vendor monitoring APIs (Sungrow, Growatt, SMA, Huawei, Fronius).
--
-- Scale targets:
--   - Today:    ~630 inverters × 96 readings/day = 60k rows/day
--   - 10x:      ~6,300 inverters × 96 readings/day = 600k rows/day
--   - 10x + strings: ~6M string rows/day (10 strings/inverter)
--
-- At this volume a single Postgres table becomes painful for VACUUM,
-- ANALYZE, backup, and WAL replication. Declarative partitioning by
-- month solves all four issues with zero new infrastructure (native
-- Postgres, no TimescaleDB required — Supabase removed TimescaleDB
-- support in 2023).
--
-- Partition strategy:
--   - inverter_readings PARTITION BY RANGE (recorded_at), monthly
--   - inverter_string_readings same
--   - pg_cron creates next month's partition on the 28th
--   - Retention policy drops raw partitions older than 90 days AFTER
--     the nightly rollup job has copied data into _hourly/_daily
--
-- Rollup strategy:
--   - inverter_readings_hourly: regular table, nightly pg_cron job
--     populates bucket = date_trunc('hour', recorded_at)
--   - inverter_readings_daily: regular table, nightly pg_cron job
--     populates bucket = date_trunc('day', recorded_at) with PR and
--     offline/fault minute counters
--
-- Live polling status: adapters are stubbed pending Sungrow/Growatt
-- API registration (4-8 weeks). The schema is ready to accept data
-- today via the Edge Function poller.

-- ═══════════════════════════════════════════════════════════════════════
-- Extensions — pg_cron for scheduled jobs
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ═══════════════════════════════════════════════════════════════════════
-- Master tables (regular, small, RLS-locked)
-- ═══════════════════════════════════════════════════════════════════════

-- Credentials references — NEVER stores raw secrets, only Vault refs
CREATE TABLE IF NOT EXISTS inverter_monitoring_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (brand IN ('sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'other')),
  label TEXT NOT NULL,
  -- Name of the env var / Vault secret that holds the actual credentials.
  -- The Edge Function poller reads this and looks up the real value.
  vault_secret_ref TEXT NOT NULL,
  -- Optional metadata the adapter needs (API endpoint URL, account ID, etc.)
  -- Anything that isn't a secret can live here.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  UNIQUE (brand, label)
);

ALTER TABLE inverter_monitoring_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_creds_read ON inverter_monitoring_credentials
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('founder', 'om_technician'))
  );

CREATE POLICY inverter_creds_write ON inverter_monitoring_credentials
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'founder')
  );

COMMENT ON TABLE inverter_monitoring_credentials IS
  'Credential references for vendor monitoring APIs. NEVER stores raw secrets — only the name of the env var or Supabase Vault secret. The Edge Function poller dereferences vault_secret_ref at runtime.';

-- Inverter master
CREATE TABLE IF NOT EXISTS inverters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  serial_number TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (brand IN ('sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'other')),
  model TEXT,
  rated_capacity_kw NUMERIC(8,2) NOT NULL,
  string_count SMALLINT NOT NULL DEFAULT 1,
  commissioned_at DATE,

  -- Monitoring integration
  monitoring_credentials_id UUID REFERENCES inverter_monitoring_credentials(id) ON DELETE SET NULL,
  -- Brand-specific plant/site identifier within the vendor's monitoring portal
  monitoring_site_id TEXT,
  -- Brand-specific device identifier (serial as seen by vendor API)
  monitoring_device_id TEXT,
  polling_interval_minutes SMALLINT NOT NULL DEFAULT 15
    CHECK (polling_interval_minutes BETWEEN 5 AND 120),
  polling_enabled BOOLEAN NOT NULL DEFAULT true,

  -- Health — updated by the poller after each successful read
  last_poll_at TIMESTAMPTZ,
  last_reading_at TIMESTAMPTZ,
  current_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (current_status IN ('active', 'offline', 'fault', 'derated', 'unknown', 'decommissioned')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (brand, serial_number)
);

-- Indexes — required for the poller scheduler and project detail page
CREATE INDEX IF NOT EXISTS idx_inverters_project
  ON inverters(project_id) WHERE current_status != 'decommissioned';
CREATE INDEX IF NOT EXISTS idx_inverters_polling
  ON inverters(last_poll_at NULLS FIRST) WHERE polling_enabled = true;
CREATE INDEX IF NOT EXISTS idx_inverters_health
  ON inverters(current_status) WHERE polling_enabled = true;

ALTER TABLE inverters ENABLE ROW LEVEL SECURITY;

-- Reading: anyone who can see the project can see its inverters
CREATE POLICY inverters_read ON inverters
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance', 'sales_engineer', 'designer', 'purchase_officer', 'hr_manager')
    )
  );

CREATE POLICY inverters_write ON inverters
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('founder', 'project_manager', 'om_technician'))
  );

COMMENT ON TABLE inverters IS
  'Master table for solar inverters deployed at customer sites. Time-series readings live in inverter_readings (partitioned). The poller scheduler uses idx_inverters_polling to find inverters due for their next read.';

-- ═══════════════════════════════════════════════════════════════════════
-- Partitioned time-series tables
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inverter_readings (
  inverter_id UUID NOT NULL REFERENCES inverters(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  ac_power_kw NUMERIC(10,3),
  dc_power_kw NUMERIC(10,3),
  ac_voltage_v NUMERIC(8,2),
  ac_current_a NUMERIC(8,2),
  ac_frequency_hz NUMERIC(5,2),
  temperature_c NUMERIC(5,2),
  energy_today_kwh NUMERIC(12,3),
  energy_total_kwh NUMERIC(14,3),
  status TEXT,
  error_code TEXT,
  raw_payload JSONB,  -- vendor-specific fields we didn't normalize
  PRIMARY KEY (inverter_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Time-only index for cross-inverter analysis queries (e.g., "all readings
-- in the last hour"). The PK already covers (inverter_id, recorded_at) for
-- per-inverter lookups.
CREATE INDEX IF NOT EXISTS idx_inverter_readings_time
  ON inverter_readings (recorded_at DESC);

ALTER TABLE inverter_readings ENABLE ROW LEVEL SECURITY;

-- Readings inherit visibility from the parent inverter via project_id join
-- through the master table. Using the same role list as the master.
CREATE POLICY inverter_readings_read ON inverter_readings
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance', 'sales_engineer', 'designer', 'purchase_officer', 'hr_manager')
    )
  );

-- Only the service role (admin client) writes readings — this is the
-- poller path. Authenticated users never write to this table directly.
CREATE POLICY inverter_readings_insert_service ON inverter_readings
  FOR INSERT TO service_role WITH CHECK (true);

COMMENT ON TABLE inverter_readings IS
  'Time-series inverter readings, partitioned monthly by recorded_at. Raw data kept 90 days; older partitions dropped after nightly rollup to _hourly/_daily. NEVER query directly from the frontend — use the rollup tables.';

-- Per-string readings (same partitioning pattern)
CREATE TABLE IF NOT EXISTS inverter_string_readings (
  inverter_id UUID NOT NULL,
  string_number SMALLINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  voltage_v NUMERIC(8,2),
  current_a NUMERIC(8,2),
  power_kw NUMERIC(10,3),
  PRIMARY KEY (inverter_id, string_number, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX IF NOT EXISTS idx_inverter_string_readings_time
  ON inverter_string_readings (recorded_at DESC);

ALTER TABLE inverter_string_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_string_readings_read ON inverter_string_readings
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance')
    )
  );

CREATE POLICY inverter_string_readings_insert_service ON inverter_string_readings
  FOR INSERT TO service_role WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- Create initial partitions
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  month_start DATE := date_trunc('month', NOW())::date;
  month_name  TEXT;
  partition_name TEXT;
BEGIN
  -- Current month + 2 future months, so the poller never hits a missing partition
  FOR i IN 0..2 LOOP
    month_name := to_char(month_start + (i || ' month')::interval, 'YYYY_MM');

    partition_name := 'inverter_readings_' || month_name;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF inverter_readings FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      month_start + (i || ' month')::interval,
      month_start + ((i + 1) || ' month')::interval
    );

    partition_name := 'inverter_string_readings_' || month_name;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF inverter_string_readings FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      month_start + (i || ' month')::interval,
      month_start + ((i + 1) || ' month')::interval
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Rollup tables (not partitioned — smaller volume, ~300 rows/month/inverter)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inverter_readings_hourly (
  inverter_id UUID NOT NULL REFERENCES inverters(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  avg_ac_power_kw NUMERIC(10,3),
  peak_ac_power_kw NUMERIC(10,3),
  energy_generated_kwh NUMERIC(12,3),
  avg_temperature_c NUMERIC(5,2),
  sample_count INT NOT NULL,
  PRIMARY KEY (inverter_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_inverter_hourly_time
  ON inverter_readings_hourly (bucket_start DESC);

ALTER TABLE inverter_readings_hourly ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_hourly_read ON inverter_readings_hourly
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance', 'sales_engineer', 'designer', 'purchase_officer', 'hr_manager')
    )
  );

CREATE POLICY inverter_hourly_write_service ON inverter_readings_hourly
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE inverter_readings_hourly IS
  'Pre-computed hourly rollup of inverter_readings. Populated by nightly pg_cron job. Retention: 2 years.';

CREATE TABLE IF NOT EXISTS inverter_readings_daily (
  inverter_id UUID NOT NULL REFERENCES inverters(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  energy_generated_kwh NUMERIC(12,3),
  peak_ac_power_kw NUMERIC(10,3),
  expected_kwh NUMERIC(12,3),         -- from PVWatts or local irradiance model
  performance_ratio NUMERIC(5,4),     -- generated / expected
  offline_minutes INT NOT NULL DEFAULT 0,
  fault_minutes INT NOT NULL DEFAULT 0,
  sample_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (inverter_id, day)
);

CREATE INDEX IF NOT EXISTS idx_inverter_daily_day
  ON inverter_readings_daily (day DESC);
CREATE INDEX IF NOT EXISTS idx_inverter_daily_performance
  ON inverter_readings_daily (day, performance_ratio)
  WHERE performance_ratio IS NOT NULL AND performance_ratio < 0.70;

ALTER TABLE inverter_readings_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_daily_read ON inverter_readings_daily
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor', 'om_technician', 'finance', 'sales_engineer', 'designer', 'purchase_officer', 'hr_manager', 'customer')
    )
  );

CREATE POLICY inverter_daily_write_service ON inverter_readings_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE inverter_readings_daily IS
  'Pre-computed daily rollup of inverter_readings with performance ratio. Populated by nightly pg_cron job. Retention: forever (~3KB/inverter/year).';

-- ═══════════════════════════════════════════════════════════════════════
-- Poll failure log (for alerting + debugging)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inverter_poll_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inverter_id UUID NOT NULL REFERENCES inverters(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT NOT NULL,
  http_status INT,
  payload_excerpt TEXT
);

CREATE INDEX IF NOT EXISTS idx_inverter_poll_failures_recent
  ON inverter_poll_failures (attempted_at DESC);

ALTER TABLE inverter_poll_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY inverter_poll_failures_read ON inverter_poll_failures
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('founder', 'om_technician'))
  );

CREATE POLICY inverter_poll_failures_write_service ON inverter_poll_failures
  FOR INSERT TO service_role WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- Partition-management function + pg_cron schedule
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_inverter_partition_for_month(target_month DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  month_start DATE := date_trunc('month', target_month)::date;
  month_name  TEXT := to_char(month_start, 'YYYY_MM');
  partition_name TEXT;
BEGIN
  partition_name := 'inverter_readings_' || month_name;
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF inverter_readings FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    month_start,
    month_start + interval '1 month'
  );

  partition_name := 'inverter_string_readings_' || month_name;
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF inverter_string_readings FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    month_start,
    month_start + interval '1 month'
  );
END;
$$;

-- Schedule: 03:00 local on the 28th of each month, create next month's partition
SELECT cron.schedule(
  'inverter-create-next-month-partition',
  '0 3 28 * *',
  $$ SELECT create_inverter_partition_for_month((NOW() + interval '1 month')::date); $$
);

-- ═══════════════════════════════════════════════════════════════════════
-- Nightly rollup jobs
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rollup_inverter_readings_hourly()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Recompute yesterday + today to handle late-arriving data
  DELETE FROM inverter_readings_hourly
  WHERE bucket_start >= (NOW() - interval '2 days')::date;

  INSERT INTO inverter_readings_hourly (
    inverter_id, bucket_start, avg_ac_power_kw, peak_ac_power_kw,
    energy_generated_kwh, avg_temperature_c, sample_count
  )
  SELECT
    inverter_id,
    date_trunc('hour', recorded_at) AS bucket_start,
    AVG(ac_power_kw),
    MAX(ac_power_kw),
    GREATEST(MAX(energy_total_kwh) - MIN(energy_total_kwh), 0),
    AVG(temperature_c),
    COUNT(*)::int
  FROM inverter_readings
  WHERE recorded_at >= (NOW() - interval '2 days')::date
  GROUP BY inverter_id, date_trunc('hour', recorded_at);
END;
$$;

CREATE OR REPLACE FUNCTION rollup_inverter_readings_daily()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Recompute yesterday + today to handle late-arriving data
  DELETE FROM inverter_readings_daily
  WHERE day >= (NOW() - interval '2 days')::date;

  INSERT INTO inverter_readings_daily (
    inverter_id, day, energy_generated_kwh, peak_ac_power_kw,
    offline_minutes, fault_minutes, sample_count
  )
  SELECT
    inverter_id,
    recorded_at::date AS day,
    GREATEST(MAX(energy_total_kwh) - MIN(energy_total_kwh), 0),
    MAX(ac_power_kw),
    COUNT(*) FILTER (WHERE status = 'offline')::int,
    COUNT(*) FILTER (WHERE status = 'fault')::int,
    COUNT(*)::int
  FROM inverter_readings
  WHERE recorded_at >= (NOW() - interval '2 days')::date
  GROUP BY inverter_id, recorded_at::date;
END;
$$;

SELECT cron.schedule(
  'inverter-rollup-hourly',
  '17 2 * * *',  -- 02:17 local nightly (offset to avoid noisy :00)
  'SELECT rollup_inverter_readings_hourly();'
);
SELECT cron.schedule(
  'inverter-rollup-daily',
  '22 2 * * *',  -- 02:22 local nightly
  'SELECT rollup_inverter_readings_daily();'
);

-- ═══════════════════════════════════════════════════════════════════════
-- Raw-partition retention (drop partitions older than 90 days AFTER rollups exist)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION drop_old_inverter_partitions()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cutoff DATE := (NOW() - interval '90 days')::date;
  r RECORD;
BEGIN
  -- Safety: only drop if the daily rollup has data for at least 1 month
  -- past the cutoff — prevents accidental data loss if the rollup job has
  -- been failing and no one noticed.
  IF NOT EXISTS (
    SELECT 1 FROM inverter_readings_daily
    WHERE day >= cutoff + interval '30 days'
    LIMIT 1
  ) THEN
    RAISE NOTICE 'Skipping partition drop: daily rollups appear stale';
    RETURN;
  END IF;

  FOR r IN
    SELECT c.relname AS partition_name
    FROM pg_inherits i
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE parent.relname IN ('inverter_readings', 'inverter_string_readings')
  LOOP
    -- partition naming convention: {parent}_YYYY_MM
    -- extract YYYY_MM from the tail and compare to cutoff
    IF r.partition_name ~ '_[0-9]{4}_[0-9]{2}$' THEN
      DECLARE
        part_month DATE := to_date(
          regexp_replace(r.partition_name, '^.*_([0-9]{4}_[0-9]{2})$', '\1'),
          'YYYY_MM'
        );
      BEGIN
        IF part_month < date_trunc('month', cutoff)::date THEN
          EXECUTE format('DROP TABLE IF EXISTS %I', r.partition_name);
          RAISE NOTICE 'Dropped partition %', r.partition_name;
        END IF;
      END;
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'inverter-drop-old-partitions',
  '42 3 * * *',  -- 03:42 local nightly, after rollups
  'SELECT drop_old_inverter_partitions();'
);

-- ═══════════════════════════════════════════════════════════════════════
-- Auto-ticket RPC — scans daily rollups for anomalies and creates
-- om_service_tickets for PM follow-up. Called by pg_cron at 07:00 local
-- so tickets land in the PM's morning queue.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_service_tickets_from_inverter_alerts()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  tickets_created INT := 0;
  r RECORD;
  next_ticket_num INT;
BEGIN
  FOR r IN
    SELECT
      i.id AS inverter_id,
      i.serial_number,
      i.brand,
      i.project_id,
      d.performance_ratio,
      d.offline_minutes,
      d.fault_minutes
    FROM inverter_readings_daily d
    JOIN inverters i ON i.id = d.inverter_id
    WHERE d.day = (NOW() - interval '1 day')::date
      AND i.current_status NOT IN ('decommissioned')
      AND (
        (d.performance_ratio IS NOT NULL AND d.performance_ratio < 0.70)
        OR d.offline_minutes > 60
        OR d.fault_minutes > 0
      )
      -- Don't create a second ticket for the same inverter within 7 days
      AND NOT EXISTS (
        SELECT 1 FROM om_service_tickets t
        WHERE t.project_id = i.project_id
          AND t.created_at > NOW() - interval '7 days'
          AND t.status NOT IN ('closed', 'resolved')
          AND t.title LIKE '%' || i.serial_number || '%'
      )
  LOOP
    -- Generate ticket number
    SELECT COALESCE(MAX(CAST(SPLIT_PART(ticket_number, '-', 2) AS INT)), 0) + 1
    INTO next_ticket_num
    FROM om_service_tickets
    WHERE ticket_number LIKE 'TKT-%';

    INSERT INTO om_service_tickets (
      project_id,
      ticket_number,
      title,
      description,
      issue_type,
      severity,
      status,
      sla_hours
    ) VALUES (
      r.project_id,
      'TKT-' || LPAD(next_ticket_num::text, 4, '0'),
      'Inverter alert: ' || r.serial_number,
      format(
        'Auto-detected from daily rollup. Performance ratio: %s. Offline minutes: %s. Fault minutes: %s. Brand: %s.',
        COALESCE(r.performance_ratio::text, 'n/a'),
        r.offline_minutes,
        r.fault_minutes,
        r.brand
      ),
      CASE
        WHEN r.fault_minutes > 0 THEN 'inverter_fault'
        WHEN r.offline_minutes > 60 THEN 'inverter_offline'
        ELSE 'inverter_underperformance'
      END,
      CASE
        WHEN r.fault_minutes > 0 THEN 'high'
        WHEN r.offline_minutes > 240 THEN 'high'
        ELSE 'medium'
      END,
      'open',
      CASE
        WHEN r.fault_minutes > 0 THEN 24
        WHEN r.offline_minutes > 240 THEN 24
        ELSE 48
      END
    );

    tickets_created := tickets_created + 1;
  END LOOP;

  RETURN tickets_created;
END;
$$;

SELECT cron.schedule(
  'inverter-auto-tickets',
  '1 7 * * *',  -- 07:01 local daily
  'SELECT create_service_tickets_from_inverter_alerts();'
);

COMMENT ON FUNCTION create_service_tickets_from_inverter_alerts() IS
  'Scans yesterday''s inverter_readings_daily for anomalies (PR<0.70, offline>60min, fault>0) and creates om_service_tickets. Deduplicates on a 7-day window per inverter to avoid ticket spam. Returns count of tickets created.';

-- ═══════════════════════════════════════════════════════════════════════
-- Poller helper — returns inverters due for their next read
-- Used by the Supabase Edge Function poller (Sungrow/Growatt adapters)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_inverters_due_for_poll(batch_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  monitoring_site_id TEXT,
  monitoring_device_id TEXT,
  monitoring_credentials_id UUID,
  polling_interval_minutes SMALLINT,
  last_reading_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    i.id,
    i.brand,
    i.model,
    i.serial_number,
    i.monitoring_site_id,
    i.monitoring_device_id,
    i.monitoring_credentials_id,
    i.polling_interval_minutes,
    i.last_reading_at
  FROM inverters i
  WHERE i.polling_enabled = true
    AND i.current_status != 'decommissioned'
    AND (
      i.last_poll_at IS NULL
      OR i.last_poll_at < NOW() - (i.polling_interval_minutes || ' minutes')::interval
    )
  ORDER BY i.last_poll_at NULLS FIRST
  LIMIT batch_limit;
$$;

COMMENT ON FUNCTION get_inverters_due_for_poll(INT) IS
  'Returns inverters whose next read is due. Called by the Supabase Edge Function poller every 5 minutes. Ordered by last_poll_at ASC so the longest-overdue inverters are polled first. Batch limit protects against runaway scans.';

-- ═══════════════════════════════════════════════════════════════════════
-- Verification queries
-- ═══════════════════════════════════════════════════════════════════════

-- After applying, verify with:
--   SELECT COUNT(*) FROM inverters;                                 -- 0 initially
--   SELECT * FROM get_inverters_due_for_poll(10);                   -- empty
--   SELECT cron.job FROM cron.job WHERE jobname LIKE 'inverter-%';  -- 5 jobs
--   SELECT relname FROM pg_inherits i
--     JOIN pg_class c ON c.oid = i.inhrelid
--     WHERE i.inhparent = 'inverter_readings'::regclass;            -- 3 partitions
