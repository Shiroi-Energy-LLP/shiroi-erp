-- ============================================================================
-- 222 — Keep PostgREST's DB connection pool warm (perf workaround)
-- 2026-09-07 · docs/reviews/2026-07-19-erp-speed-full-report.md §6, cause #1
--
-- WHY
--   PostgREST closes idle pool connections after ~30 s (db-pool-max-idletime,
--   not configurable on Supabase). The ERP is used in a click → read → click
--   pattern, so almost every page load lands on an empty pool and pays for
--   fresh Postgres backends: 1 request after idle = ~930 ms vs ~200 ms warm;
--   a stepper tab's burst of 10 parallel queries = 1.2–3.6 s vs 0.5 s warm.
--   A 20 s heartbeat keeps the backends alive between clicks.
--
-- HOW
--   pg_cron fires every 20 s → postgrest_keep_warm() → N async pg_net GETs to
--   the project's own REST endpoint (a 1-row select on item_units, anon role).
--   Each request checks out a pool connection for ~1 ms, so 8 requests keep
--   ~8 backends warm (a tab burst needs up to 10).
--
-- PREREQUISITE (manual, per environment — values never live in the repo):
--   select vault.create_secret('https://<project-ref>.supabase.co',
--                              'postgrest_keepalive_url',   'REST base URL for the keep-warm cron');
--   select vault.create_secret('<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>',
--                              'postgrest_keepalive_apikey','publishable key for the keep-warm cron');
--   Without them the function logs a WARNING and does nothing.
--
-- ROLLBACK
--   select cron.unschedule('postgrest-keep-warm');
--   drop function public.postgrest_keep_warm(int);
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.postgrest_keep_warm(p_parallel int default 8)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  i     int;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'postgrest_keepalive_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'postgrest_keepalive_apikey';

  if v_url is null or v_key is null then
    raise warning '[postgrest_keep_warm] vault secrets postgrest_keepalive_url / postgrest_keepalive_apikey missing — skipping';
    return;
  end if;

  for i in 1..greatest(p_parallel, 1) loop
    perform net.http_get(
      url                  := v_url || '/rest/v1/item_units?select=value&limit=1',
      headers              := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 5000
    );
  end loop;
end;
$$;

comment on function public.postgrest_keep_warm(int) is
  'Perf workaround (mig 222): fires N async GETs at our own REST endpoint every 20 s via pg_cron so PostgREST''s pool connections never idle out. Not exposed to API roles.';

-- Never callable through PostgREST — postgres/cron only.
revoke all on function public.postgrest_keep_warm(int) from public, anon, authenticated;

-- Idempotent schedule (re-running the migration replaces the job).
select cron.unschedule(jobid) from cron.job where jobname = 'postgrest-keep-warm';
select cron.schedule('postgrest-keep-warm', '20 seconds', $$select public.postgrest_keep_warm(8)$$);

-- 4,320 runs/day would grow cron.job_run_details unboundedly; keep 3 days.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-cron-run-details';
select cron.schedule('purge-cron-run-details', '17 22 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
