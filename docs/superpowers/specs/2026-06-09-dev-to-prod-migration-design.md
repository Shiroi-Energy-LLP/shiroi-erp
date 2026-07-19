# Dev → Prod Migration — Design Spec & Cutover Runbook

> **STATUS: PLANNED — NOT SCHEDULED. We are not migrating now.**
> This document is the agreed design + step-by-step runbook for the eventual one-shot
> dev → prod cutover. Execution is deferred until Vivek green-lights a prod window
> (after dev is validated and the team is working on dev). See [[project_dev_only_no_prod]].
>
> Authored 2026-06-09. Grounded in a live inventory of the dev project taken the same day.

---

## 1. Goal & non-goals

**Goal.** Copy **everything** in the dev Supabase project into the existing prod Supabase
project — every row, every file, every user — so prod becomes a byte-faithful copy of dev,
then flip the app + automation to point at prod. "Complete copy" is a hard requirement, and
it is **verified**, not assumed (see §8).

**Non-goals.**
- Not an ongoing/continuous dev→prod sync. This is a **single cutover**. After it, prod is
  the live system and dev reverts to being the throwaway sandbox.
- Not a schema re-derivation. We do **not** replay the ~167 numbered migrations onto prod
  (see §4 for why).
- Not a re-architecture. No data model changes ride along with the move.

---

## 2. The two projects (as of 2026-06-09)

| | Dev (source) | Prod (target) |
|---|---|---|
| Project ref | `actqtzoxjilqnldnacqz` | `kfkydkwycgijvexqiysc` |
| Name | shiroi-erp-dev | shiroi-erp-prod |
| Region | `ap-northeast-2` (Seoul) | `ap-northeast-1` (Tokyo) |
| Postgres | 17.6 | 17.6 |
| Status | ACTIVE_HEALTHY | **INACTIVE (paused)** |

Same Postgres major version → dump/restore is compatible. **Different regions** → only
affects transfer *speed*, never correctness. Prod is **paused** and must be un-paused and
inspected before anything else (see §7 pre-flight).

> A third project (`pcmlkopfpmrslpcwyjns`, "Vivek Sakalaraksh App") exists in the org and is
> unrelated — ignore it.

---

## 3. What's actually in dev — the payload inventory

Measured live on 2026-06-09:

- **Database: 118 MB**, 243 public tables. Tiny — dump+restore is a few minutes.
- **Storage: 16 GB across 20,253 objects** — *this* is the bulk of the work and time:
  | bucket | objects | size | migrate? |
  |---|---|---|---|
  | `proposal-files` | 7,646 | 13 GB | ✅ |
  | `project-files` | 2,342 | 1,933 MB | ✅ |
  | `site-photos` | 10,227 | 1,179 MB | ✅ |
  | `n8n-backups` | 38 | 122 MB | ❌ skip (dev artifact) |
  | `voice-reports`, `vendor-invoices-inbound`, `rfq-excel-uploads` | 0 | 0 | bucket only, no objects |
- **Auth: 7 users**, all email/password staff accounts, 0 phone/customer accounts, all confirmed.
- **pg_cron: 7 jobs** (inverter partition/rollup maintenance + lead-activities partition) — see §6.5 for exact defs.
- **Partitioned tables: 7 parents** (inverter_readings + 5 log tables from migs 162–166 + lead_activities).
- **Vault: 1 secret** — the pgcrypto key for encrypted plant-credential columns. **Non-portable** (see §6.4).
- **86 SECURITY DEFINER functions** in `public` (carried in the schema dump; `search_path` hardening is tracked separately and is not a cutover blocker).
- **Extensions actually installed:** `pg_stat_statements`, `uuid-ossp`, `vector` (0.8.0, for embeddings), `supabase_vault`, `pgcrypto`, `pg_cron`, `plpgsql`.

Largest tables (all small): `proposal_bom_lines` (~24.7k rows), `proposals` (866), `whatsapp_import_queue` (~4.2k), `expenses` (~6.3k), `documents` (~7.6k), `leads` (~1.3k), `projects` (472).

---

## 4. Strategy & rationale

**Chosen approach: maintenance-window freeze + CLI dump/restore + rclone storage copy.**
(Decided with Vivek 2026-06-09.)

**Why dump dev's *live* state instead of replaying migrations.** Replaying the numbered
migrations would reproduce the *idealized* schema. Dev has had ad-hoc SQL applied over its
life (Dashboard, MCP, one-off fixes) that may not be perfectly captured in numbered files.
Dumping the live schema guarantees **prod == dev**, drift included. The migration files
remain the historical record; they are not the cutover mechanism.

**Why not Supabase's native "Restore to a new project" (clone).** It is disqualified on
three independent counts for our case:
1. It creates a **brand-new** project **in the source region** (Seoul) — it cannot target our
   **existing** Tokyo prod project (`kfkydkwycgijvexqiysc`).
2. It **does not copy Storage at all** — i.e. it skips the 16 GB that is the bulk of the job.
3. It requires physical-backups/PITR add-ons on the source.
   So we use the region-agnostic CLI path instead.

**Why not zero-downtime logical replication.** Prod has **no live users** yet, so a short
freeze costs nothing but a pause in the team's dev data-entry. Logical replication would add
significant complexity and risk for a benefit we don't need. (Decided with Vivek.)

**Safety posture (important — we are doing the real cutover with no separate rehearsal).**
The entire process only ever **reads** from dev. Dev stays live and intact throughout. That
makes rollback trivial: if prod verification fails, we simply **don't flip the app** — dev is
still the source of truth — then wipe prod and retry. The riskiest single piece (storage
metadata via the S3 protocol) is exercised **days early** during the live storage pre-sync
(§7), so it is effectively rehearsed against real prod before the freeze.

---

## 5. Cutover at a glance

```
PRE-FLIGHT (days before, dev stays live)
  └─ un-pause prod · inspect · clean-reset prod to empty
  └─ enable extensions · deploy edge functions + secrets
  └─ rclone PRE-SYNC 16 GB storage (live) ← rehearses the risky storage path
  └─ write & test the verification script

FREEZE (~30–60 min, dev write-frozen)
  └─ pause dev app (Vercel) · pause n8n · unschedule dev pg_cron
  └─ dump dev:  roles.sql + schema.sql + data.sql
  └─ restore prod:  psql single-transaction (triggers off)
  └─ rclone FINAL DELTA (only files added since pre-sync)
  └─ re-create vault secret · re-create 7 cron jobs
  └─ RUN VERIFICATION  ← hard gate

FLIP (only if verification 100% green)
  └─ point Vercel env + n8n credentials at prod · redeploy
  └─ smoke test on prod · unfreeze

ROLLBACK (if any check fails)
  └─ do NOT flip · dev still live · wipe prod · fix · retry
```

---

## 6. The six domains — how each one moves

### 6.1 Database (118 MB, 243 tables)

Three dumps from dev, one transactional restore into prod. Commands verbatim in §7.

- `roles.sql` — `supabase db dump --role-only`
- `schema.sql` — `supabase db dump` (DDL: tables, partitions, indexes, RLS, triggers, the 86 SECURITY DEFINER functions, `CREATE EXTENSION` lines)
- `data.sql` — `supabase db dump --use-copy --data-only`, **excluding** `storage.objects` and the storage vector tables (rclone owns storage — see 6.3)
- Restore: a single `psql --single-transaction --variable ON_ERROR_STOP=1` applying roles → schema → `SET session_replication_role = replica` → data. `replica` mode **disables triggers during load**, which prevents double-encryption of already-encrypted columns and avoids FK-trigger churn on bulk insert.

**Sequences** (bigserial tables — audit logs, zoho lookups, etc.): `--data-only` with `pg_dump` emits `setval(...)` so sequence positions carry over. Confirmed by the parity check in §8.

### 6.2 Auth users (7, email/password)

The data dump includes the `auth` schema, so `auth.users` (+ `auth.identities`) come over
**with their original UUIDs and hashed passwords**. Preserving UUIDs is the whole point:
every `created_by` / `assigned_to` / reviewer FK across the 243 public tables keeps pointing
at the right person. Re-provisioning fresh accounts would mint new UUIDs and orphan every one
of those references — so we do **not** do that.

- **Belt-and-suspenders:** if the `--data-only` dump turns out not to carry `auth` on the
  installed CLI version, take an explicit `pg_dump --schema=auth --data-only` and restore it
  before `data.sql`. The §8 check (`auth.users` count = 7) catches this either way.
- **JWT secret decision (resolved):** prod keeps **its own** JWT secret — we do **not** reuse
  dev's signing secret in prod (security: a leaked dev secret must never be able to forge prod
  tokens). Consequence: the 7 staff log in **once** after cutover. Trivial at this scale.
- Passwords are preserved, so "log in once" means re-entering existing passwords, not resets.

### 6.3 Storage files (16 GB, 20,253 objects)

`rclone` copies S3-to-S3, dev → prod, and is the **sole** mechanism for storage. The S3
protocol makes Supabase Storage **create the correct `storage.objects` metadata itself** on
the destination — which is exactly why `data.sql` **excludes** `storage.objects` (§6.1):
otherwise the SQL restore and rclone would both try to create those rows and collide.

- **Bucket definitions** (`storage.buckets` rows: name, public flag, size limits, mime allow-lists)
  **are** kept in `data.sql` (only `storage.objects` is excluded), so the 7 buckets exist on
  prod before rclone runs. Order is guaranteed: restore (creates buckets) → rclone (fills objects).
- **Pre-sync** the three non-empty buckets live, days before the window; during the freeze only
  the **delta** (files created since pre-sync) copies — keeping the freeze short.
- **Skip** `n8n-backups` (dev artifact). The 3 empty buckets need no object copy.
- **Owner field caveat:** rclone-created `storage.objects` rows may carry a service owner rather
  than the original uploader. ERP file access is via signed URLs / the admin client, so this is
  cosmetic — but §8 includes an explicit "open a proposal PDF via signed URL on prod" check.

### 6.4 Vault / pgcrypto key (1 secret) — the headline landmine

The encrypted plant-credential columns are pgcrypto-encrypted with a key stored in Supabase
Vault. **Vault secrets cannot be dumped and restored** — each project encrypts its Vault at
rest with a project-unique pgsodium root key, so the ciphertext is meaningless in another
project. The secret must be **re-created on prod with the same plaintext value**:

1. On **dev**, retrieve the plaintext: `select decrypted_secret from vault.decrypted_secrets where name = 'plant_credentials_key';` (sensitive — Vivek runs this).
2. On **prod**, re-create: `select vault.create_secret('<plaintext>', 'plant_credentials_key', '<desc>');`

If this is skipped, every encrypted plant password on prod becomes undecryptable. §8 verifies
by decrypting one credential on prod.

### 6.5 pg_cron jobs (7) — re-created explicitly

pg_cron jobs live in the Supabase-managed `cron` schema and are **not** part of the public
schema dump. They are **paused on dev during the snapshot** (so nothing mutates mid-dump) and
**re-created on prod after restore**. Exact definitions (captured live 2026-06-09):

```sql
select cron.schedule('inverter-create-next-month-partition', '0 3 28 * *',
  $$ SELECT create_inverter_partition_for_month((NOW() + interval '1 month')::date); $$);
select cron.schedule('inverter-rollup-hourly', '17 2 * * *',
  $$ SELECT rollup_inverter_readings_hourly(); $$);
select cron.schedule('inverter-rollup-daily', '22 2 * * *',
  $$ SELECT rollup_inverter_readings_daily(); $$);
select cron.schedule('inverter-drop-old-partitions', '42 3 * * *',
  $$ SELECT drop_old_inverter_partitions(); $$);
select cron.schedule('inverter-auto-tickets', '1 7 * * *',
  $$ SELECT create_service_tickets_from_inverter_alerts(); $$);
select cron.schedule('inverter-oauth-states-cleanup', '17 * * * *',
  $$ SELECT drop_expired_inverter_oauth_states(); $$);
select cron.schedule('lead-activities-create-next-month-partition', '5 3 28 * *',
  $$ SELECT public.create_lead_activities_partition_for_month((NOW() + interval '1 month')::date); $$);
```

The functions these call exist after the schema restore, so re-scheduling is safe.

### 6.6 Out-of-DB configuration

Not in the database — handled as discrete steps:

- **Edge Functions + secrets.** Deploy every function in `supabase/functions/` to prod via the
  Management API PAT (`SUPABASE_ACCESS_TOKEN`, per CLAUDE.md). Set prod edge secrets:
  `FIMER_CRED_*` (×7), `ANTHROPIC_API_KEY`, `OPENAI_EMBEDDINGS_API_KEY`, and any others the
  functions read. (See §7 for the full secret list.)
- **Extensions.** `schema.sql` includes `CREATE EXTENSION` lines, but verify the 6 non-default
  installed extensions are enabled on prod post-restore: `vector`, `pg_cron`, `pgcrypto`,
  `supabase_vault`, `uuid-ossp`, `pg_stat_statements`.
- **n8n.** Repoint the n8n Supabase credential(s) and any hard-coded project URLs from dev → prod.
  The event-bus URL / webhook secret env stay; only the Supabase target changes.
- **Vercel (the user-facing flip).** Swap `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` from dev → prod values, then
  redeploy. This is the moment the team starts using prod.
- **Realtime.** If any feature relies on realtime subscriptions, confirm the `supabase_realtime`
  publication membership on prod (publications are not always carried by a schema dump).

---

## 7. Execution runbook (deferred — run only during the green-lit window)

> Placeholders in `[BRACKETS]` are filled at run time. DB passwords come from
> Dashboard → Database → Connection string. S3 keys come from Storage → S3 Configuration.

### Phase A — Pre-flight (days before; dev stays fully live)

1. **Un-pause prod.** Dashboard → restore the paused `kfkydkwycgijvexqiysc` project. Wait healthy.
2. **Inspect prod & confirm it is disposable.** It was created 2026-03-28 and may hold stale
   partial schema from earlier prod-migration attempts. Confirm no real data:
   ```sql
   -- on PROD
   select count(*) as auth_users from auth.users;
   select count(*) as public_tables from information_schema.tables where table_schema='public';
   ```
   Expect ~0 users and only Supabase-bootstrap content. **If anything real is present, STOP and
   reassess** — do not wipe blindly.
3. **Clean-reset prod to empty** (only after step 2 confirms disposable):
   ```sql
   -- on PROD  ── destructive; gated by step 2
   drop schema if exists public cascade;
   create schema public;
   grant usage on schema public to anon, authenticated, service_role;
   grant all on schema public to postgres, service_role;
   delete from storage.objects;        -- rclone will repopulate
   -- clear any stale prod auth users so dev UUIDs restore cleanly:
   truncate auth.users cascade;
   ```
4. **Deploy edge functions + set prod edge secrets** via the Management API PAT.
5. **Storage pre-sync (the big one).** Configure rclone (below) and copy the 3 non-empty buckets
   live. This warms 16 GB and **proves the storage+metadata path against real prod** before the freeze.
   ```ini
   # ~/.config/rclone/rclone.conf
   [dev]
   type = s3
   provider = Other
   access_key_id = [DEV_S3_KEY]
   secret_access_key = [DEV_S3_SECRET]
   endpoint = https://actqtzoxjilqnldnacqz.storage.supabase.co/storage/v1/s3
   region = ap-northeast-2

   [prod]
   type = s3
   provider = Other
   access_key_id = [PROD_S3_KEY]
   secret_access_key = [PROD_S3_SECRET]
   endpoint = https://kfkydkwycgijvexqiysc.storage.supabase.co/storage/v1/s3
   region = ap-northeast-1
   ```
   ```bash
   for b in site-photos proposal-files project-files; do
     echo "== $b =="; rclone copy "dev:$b" "prod:$b" --progress --transfers 8 --checkers 16
   done
   ```
   Then sanity-check: pick one known object on prod and confirm a signed-URL download works.
6. **Write & dry-run the verification script** (§8) against dev↔dev (or dev↔fresh-prod) so it's
   trusted before the window.

### Phase B — Freeze (~30–60 min; dev write-frozen)

7. **Stop writes to dev:** put the Vercel app in maintenance / pause it; pause n8n workflows;
   unschedule dev pg_cron so no rollup/partition job mutates mid-dump:
   ```sql
   -- on DEV: note jobids, then unschedule (re-schedule after, or just leave dev paused post-cutover)
   select cron.unschedule(jobid) from cron.job;
   ```
8. **Dump from dev:**
   ```bash
   DEV_DB_URL="postgresql://postgres:[DEV_DB_PASSWORD]@db.actqtzoxjilqnldnacqz.supabase.co:5432/postgres"
   supabase db dump --db-url "$DEV_DB_URL" -f roles.sql  --role-only
   supabase db dump --db-url "$DEV_DB_URL" -f schema.sql
   supabase db dump --db-url "$DEV_DB_URL" -f data.sql --use-copy --data-only \
     -x storage.objects -x storage.buckets_vectors -x storage.vector_indexes
   ```
9. **Restore into prod:**
   ```bash
   PROD_DB_URL="postgresql://postgres:[PROD_DB_PASSWORD]@db.kfkydkwycgijvexqiysc.supabase.co:5432/postgres"
   psql \
     --single-transaction \
     --variable ON_ERROR_STOP=1 \
     --file roles.sql \
     --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "$PROD_DB_URL"
   ```
   If `ALTER ... OWNER TO "supabase_admin"` permission errors appear, comment those lines out and
   re-run (documented Supabase behaviour). If a `cli_login_postgres`-type role conflicts, drop it first.
10. **Final storage delta:** re-run the rclone loop from step 5 — only newly-created files copy.
11. **Re-create the vault secret** (§6.4) and **re-create the 7 cron jobs** (§6.5) on prod.
12. **Verify** (§8). **This is the gate.**

### Phase C — Flip (only if §8 is 100% green)

13. Swap Vercel env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
    `SUPABASE_SECRET_KEY`) dev → prod; redeploy.
14. Repoint n8n Supabase credentials → prod; re-activate workflows.
15. Smoke-test on prod (log in, open a project, open a proposal PDF, decrypt a plant credential,
    confirm a dashboard loads). Lift the dev freeze (or retire dev as the live DB).

### Phase D — Rollback (if any check fails)

16. **Do not flip.** Dev is untouched and still live → it remains the source of truth. Wipe prod
    (Phase A step 3), fix the cause, and re-run from Phase B. Zero data loss because nothing ever
    wrote to dev during the process.

---

## 8. Verification — the completeness guarantee

A scripted gate that must be **100% green before the Phase C flip**:

1. **Per-table row-count parity** across all 243 public tables (also `auth`, `storage.buckets`).
   Exact `count(*)` per table on dev and prod, diffed — **any** mismatch blocks the cutover.
   Generate the per-table counts with:
   ```sql
   select string_agg(
     format('select %L as tbl, count(*) as n from %I.%I', table_name, table_schema, table_name),
     E'\nunion all\n')
   from information_schema.tables
   where table_schema in ('public','auth','storage') and table_type='BASE TABLE';
   ```
   Run the generated query on both DBs (via the two connection strings) and diff `tbl,n`.
   (Including `storage` here also cross-checks `storage.buckets`/`storage.objects` row counts
   against rclone's byte parity in check 2.)
2. **Storage parity** — object count + total bytes per bucket must match dev exactly
   (target: site-photos 10,227 · proposal-files 7,646 · project-files 2,342; 16 GB total).
   `rclone size prod:<bucket>` vs `rclone size dev:<bucket>`.
3. **auth.users count = 7** + perform one real login on prod.
4. **Decrypt one plant credential on prod** — proves the vault re-creation (§6.4).
5. **Open one proposal PDF via signed URL on prod** — proves storage bytes + metadata (§6.3).
6. **Run the e2e smoke suite** (`apps/erp/e2e/smoke.spec.ts`) against prod.

A small Node script using the `pg` library and both connection strings should automate checks
1–3 and print a single PASS/FAIL table. Build it in Phase A step 6.

---

## 9. Decisions resolved (so the runbook has no open forks)

| Decision | Resolution | Rationale |
|---|---|---|
| Cutover method | Freeze + dump/restore + rclone | Region-agnostic, lands in existing prod, fully verifiable |
| Separate rehearsal project | No | Safety comes from read-only-dev + storage pre-sync + the hard parity gate instead |
| Replay migrations vs dump live | Dump live | Captures real dev state incl. drift; prod == dev guaranteed |
| JWT secret | Prod keeps its own | Security; 7 re-logins is negligible |
| Auth users | Migrate with original UUIDs | Preserves all `created_by`/`assigned_to` FKs |
| Storage mechanism | rclone S3 only; exclude `storage.objects` from SQL | Avoids metadata double-insert collision |
| `n8n-backups` bucket | Skip | Dev artifact, not business data |
| Vault secret | Re-create on prod with same plaintext | Vault ciphertext is project-bound, non-portable |

---

## 10. Open items to confirm at run time (not blockers, just checks)

- Confirm `supabase db dump --data-only` on the installed CLI version carries the `auth` schema;
  if not, add the explicit `--schema=auth` dump (§6.2).
- Confirm whether any feature depends on Realtime publications; re-create membership if so (§6.6).
- Re-measure storage size on the morning of the window (it grows daily) to size the freeze delta.
- Decide dev's fate post-cutover: keep as sandbox (re-schedule its cron) or leave paused.

---

## 11. Deliverables & where this lives

- This spec: `docs/superpowers/specs/2026-06-09-dev-to-prod-migration-design.md` (design + runbook in one).
- Flagged **deferred** in `docs/CURRENT_STATUS.md` and logged in `docs/CHANGELOG.md`.
- Memory: [[project_dev_to_prod_migration]].
- When Vivek schedules the window, lift §7 into a live checklist and execute top-to-bottom.
