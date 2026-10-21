-- =============================================================================
-- Migration 225 — Manivel sheet live sync, phase 2: the sheet WINS for projects
-- Spec: docs/superpowers/specs/2026-10-21-manivel-sheet-live-sync-design.md §6
-- Decided 2026-10-21 (Vivek): dashboard Projects tab is master; the sheet
-- overwrites linked ERP projects; blank / ₹0 / "Nil" never erases an ERP value;
-- Project Cost → contracted_value; unlinked sheet projects become new ERP projects;
-- the ERP project number is written back into the sheet's far-right "ERP ID" column.
--
-- Field map (Projects tab, + Budgets tab on the same row_key):
--   Project Name  → projects.project_name   (new projects: also customer_name)
--   Size          → projects.system_size_kwp (> 0 only)
--   Status        → projects.status          (gsheet_map_status; unknown values skipped)
--   Location      → projects.site_address_line2 (locality; site_city stays as-is)
--   Project Cost  → projects.contracted_value (> 0 only)
--   Years / Project Cost / Actual Cost → project_reconciliation (resolved_year,
--                   sheet_project_cost, sheet_actual_cost) — feeds Command Center
--   Remarks       → NOT applied (would clobber ERP notes); stays in the mirror.
-- Every overwrite is logged in gsheet_apply_log (old → new) so it can be audited / reverted.
--
-- gsheet_sources.apply_projects marks the master source (only the dashboard).
-- ERP ID column: gsheet_apply_snapshot now accepts row.erp_ref; a sheet row carrying an
-- ERP project number is linked to that project first (rename-proof), method 'erp_id'.
--
-- First bulk apply: payment follow-up tasks are suppressed (trg_payment_followup gains a
-- WHEN guard on the transaction-local setting shiroi.gsheet_bulk) so syncing hundreds of
-- historical statuses doesn't spawn hundreds of tasks. Later incremental applies fire it
-- normally — a real status change in the sheet is a real event.
--
-- ROLLBACK
--   drop function gsheet_apply_projects(text,uuid,boolean); drop table gsheet_apply_log;
--   drop function gsheet_map_status(text); drop function gsheet_num(text); drop function gsheet_blank(text);
--   recreate trg_payment_followup without the WHEN clause (see mig 031);
--   alter table gsheet_sources drop column apply_projects;
-- Dev-first; prod deferred.
-- =============================================================================

alter table gsheet_sources add column if not exists apply_projects boolean not null default false;
update gsheet_sources set apply_projects = (id = 'manivel_dashboard');

alter table gsheet_project_links drop constraint if exists gsheet_project_links_link_method_check;
alter table gsheet_project_links add constraint gsheet_project_links_link_method_check
  check (link_method in ('exact','recon','manual','created','erp_id'));

create table gsheet_apply_log (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references gsheet_sync_runs(id) on delete set null,
  source_id    text not null references gsheet_sources(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  action       text not null check (action in ('create','update')),
  field        text,
  old_value    text,
  new_value    text,
  applied_at   timestamptz not null default now()
);
create index idx_gsheet_apply_log_project on gsheet_apply_log(project_id, applied_at desc);
create index idx_gsheet_apply_log_applied on gsheet_apply_log(applied_at desc);

alter table gsheet_apply_log enable row level security;
create policy gsheet_apply_log_read on gsheet_apply_log for select to authenticated
  using (get_my_role() in ('founder','project_manager'));

-- Blank-equivalents Manivel uses: '', Nil, NA, N/A, -, 0
create or replace function gsheet_blank(p text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(lower(btrim(p)), '') in ('', 'nil', 'na', 'n/a', '-', '--', '0', '₹0', '0%');
$$;

-- '₹1,23,456.50' → 123456.50 ; anything non-numeric or <= 0 → NULL. Pure NUMERIC, no floats.
create or replace function gsheet_num(p text)
returns numeric language plpgsql immutable set search_path = public as $$
declare v text := regexp_replace(coalesce(p, ''), '[^0-9.]', '', 'g');
begin
  if v = '' or v !~ '^[0-9]*\.?[0-9]+$' then return null; end if;
  return nullif(greatest(v::numeric, 0), 0);
end;
$$;

-- Sheet status words → project_status (spec §6). Unknown → NULL (never applied).
create or replace function gsheet_map_status(p text)
returns project_status language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p, '')))
    when 'completed'             then 'completed'
    when 'yet to start'          then 'yet_to_start'
    when 'in progress'           then 'in_progress'
    when 'on progress'           then 'in_progress'
    when 'waiting for net meter' then 'waiting_net_metering'
    when 'waiting for meter'     then 'waiting_net_metering'
    when 'holding from client'   then 'holding_client'
    when 'holding from shiroi'   then 'holding_shiroi'
    when 'meter client scope'    then 'meter_client_scope'
    else null end::project_status;
$$;

-- Suppress payment follow-up task spawning during the first bulk apply only.
drop trigger if exists trg_payment_followup on projects;
create trigger trg_payment_followup
  after update of status on projects
  for each row
  when (coalesce(current_setting('shiroi.gsheet_bulk', true), '') <> 'on')
  execute function create_payment_followup_tasks();

-- -----------------------------------------------------------------------------
-- gsheet_apply_snapshot: v2 — adds ERP-ID linking (row.erp_ref = projects.project_number).
-- Body otherwise identical to mig 224.
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
    select r.row_key, r.project_key, r.sheet_row, r.data, r.erp_ref, md5(r.data::text) as row_hash
    from jsonb_to_recordset(p_rows) as r(row_key text, project_key text, sheet_row int, data jsonb, erp_ref text)
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

  -- 1) ERP ID column wins over every other link (survives renames in the sheet)
  insert into gsheet_project_links as l (source_id, project_key, project_id, link_method)
  select distinct on (i.project_key) p_source, i.project_key, p.id, 'erp_id'
  from _in i
  join projects p on p.project_number = btrim(i.erp_ref) and p.deleted_at is null
  where i.project_key is not null and i.project_key <> '' and coalesce(btrim(i.erp_ref), '') <> ''
  order by i.project_key, i.sheet_row
  on conflict (source_id, project_key) do update
    set project_id = excluded.project_id, link_method = 'erp_id', linked_at = now()
    where l.project_id is distinct from excluded.project_id;

  -- 2) mig-180 reconciliation, 3) exact unique name
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
-- gsheet_apply_projects: make linked ERP projects match the master sheet.
--   p_dry_run = true → returns what WOULD change (no writes, no project numbers consumed).
-- Only the first row per project_key is used (duplicate "#2" rows are ignored).
-- -----------------------------------------------------------------------------
create or replace function gsheet_apply_projects(p_source text, p_run_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_apply boolean;
  v_created     int := 0;
  v_updated     int := 0;
  v_fields      int := 0;
  v_recon       int := 0;
  v_preview     jsonb;
  r             record;
  v_project_id  uuid;
  v_number      text;
begin
  if not exists (select 1 from gsheet_sources where id = p_source and apply_projects) then
    return jsonb_build_object('skipped', 'source is not the master (apply_projects = false)');
  end if;

  drop table if exists _src;
  create temp table _src on commit drop as
    select distinct on (pr.project_key)
           pr.project_key,
           pr.sheet_row,
           btrim(pr.data ->> 'Project Name')                                         as name,
           gsheet_num(pr.data ->> 'Size')                                            as size_kwp,
           gsheet_map_status(pr.data ->> 'Status')                                   as status,
           case when gsheet_blank(pr.data ->> 'Location') then null
                else btrim(pr.data ->> 'Location') end                               as location,
           case when (pr.data ->> 'Years') ~ '^\s*(19|20)[0-9]{2}\s*$'
                then btrim(pr.data ->> 'Years')::int end                             as sheet_year,
           gsheet_num(b.data ->> 'Project Cost')                                     as project_cost,
           gsheet_num(b.data ->> 'Actual Cost')                                      as actual_cost,
           l.project_id
    from gsheet_rows pr
    left join gsheet_rows b on b.source_id = pr.source_id and b.tab = 'Budgets' and b.row_key = pr.row_key and b.removed_at is null
    left join gsheet_project_links l on l.source_id = pr.source_id and l.project_key = pr.project_key
    where pr.source_id = p_source and pr.tab = 'Projects' and pr.removed_at is null
      and pr.project_key is not null and pr.project_key <> ''
      and btrim(coalesce(pr.data ->> 'Project Name', '')) <> ''
    order by pr.project_key, pr.sheet_row;

  -- the field-level diff (old ERP value vs sheet value), blank sheet values never apply
  drop table if exists _diff;
  create temp table _diff on commit drop as
    select s.project_id, f.field, f.old_value, f.new_value
    from _src s
    join projects p on p.id = s.project_id and p.deleted_at is null
    cross join lateral (values
      ('project_name',       p.project_name,                 s.name),
      ('system_size_kwp',    p.system_size_kwp::text,        s.size_kwp::text),
      ('status',             p.status::text,                 s.status::text),
      ('site_address_line2', p.site_address_line2,           s.location),
      ('contracted_value',   p.contracted_value::text,       s.project_cost::text)
    ) as f(field, old_value, new_value)
    where f.new_value is not null
      and (case when f.field in ('system_size_kwp','contracted_value')
                then f.old_value::numeric is distinct from f.new_value::numeric
                else f.old_value is distinct from f.new_value end);

  if p_dry_run then
    select jsonb_build_object(
      'dry_run', true,
      'would_create', (select count(*) from _src where project_id is null),
      'would_update_projects', (select count(distinct project_id) from _diff),
      'would_update_fields', (select jsonb_object_agg(field, n) from (select field, count(*) n from _diff group by field) x),
      'status_moves', (select jsonb_object_agg(mv, n) from (select old_value || ' → ' || new_value mv, count(*) n from _diff where field = 'status' group by 1) y),
      'sample', (select jsonb_agg(z) from (select d.project_id, p.project_number, d.field, d.old_value, d.new_value
                                           from _diff d join projects p on p.id = d.project_id order by random() limit 15) z)
    ) into v_preview;
    return v_preview;
  end if;

  select not exists (select 1 from gsheet_apply_log where source_id = p_source) into v_first_apply;
  if v_first_apply then
    perform set_config('shiroi.gsheet_bulk', 'on', true);
  end if;

  -- 1) create ERP projects for sheet projects with no link (minimal row, quickCreateProject convention)
  for r in select * from _src where project_id is null loop
    v_number := generate_doc_number('PROJ');
    insert into projects (project_number, project_name, customer_name, customer_phone,
                          site_address_line1, site_address_line2, site_city, site_state,
                          system_type, system_size_kwp, panel_count,
                          contracted_value, advance_amount, advance_received_at, status, notes)
    values (v_number, r.name, r.name, 'NA',
            'Pending', r.location, 'Chennai', 'Tamil Nadu',
            'on_grid', coalesce(r.size_kwp, 0), 0,
            coalesce(r.project_cost, 0), 0, (now() at time zone 'Asia/Kolkata')::date,
            coalesce(r.status, 'order_received'), '[gsheet-sync] created from Manivel''s sheet')
    returning id into v_project_id;

    insert into gsheet_project_links (source_id, project_key, project_id, link_method)
    values (p_source, r.project_key, v_project_id, 'created')
    on conflict (source_id, project_key) do update set project_id = excluded.project_id, link_method = 'created', linked_at = now();

    insert into gsheet_apply_log (run_id, source_id, project_id, action, new_value)
    values (p_run_id, p_source, v_project_id, 'create', v_number || ' ' || r.name);

    update _src set project_id = v_project_id where project_key = r.project_key;
    v_created := v_created + 1;
  end loop;

  -- 2) overwrite linked projects field by field (sheet wins), logging old → new
  insert into gsheet_apply_log (run_id, source_id, project_id, action, field, old_value, new_value)
  select p_run_id, p_source, project_id, 'update', field, old_value, new_value from _diff;
  get diagnostics v_fields = row_count;

  update projects p set
    project_name       = coalesce((select new_value from _diff d where d.project_id = p.id and d.field = 'project_name'), p.project_name),
    system_size_kwp    = coalesce((select new_value::numeric from _diff d where d.project_id = p.id and d.field = 'system_size_kwp'), p.system_size_kwp),
    status             = coalesce((select new_value::project_status from _diff d where d.project_id = p.id and d.field = 'status'), p.status),
    site_address_line2 = coalesce((select new_value from _diff d where d.project_id = p.id and d.field = 'site_address_line2'), p.site_address_line2),
    contracted_value   = coalesce((select new_value::numeric from _diff d where d.project_id = p.id and d.field = 'contracted_value'), p.contracted_value)
  where p.id in (select distinct project_id from _diff);
  get diagnostics v_updated = row_count;

  -- 3) year + sheet money into project_reconciliation (Command Center reads resolved_year)
  insert into project_reconciliation as pr (project_id, match_method, status, resolved_year,
                                            sheet_project_cost, sheet_actual_cost, notes)
  select s.project_id, 'sheet_only', 'confirmed', s.sheet_year, s.project_cost, s.actual_cost, '[gsheet-sync]'
  from _src s
  where s.project_id is not null
  on conflict (project_id) do update set
    resolved_year      = coalesce(excluded.resolved_year, pr.resolved_year),
    sheet_project_cost = coalesce(excluded.sheet_project_cost, pr.sheet_project_cost),
    sheet_actual_cost  = coalesce(excluded.sheet_actual_cost, pr.sheet_actual_cost)
  where pr.resolved_year      is distinct from coalesce(excluded.resolved_year, pr.resolved_year)
     or pr.sheet_project_cost is distinct from coalesce(excluded.sheet_project_cost, pr.sheet_project_cost)
     or pr.sheet_actual_cost  is distinct from coalesce(excluded.sheet_actual_cost, pr.sheet_actual_cost);
  get diagnostics v_recon = row_count;

  -- 4) sheet edits on the applied tabs are now reflected in the ERP
  update gsheet_changes c set review_status = 'applied', reviewed_at = now()
  where c.source_id = p_source and c.tab in ('Projects','Budgets') and c.review_status = 'pending'
    and c.project_key in (select project_key from _src);

  return jsonb_build_object('created', v_created, 'updated_projects', v_updated,
                            'updated_fields', v_fields, 'recon_rows', v_recon,
                            'bulk_followups_suppressed', v_first_apply);
end;
$$;

revoke all on function gsheet_apply_projects(text, uuid, boolean) from public, anon, authenticated;
grant execute on function gsheet_apply_projects(text, uuid, boolean) to service_role;

-- Write-back list for the Edge Function: which sheet row should carry which ERP project number.
create or replace view gsheet_erp_id_targets with (security_invoker = true) as
select r.source_id, r.sheet_row, r.data ->> 'Project Name' as project_name, p.project_number
from gsheet_rows r
join gsheet_project_links l on l.source_id = r.source_id and l.project_key = r.project_key
join projects p on p.id = l.project_id
join gsheet_sources s on s.id = r.source_id and s.apply_projects
where r.tab = 'Projects' and r.removed_at is null;
