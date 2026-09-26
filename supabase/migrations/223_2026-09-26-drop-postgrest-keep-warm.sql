-- ============================================================================
-- 223 — Remove the PostgREST keep-warm cron (reverts the cron half of mig 222)
-- 2026-09-26 · docs/reviews/2026-09-26-dev-db-freeze-keep-warm.md
--
-- WHY
--   The dev DB (which the live ERP uses) froze at 2026-09-26 03:11 UTC and
--   stayed unreachable for ~5 h until a Dashboard restart, while Supabase still
--   reported ACTIVE_HEALTHY. Just before the freeze, single-row inserts took
--   12–13 s (normally ~300 ms), which points to storage/IO starvation on the
--   instance.
--
--   Mig 222's keep-warm (pg_cron every 20 s → 8 pg_net GETs = 34,560 extra REST
--   calls + 4,320 cron runs/day) coincides with a ~9x step in PostgREST
--   "Thread killed by timeout manager" errors:
--     09-03: 297 · 09-05: 240 · [09-07 mig 222] · 09-08: 2,593 · 09-18: 2,312
--   It was not the sole trigger of the freeze (its pings ran at normal latency
--   until the stall began), but it is constant background load on the smallest
--   compute tier, with no benefit when the instance is already struggling.
--   The job was paused by hand at 08:03 UTC on 2026-09-26 (cron.alter_job).
--
-- TRADE-OFF
--   Cold-pool latency returns: first request after >30 s idle is ~0.9 s again,
--   and a 10-query tab burst is 1.2–3.6 s (vs 0.45–0.76 s warm). The durable
--   fix for that is a larger compute tier, not synthetic traffic.
--
-- KEPT
--   `purge-cron-run-details` (still useful) and the pg_net extension.
--   The Vault secrets postgrest_keepalive_url / postgrest_keepalive_apikey are
--   left in place (harmless; delete by hand if wanted).
--
-- ROLLBACK
--   Re-run 222_2026-09-07-postgrest-keep-warm.sql.
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'postgrest-keep-warm';

drop function if exists public.postgrest_keep_warm(int);
