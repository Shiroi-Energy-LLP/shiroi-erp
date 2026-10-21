-- =============================================================================
-- Migration 224 — Manivel Google Sheet live sync (phase 1: sheet → ERP mirror)
-- Spec: docs/superpowers/specs/2026-10-21-manivel-sheet-live-sync-design.md
--
-- gsheet_sources        : which spreadsheets to pull (enable/disable without a deploy)
-- gsheet_rows           : current mirror, one row per sheet row (keyed per spec §4)
-- gsheet_changes        : field-level insert/update/remove events Manivel made
-- gsheet_project_links  : sheet project name → ERP project (auto from mig-180 recon / exact name, or manual)
-- gsheet_sync_runs      : one row per Edge Function run per source
-- gsheet_apply_snapshot(): set-based diff of one tab's full contents (called by Edge Function `gsheet-sync`)
-- gsheet_sync_tick()    : pg_cron → pg_net POST to the Edge Function
--
-- Phase 1 is read-only toward core tables: nothing here writes projects / tasks / activities.
--
-- PREREQUISITE (manual, per environment — values never live in the repo):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/gsheet-sync', 'gsheet_sync_url',    'gsheet-sync Edge Function URL');
--   select vault.create_secret('<same value as Edge secret GSHEET_SYNC_SECRET>',     'gsheet_sync_secret', 'shared secret for gsheet-sync');
--   Without them gsheet_sync_tick() logs a WARNING and does nothing.
--
-- ROLLBACK
--   select cron.unschedule('gsheet-sync');
--   drop function gsheet_sync_tick(); drop function gsheet_apply_snapshot(text,text,jsonb,uuid);
--   drop table gsheet_changes, gsheet_project_links, gsheet_rows, gsheet_sync_runs, gsheet_sources;
--   drop function gsheet_norm(text);
-- Additive only. Dev-first; prod deferred.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- Same normalisation as norm() in scripts/reconcile-manivel.ts and the gsheet-sync Edge Function,
-- so keys line up with recon_sheet_projects.name_norm.
create or replace function gsheet_norm(p text)
returns text
language sql immutable
set search_path = public
as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               replace(lower(coalesce(p, '')), '&', ' and '),
               '[._,/\\()\[\]''"`-]', ' ', 'g'),
             '\m(mr|mrs|ms|dr|prof|messrs|sri|smt|thiru)\M', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

create table gsheet_sources (
  id              text primary key,
  spreadsheet_id  text not null,
  title           text not null,
  tabs            text[] not null,
  enabled         boolean not null default true,
  last_run_at     timestamptz,
  last_status     text,
  last_error      text,
  created_at      timestamptz not null default now()
);

create table gsheet_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null references gsheet_sources(id) on delete cascade,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running','ok','partial','error')),
  rows_seen    int not null default 0,
  inserts      int not null default 0,
  updates      int not null default 0,
  removes      int not null default 0,
  error        text
);
create index idx_gsheet_runs_source_started on gsheet_sync_runs(source_id, started_at desc);

create table gsheet_rows (
  source_id        text not null references gsheet_sources(id) on delete cascade,
  tab              text not null,
  row_key          text not null,
  project_key      text,
  sheet_row        int,
  data             jsonb not null,
  row_hash         text not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_changed_at  timestamptz not null default now(),
  removed_at       timestamptz,
  primary key (source_id, tab, row_key)
);
create index idx_gsheet_rows_project_key on gsheet_rows(source_id, project_key);
create index idx_gsheet_rows_changed     on gsheet_rows(last_changed_at desc);

create table gsheet_project_links (
  source_id    text not null references gsheet_sources(id) on delete cascade,
  project_key  text not null,
  project_id   uuid references projects(id) on delete set null,
  link_method  text not null check (link_method in ('exact','recon','manual')),
  linked_by    uuid references employees(id),
  linked_at    timestamptz not null default now(),
  primary key (source_id, project_key)
);
create index idx_gsheet_links_project on gsheet_project_links(project_id);

create table gsheet_changes (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid references gsheet_sync_runs(id) on delete set null,
  source_id      text not null references gsheet_sources(id) on delete cascade,
  tab            text not null,
  row_key        text not null,
  project_key    text,
  project_id     uuid references projects(id) on delete set null,
  change_type    text not null check (change_type in ('insert','update','remove')),
  field          text,
  old_value      text,
  new_value      text,
  detected_at    timestamptz not null default now(),
  review_status  text not null default 'pending' check (review_status in ('pending','applied','ignored')),
  reviewed_by    uuid references employees(id),
  reviewed_at    timestamptz
);
create index idx_gsheet_changes_detected on gsheet_changes(detected_at desc);
create index idx_gsheet_changes_status   on gsheet_changes(review_status, detected_at desc);
create index idx_gsheet_changes_project  on gsheet_changes(project_id);
create index idx_gsheet_changes_row      on gsheet_changes(source_id, tab, row_key);

-- RLS: founder + PM read; founder + PM may review changes and set manual links. Sync writes via service role.
alter table gsheet_sources       enable row level security;
alter table gsheet_sync_runs     enable row level security;
alter table gsheet_rows          enable row level security;
alter table gsheet_project_links enable row level security;
alter table gsheet_changes       enable row level security;

create policy gsheet_sources_read on gsheet_sources for select to authenticated
  using (get_my_role() in ('founder','project_manager'));
create policy gsheet_runs_read on gsheet_sync_runs for select to authenticated
  using (get_my_role() in ('founder','project_manager'));
create policy gsheet_rows_read on gsheet_rows for select to authenticated
  using (get_my_role() in ('founder','project_manager'));
create policy gsheet_links_read on gsheet_project_links for select to authenticated
  using (get_my_role() in ('founder','project_manager'));
create policy gsheet_links_write on gsheet_project_links for all to authenticated
  using (get_my_role() in ('founder','project_manager'))
  with check (get_my_role() in ('founder','project_manager'));
create policy gsheet_changes_read on gsheet_changes for select to authenticated
  using (get_my_role() in ('founder','project_manager'));
create policy gsheet_changes_review on gsheet_changes for update to authenticated
  using (get_my_role() in ('founder','project_manager'))
  with check (get_my_role() in ('founder','project_manager'));

-- -----------------------------------------------------------------------------
-- gsheet_apply_snapshot: diff one tab's FULL current contents against the mirror.
--   p_rows = [{ "row_key": text, "project_key": text|null, "sheet_row": int, "data": {col: text} }, ...]
-- First load of a tab is a baseline (mirror only, no insert events).
-- Safety: an empty snapshot, or one that would remove >50% of a tab with >20 live rows,
-- skips removals (likely a read glitch / tab restructure) and reports removes_skipped.
-- -----------------------------------------------------------------------------
create or replace function gsheet_apply_snapshot(p_source text, p_tab text, p_rows jsonb, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baseline   boolean;
  v_live       int;
  v_incoming   int;
  v_would_rm   int;
  v_skip_rm    boolean := false;
  v_inserts    int := 0;
  v_updates    int := 0;
  v_removes    int := 0;
begin
  drop table if exists _in;
  create temp table _in on commit drop as
    select r.row_key, r.project_key, r.sheet_row, r.data, md5(r.data::text) as row_hash
    from jsonb_to_recordset(p_rows) as r(row_key text, project_key text, sheet_row int, data jsonb)
    where r.row_key is not null and r.row_key <> '';

  select count(*) into v_incoming from _in;
  select not exists (select 1 from gsheet_rows where source_id = p_source and tab = p_tab) into v_baseline;
  select count(*) into v_live from gsheet_rows where source_id = p_source and tab = p_tab and removed_at is null;
  select count(*) into v_would_rm
    from gsheet_rows g
    where g.source_id = p_source and g.tab = p_tab and g.removed_at is null
      and not exists (select 1 from _in i where i.row_key = g.row_key);

  if v_incoming = 0 or (v_live > 20 and v_would_rm * 2 > v_live) then
    v_skip_rm := true;
  end if;

  -- field-level updates (live rows whose content changed)
  insert into gsheet_changes (run_id, source_id, tab, row_key, project_key, change_type, field, old_value, new_value)
  select p_run_id, p_source, p_tab, i.row_key, i.project_key, 'update', k.key, g.data ->> k.key, i.data ->> k.key
  from _in i
  join gsheet_rows g on g.source_id = p_source and g.tab = p_tab and g.row_key = i.row_key
  cross join lateral (
    select key from jsonb_object_keys(g.data || i.data) as key
  ) k
  where g.removed_at is null
    and g.row_hash <> i.row_hash
    and (g.data ->> k.key) is distinct from (i.data ->> k.key);
  get diagnostics v_updates = row_count;

  -- inserts: brand-new keys, or keys that reappear after removal
  if not v_baseline then
    insert into gsheet_changes (run_id, source_id, tab, row_key, project_key, change_type, new_value)
    select p_run_id, p_source, p_tab, i.row_key, i.project_key, 'insert', i.data::text
    from _in i
    left join gsheet_rows g on g.source_id = p_source and g.tab = p_tab and g.row_key = i.row_key
    where g.row_key is null or g.removed_at is not null;
    get diagnostics v_inserts = row_count;
  end if;

  insert into gsheet_rows as g (source_id, tab, row_key, project_key, sheet_row, data, row_hash)
  select p_source, p_tab, i.row_key, i.project_key, i.sheet_row, i.data, i.row_hash from _in i
  on conflict (source_id, tab, row_key) do update set
    project_key     = excluded.project_key,
    sheet_row       = excluded.sheet_row,
    data            = excluded.data,
    row_hash        = excluded.row_hash,
    last_seen_at    = now(),
    last_changed_at = case when g.row_hash <> excluded.row_hash or g.removed_at is not null
                           then now() else g.last_changed_at end,
    removed_at      = null;

  -- removals
  if not v_skip_rm then
    with gone as (
      update gsheet_rows g set removed_at = now(), last_changed_at = now()
      where g.source_id = p_source and g.tab = p_tab and g.removed_at is null
        and not exists (select 1 from _in i where i.row_key = g.row_key)
      returning g.row_key, g.project_key, g.data
    )
    insert into gsheet_changes (run_id, source_id, tab, row_key, project_key, change_type, old_value)
    select p_run_id, p_source, p_tab, row_key, project_key, 'remove', data::text from gone;
    get diagnostics v_removes = row_count;
  end if;

  -- auto-link project keys seen for the first time: mig-180 reconciliation first, then exact name
  insert into gsheet_project_links (source_id, project_key, project_id, link_method)
  select distinct on (k.project_key) p_source, k.project_key, pr.project_id, 'recon'
  from (select distinct project_key from _in where project_key is not null and project_key <> '') k
  join recon_sheet_projects s on s.name_norm = k.project_key
  join project_reconciliation pr on pr.matched_sheet_id = s.id
  where (pr.status = 'confirmed' or (pr.match_method = 'auto' and pr.status <> 'rejected'))
  order by k.project_key, (pr.status = 'confirmed') desc
  on conflict (source_id, project_key) do nothing;

  insert into gsheet_project_links (source_id, project_key, project_id, link_method)
  select p_source, k.project_key, min(p.id::text)::uuid, 'exact'
  from (select distinct project_key from _in where project_key is not null and project_key <> '') k
  join projects p on p.deleted_at is null
                 and gsheet_norm(coalesce(nullif(p.project_name, ''), p.customer_name)) = k.project_key
  where not exists (select 1 from gsheet_project_links l where l.source_id = p_source and l.project_key = k.project_key)
  group by k.project_key
  having count(*) = 1
  on conflict (source_id, project_key) do nothing;

  -- stamp project ids onto this run's changes
  update gsheet_changes c set project_id = l.project_id
  from gsheet_project_links l
  where c.run_id = p_run_id and c.source_id = p_source and c.tab = p_tab
    and c.project_id is null and l.source_id = c.source_id and l.project_key = c.project_key;

  return jsonb_build_object(
    'tab', p_tab, 'rows', v_incoming, 'baseline', v_baseline,
    'inserts', v_inserts, 'updates', v_updates, 'removes', v_removes,
    'removes_skipped', case when v_skip_rm then v_would_rm else 0 end);
end;
$$;

revoke all on function gsheet_apply_snapshot(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function gsheet_apply_snapshot(text, text, jsonb, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Cron trigger: POST to the Edge Function (it replies 202 and works in the background).
-- -----------------------------------------------------------------------------
create or replace function gsheet_sync_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'gsheet_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gsheet_sync_secret';
  if v_url is null or v_secret is null then
    raise warning '[gsheet_sync_tick] vault secrets gsheet_sync_url / gsheet_sync_secret missing — skipping';
    return;
  end if;

  perform net.http_post(
    url                  := v_url,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-gsheet-sync-secret', v_secret),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 10000
  );

  delete from public.gsheet_sync_runs where started_at < now() - interval '30 days';
end;
$$;

revoke all on function gsheet_sync_tick() from public, anon, authenticated;

insert into gsheet_sources (id, spreadsheet_id, title, tabs) values
  ('manivel_dashboard', '1m8Ywb88fT9bwAMQZK1iM9DhfUv1lWYJhGRSLHH921Bk', 'Manivel dashboard (shiroienergy)',
   array['Projects','Budgets','Tasks','Services','Activities','Plant Monitoring','Project details']),
  ('manivel_boi', '1CsAYamXivIpqPJkKzum0vdkyfoKWBNUrv1C62wmktt8', 'Manivel Bill of Items',
   array['Projects','Bill of Items','Expenses','Price Book'])
on conflict (id) do nothing;

select cron.schedule('gsheet-sync', '*/10 * * * *', $$select public.gsheet_sync_tick()$$);

-- Review-page read: live Projects-tab rows with no ERP link yet (manual-link queue).
create or replace view gsheet_unlinked_projects with (security_invoker = true) as
select r.source_id,
       r.project_key,
       r.data ->> 'Project Name' as project_name,
       r.data ->> 'Size'         as size,
       r.data ->> 'Status'       as status,
       r.data ->> 'Years'        as years,
       r.data ->> 'Location'     as location,
       r.sheet_row
from gsheet_rows r
left join gsheet_project_links l on l.source_id = r.source_id and l.project_key = r.project_key
where r.tab = 'Projects' and r.removed_at is null and r.project_key is not null and l.project_id is null;
