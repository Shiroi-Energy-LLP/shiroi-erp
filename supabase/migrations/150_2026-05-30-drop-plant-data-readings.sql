-- ============================================================
-- Migration 150 — DROP plant_data_readings
-- Date: 2026-05-30
-- Why:
--   plant_data_readings (mig 005d, legacy Sungrow/Growatt 15-min telemetry)
--   was superseded by mig 050's inverter_readings (partitioned). The
--   Batch-A workflow agent verified zero recent rows + zero code references
--   in apps/, scripts/, supabase/functions/, infrastructure/. Drop confirmed
--   dead.
--
--   Performance review #22 flagged this as NEVER-DO #16 (unpartitioned
--   time-series). Cheaper to drop than to partition a dead table.
--
--   Reconstructed from dev DB state (Batch-A workflow agent applied via
--   execute_sql but didn't persist the local file). Table no longer exists
--   on dev — this migration is a no-op idempotent record for future replay.
-- ============================================================

DROP TABLE IF EXISTS public.plant_data_readings CASCADE;
