# O&M Module

> Post-commissioning operations: service tickets, AMC contracts + visits, plant monitoring, inverter telemetry (in progress).
> Related modules: [projects] (Commissioning → syncs plant monitoring creds, triggers AMC scheduling), [finance] (service_amount on tickets, paid AMC invoicing).

## Overview

O&M is the post-handover side of the system — everything that happens after a project reaches `commissioning_reports.status IN ('submitted', 'finalized')`. On that transition, a DB trigger upserts plant monitoring credentials and the PM creates the first Free AMC contract (3 scheduled visits auto-seeded from the warranty period). Service tickets cover ad-hoc support and SLA-tracked incident response, with auto-creation wired to commissioning IR test failures and (soon) inverter telemetry anomalies. Plant monitoring today is a credential vault + portal link registry; migration 050 laid the full inverter telemetry foundation (partitioned readings, pg_cron rollups, auto-ticket scan) which will go live once Sungrow/Growatt API registration completes.

## Screens / Routes

- `/om/visits` — scheduled + past visits
- `/om/tickets` — service ticket list (ticket numbers still mint internally as TKT-NNN but are **no longer displayed** — column removed 2026-06-11 per Vivek; `created_at` auto-records and shows as Created)
  - **9-column table (trimmed 2026-06-27, mig 199):** Project, **Title (links to `/om/tickets/[id]`)**, Issue Type, Assigned To, Status, Created, **Done By** (= `resolved_by`), **Amount (₹)**, Actions. Severity + SLA Due columns dropped from the list (severity still fully editable in the form + shown on the detail page).
  - **3 KPI cards (2026-06-27):** Open Services / Closed Services / Total Service Amount, from `get_service_ticket_kpis()` (one SQL call: Open = status NOT IN (resolved,closed), Closed = IN (resolved,closed), plus `SUM(service_amount)`). Replaced the standalone Total-Amount header stat (`get_service_ticket_amount_total()` RPC retained for back-compat).
  - Inline status toggle (6 statuses: open/assigned/in_progress/resolved/closed/escalated — auto-sets `resolved_at`/`resolved_by`, `closed_at`)
  - Edit dialog (quick edit), **Delete = hard DELETE (2026-06-27)** behind a confirm — permanently removes the ticket, cascades `om_ticket_events`, best-effort `project-files` Storage cleanup; needs the new `tickets_delete` RLS policy (founder/PM/om_technician). Closing a ticket stays a *status* via the inline toggle.
  - Filters: **project (dedicated autosearch combobox `TicketProjectFilter` → `?project=`, added 2026-06-27)**, status, issue_type, engineer, and a **live search box** that filters the table as you type — matches ticket title / free-text `project_name_custom` / the linked project's customer + number (uses the shared `matchProjectIdsByText` helper over `search_projects_lite`). (The severity filter was dropped 2026-06-27 alongside the column.)
  - Create dialog: project picked via the searchable `ProjectCombobox` (customer – project name, number badge) — replaced the plain dropdown 2026-06-11
  - **Detail page `/om/tickets/[id]` (2026-06-27, mig 199):** opened from the Title. Header (ticket #, status toggle, meta grid incl. severity/SLA/done-by/amount) + hard-delete. Three sections: (1) **all-fields edit panel** (`TicketEditPanel` → `updateServiceTicket`, now also accepts project reassignment + status, logs a system event summarising changed fields); (2) **Supporting Documents** — ticket-level multi-file upload (`attachment_paths`/`attachment_names TEXT[]` on `om_service_tickets`); (3) **Work Progress & Activity** — a combined reverse-chron timeline from `om_ticket_events` (`entry_type ∈ note|system`): manual notes (each with an optional single file) interleaved with auto system events (create / status change / edits / doc add). Composer at top; system rows are non-deletable, manual notes are. All mutations `revalidatePath` both `/om/tickets` and `/om/tickets/[id]` so list + detail stay in sync. Files live in `project-files` (client-side upload + short-lived signed-URL view via `AttachmentLink`). Shared option lists/label maps live in `lib/ticket-constants.ts` (client-safe, no server imports — NEVER-DO #21).
  - **2026-06-16 (mig 183):** closed/resolved rows are no longer struck-through/dimmed — the inline status badge already reads "Closed" (the `line-through`/`opacity-50` was removed). Tickets can be raised against a **free-text project name** (Service/AMC/misc not in the projects list): `project_id` is nullable with a `project_name_custom` fallback (CHECK one-of-two); the create dialog uses `ProjectCombobox.allowCustom` and the list shows the custom label when there's no linked project.
- `/om/amc` — contract-centric AMC table
  - 9 columns: Project Name clickable, Category Free/Paid, Scheduled Visits X/Y expandable, Status Open/Closed toggle, Next AMC Date, Completed Date, Notes, Actions, Report
  - Create AMC: Free = auto-creates 3 visits, Paid = prompts duration/visits/amount; project picked via `ProjectCombobox` (2026-06-11 — keeps the Free→commissioned-only list switch + commissioned-date autofill)
  - `AmcVisitTracker` per-contract expandable sub-table with inline status + edit panel (work done, issues, resolution, customer feedback, report file upload to `project-files` bucket)
- `/om/plant-monitoring` — credential storage + future inverter live data
  - 3 summary cards (total, per-brand, missing credentials)
  - Sticky filter bar (project combobox / brand / search) — project filter is a searchable combobox, not a plain select
  - 7-col table: Project, Brand, Username, Password (30s auto-remask + copy), Portal Link, Created, Actions
  - Add/Edit/Delete dialogs (founder + project_manager only; om_technician read-only)
  - Add dialog: project picker is a searchable combobox with ↑↓/Enter/Esc keyboard nav, "Create a new project →" link when no match
  - Auto-sync from `commissioning_reports` on status transition via DB trigger
  - **Encryption (mig 158, 2026-06-06):** `password` column replaced with `password_encrypted BYTEA` encrypted via `extensions.pgp_sym_encrypt` using a Vault-stored AES-256 key `plant_credentials_key`. Reads go through `search_plant_monitoring_credentials` RPC (decrypts server-side, role-gated to founder/PM/om_tech); writes go through `upsert_plant_monitoring_credential` RPC (encrypts server-side). Growatt Edge Function poller reads via `get_growatt_creds_for_project` RPC (service_role only).
- `/om/import-review` — staging review for historical-plant XLSX backfill (added 2026-06-06)
  - Tabs: Pending · Approved · Rejected · Imported · Errors
  - 4 summary cards (Pending review, Already-in-DB exact, Likely fuzzy, Imported)
  - Sticky filter bar: match confidence × source status × year × portal brand × search
  - Per-row card: project name + status badge + year + size + match-confidence badge + portal-brand badge + multi-inverter cluster badge + Source breadcrumb
  - Click-to-expand reveals full detail (hardware, financial, location, portal creds, local LAN, internet+datalogger, AMC schedule, remarks, import error)
  - Per-row Approve / Reject buttons; multi-select with floating Bulk Approve bar (sequential not parallel — keeps `SHIROI/PROJ/LEGACY/NNNN` sequence safe)
  - All 4 password fields (portal, local-admin, local-user, jio) shown with 30s reveal pattern (same `PlantMonitoringPasswordCell` UX, but per-row, in-place)
  - Cluster expansion shows the N sub-inverters that will be created as part of the cascade
  - **Approval cascade** (founder/PM only, atomic transaction): stub lead → stub proposal (`SHIROI/QT/LEGACY/NNNN`, status='draft') → projects (`SHIROI/PROJ/LEGACY/NNNN`, status='completed', commissioned_date set, completion_pct=100, contracted_value from source) → flip proposal to accepted (existing `trigger_proposal_accepted_create_project` idempotency check skips on existing project for the lead) → parent inverter row + child rows from `parent_import_id` lookup → plant_monitoring_credentials (encrypted) → plant_local_setup (encrypted). EXCEPTION handler marks the row `status_review='error'` with SQLERRM. Imported rows persist in the Imported tab with link to the new project.
  - **Reject** sets `status_review='rejected'` with optional `rejection_reason`; preserves row for audit.

## Key Business Rules

- **Ticket numbering**: `TKT-001`, `TKT-002` via `String(parseInt(...)).padStart(3, '0')` (migration 043).
- **SLA**: critical severity = 4h (IR test failure creates auto-ticket).
- **Service ticket auto-creation**:
  - IR reading < 0.5 MΩ on commissioning → DB trigger creates critical ticket (4h SLA).
  - Inverter alert scan (daily pg_cron): `PR < 0.70` OR `offline > 60min` OR `fault > 0` → creates TKT-NNN with 7-day dedup window (migration 050, `create_service_tickets_from_inverter_alerts()`).
- **AMC categories**: `free_amc` (warranty — 3 visits auto) / `paid_amc` (customer-purchased with duration/visits/amount).
- **Plant monitoring credential sync**: `fn_sync_plant_monitoring_from_commissioning()` triggers on `commissioning_reports` UPDATE when `status` becomes `submitted`/`finalized` AND all three monitoring fields are non-null. Upserts via `ON CONFLICT (project_id, portal_url)` so re-submissions refresh, don't duplicate.
- **Inverter reading timestamp guard (2026-06-09)**: `inverter_readings` is monthly RANGE-partitioned with **no default partition**, so a vendor-supplied `recorded_at` outside the live months — e.g. a datalogger whose clock is frozen in the past or set ahead — would hard-error the upsert (`no partition of relation ... found for row`) and silently drop the reading. The poller clamps any timestamp >1h future / >36h past to poll time via `clampRecordedAt` (`packages/inverter-adapters/src/base.ts`, mirrored inline in the `inverter-poll` Edge Function); the raw vendor value is retained in `raw_payload`. **Do not add a `_default` partition** — out-of-range rows in it would block the monthly `create_inverter_partition_for_month` cron. First offender: plant VJHRE4U02Q (Block-E Radiance), frozen at `2026-02-03` → flagged for an O&M site check.
- **Brand auto-detection**: `plant_monitoring_detect_brand(TEXT)` IMMUTABLE function classifies portal URL into sungrow / growatt / sma / huawei / fronius / solis / other via lowercase substring match.
- **No physical DELETE** on `plant_monitoring_credentials` — soft delete via `deleted_at`.

## Key Tables

- `om_service_tickets` (TKT-NNN, `service_amount NUMERIC(14,2)`, `closed_at`, `resolution_notes`; `attachment_paths`/`attachment_names TEXT[]` for ticket-level docs — mig 199)
- `om_ticket_events` (mig 199 — combined detail-page timeline: `entry_type` note|system, `body`, optional `attachment_path`/`attachment_name`, `created_by` → employees; FK `ticket_id` ON DELETE CASCADE; index `(ticket_id, created_at DESC)`; RLS read founder/PM/om_tech/finance, insert+delete founder/PM/om_tech)
- `om_contracts` (`amc_category`, `amc_duration_months`, `annual_value`)
- `om_visit_schedules` (`scheduled_date`, `visit_number`, `status`)
- `om_visit_reports` (`work_done`, `issues_identified`, `resolution_details`, `customer_feedback`, `completed_by`, `report_file_paths TEXT[]`)
- `plant_monitoring_credentials` (multi-entry-per-project, soft delete, partial unique `(project_id, portal_url) WHERE deleted_at IS NULL`; `password_encrypted BYTEA` post-mig-158)
- `pending_project_imports` (staging — 60+ fields incl. encrypted portal/local/Jio passwords; parent rows + child rows for multi-inverter clusters; status_review enum pending/approved/rejected/imported/error; unique on `normalized_name` for active parents; mig 159)
- `plant_local_setup` (per-plant operational: LAN admin/user creds encrypted, Jio modem password encrypted + 2 SIMs, data logger MAC + PK, ACDB/DCDB SN; one row per project unique; mig 160)
- **Inverter telemetry** (migration 050):
  - `inverters` (master: 6-brand CHECK, `polling_interval_minutes`, `current_status`; `project_id` made nullable in mig 157 so monitoring-only inverters discovered via vendor portals can exist before being mapped to a Shiroi project)
  - `inverter_monitoring_credentials` (vault secret refs only, never raw)
  - `inverter_readings` + `inverter_string_readings` (**PARTITIONED monthly by `RANGE(recorded_at)`**)
  - `inverter_readings_hourly` + `inverter_readings_daily` (rollup tables — frontend queries these, **never** raw)
  - `inverter_poll_failures` (audit log)

## FIMER / ABB Aurora Vision integration (live 2026-06-05)

- **Auth: per-account API key + portal user/pass.** Aurora Vision REST v1 (`https://api.auroravision.net/api/rest`). `GET /authenticate` with HTTP Basic (portal username:password) + `X-AuroraVision-ApiKey` header → response `{result: "<token>"}`. Token used as `X-AuroraVision-Token` header on subsequent calls; 60-minute idle expiry. Tokens cached per `monitoring_credentials_id` for the poll cycle.
- **7 master/sub-accounts as of 2026-06-05** (8th `soapplant_solar` deferred — no paired portal password):
  - `shiroienergy` (master, Manivel) — 12 plants (Chemfab Pondicherry x5, Schangalaya x3, Mountmeru Rwanda x2, Sricity x2). FYI: Mountmeru's EIDs return 403 with this key — the plant is actually owned by a separate `Mountmeru_Solar` account whose key we don't yet have.
  - `chemfabalkalis` — Chemfab Alkalis SS_110 KWp (separate sub-account, EID 16151321).
  - `edisonschool` — Edison School_48 KWp (Chidambaram).
  - `harsha`, `bossshyam`, `siddharth`, `sriramsv` — 4 small residentials (1–4 kW each). Each authenticates but `/v1/device/?serialNumber=` returned no devices for their serials on 2026-06-05; EIDs need manual lookup from the Aurora Vision portal before they can be polled.
- **Endpoints wired:**
  - `GET /v1/stats/power/aggregated/{eid}/GenerationPower/average?startDate=&endDate=&timeZone=Asia/Kolkata` → `{result: {units: "watts", value: 7164.9}}` (instantaneous average over the date window).
  - `GET /v1/plant/{eid}/dailyProduction?startDate=&endDate=` → `{result: {dailyValues: [{date: "YYYYMMDD", value: "95.952"}, ...]}}` (kWh/day).
  - **3-day window** for both (1-day window returns `{units:"watts"}` with no value because today's aggregate isn't finalized until end-of-day). Energy endpoint picks the most recent day with a numeric value — today's row is usually empty.
  - `monitoring_site_id` holds the plant entityID; `monitoring_device_id` unused (telemetry is plant-level, not per-device, for the metrics surfaced).
  - 403 = entity not owned by the authenticated account (NOT 404). That's why a master-account key can't see Mountmeru.
- **Credential storage:** `inverter_monitoring_credentials.vault_secret_ref = 'FIMER_CRED_<SLUG>'`, which names a Deno env var holding JSON `{api_key, username, password}`. The Edge Function reads `Deno.env.get(vault_secret_ref)`, JSON.parses, and uses it. `config.account_slug` + `config.account_username` are kept on the row for display.
- **Discovery + seed script:** `scripts/fimer-seed-inverters.ts` reads `scripts/data/fimer-plants-2026-06-05.json` (committable — entity-IDs + serials + locations, no secrets) and `scripts/data/fimer-credentials-2026-06-05.tsv` (gitignored — paired keys + users + passwords); upserts the 7 credential rows; authenticates each account; would discover missing EIDs via `/v1/device/?serialNumber=` (returned nothing for 4 small plants); fuzzy-matches plant names to projects; idempotently upserts into `inverters`. Run with `--dry-run` first, then `--apply`. `--skip-discovery` bypasses the per-serial API calls if rate-limited.
- **Local smoke:** `pnpm tsx scripts/fimer-poll-once.ts` — end-to-end against live API, same code path as the deployed Edge Function. Confirmed 9 of 14 inverters returning real telemetry on 2026-06-05: Schangalaya_25 7.2 kW, Schakaralaya_50 14.3 kW, Schangalay_50 15.3 kW, Chemfab RO_23 6.6 kW, Chemfab DP_11.5 3.8 kW, Chemfab SP_11.5 3.2 kW, Sricity_110 19.3 kW, Sricity_115 16.5 kW, Edison_48 13.6 kW.
- **Scheduling:** the n8n workflow `60-inverter-poll-cron.json` (every 5 min, 05–19:55 IST) drives all brands incl. FIMER. **Two prerequisites the cron alone does NOT satisfy** (both bit us 2026-06-06 — see Known Gotchas): (1) the `inverter-poll` Edge Function must be **deployed** with the `fimer` dispatch branch — a stale deploy silently treats `fimer` as an unsupported brand and skips it (0 readings, 0 failures); (2) the `FIMER_CRED_*` secrets must be set in **Supabase Dashboard → Edge Functions → Secrets** (not just `.env.local`), else the branch warns "env var … not set; skipping". For the current fleet only 3 are referenced: `FIMER_CRED_SHIROIENERGY` (12 inv), `FIMER_CRED_CHEMFABALKALIS` (1), `FIMER_CRED_EDISONSCHOOL` (1).
- **Secrets (updated 2026-06-08):** Most ABB plants were **sold** — Chemfab (Alkalis Pondicherry ×6 + Sricity Andhra ×2), Schangalaya ×2, Schakaralaya ×1, Mountmeru ×2 are all `polling_enabled=false`. **Edison School_48 (eid 24213751) is the only polled ABB plant**, so the only secret that matters now is `FIMER_CRED_EDISONSCHOOL`. **Correction to the old "Dashboard-only / CLI 403-locked" note:** a *full-scope* Supabase **Personal Access Token** CAN set Edge secrets via the Management API (`POST /v1/projects/{ref}/secrets` → 201). The 403 applied only to the old `supabase login` CLI token, which lacked org privileges. The PAT (`shiroi-erp-mgmt`) is in `.env.local` as `SUPABASE_ACCESS_TOKEN`; run `scripts/set-fimer-edge-secrets.ts --apply` to set the needed secrets (DB-driven, values read from `.env.local`). Future secret/deploy ops can use this token directly instead of the Dashboard.
- **Legacy `13.126.111.104` wrapper API: dead.** Old links.docx had a custom Node/Express wrapper at that AWS IP; host unreachable as of 2026-06-05. The direct Aurora Vision REST API replaces it entirely.

## Sungrow integration (live 2026-06-05, app 2883)

- **Auth: direct login** (`/openapi/login` with username + RSA-encrypted password) — Manivel's `manivel@shiroienergy.com` master account owns all 14 Shiroi-commissioned plants. One login per poll cycle, token reused across all Sungrow inverters in the batch (no token persisted to DB). OAuth redirect flow is still wired (`/api/integrations/sungrow/authorize` + `/callback`) but is for future customer-owned plants, not Shiroi-owned ones.
- **Sungrow's misleading labels** — in the developer dashboard, "AppKey" goes in the request **body** as `appkey`, but the `x-access-key` HTTP header takes the **SecretKey**. Putting AppKey in the header yields `E912 Illegal x-access-key`. The adapter + Edge Function were both wrong on this from 2026-05-23 through 2026-06-05.
- **`monitoring_device_id` stores Sungrow's composite `ps_key`** (`{ps_id}_{device_type}_{device_code}_{chnnl_id}`, e.g. `1818786_1_2_1`), not the bare serial number. The adapter detects underscores and routes to `ps_key_list` vs `sn_list` accordingly. The serial number stays in `inverters.serial_number` separately.
- **Point IDs** wired in the adapter: `p83022` (active power kW), `p83025` (today energy kWh), `p83033` (total energy kWh), `p83020` (DC power kW), `p83036` (grid freq Hz), `p83097` (temperature °C). Our current app tier (2883) returns **metadata + status only** — point values come back empty, so power/energy fields persist as NULL until Sungrow approves a higher tier. The `dev_status` field is populated (mapped to `active`/`fault`/`offline`/`derated`/`unknown`) so fault + offline tickets still fire via `create_service_tickets_from_inverter_alerts()`.
- **Discovery + seed script:** `scripts/sungrow-seed-inverters.ts` lists all plants + their inverters, fuzzy-matches plant names to existing projects (token-Jaccard + substring affinity, threshold 0.35), and idempotently upserts into `inverters`. Run with `--dry-run` first, then `--apply`. Unmatched plants get `project_id=NULL` for O&M to re-assign later.
- **Local smoke test:** `pnpm tsx scripts/sungrow-ping.ts` (login + list plants + first device realtime fetch) and `pnpm tsx scripts/sungrow-poll-once.ts` (full poll loop bypassing the Edge Function).
- **Scheduling:** n8n workflow `60-inverter-poll-cron.json` POSTs to `${SUPABASE_URL}/functions/v1/inverter-poll` every 5 min (Asia/Kolkata).
- **Secrets:** the Edge Function reads `SUNGROW_APPKEY`, `SUNGROW_SECRET`, `SUNGROW_USERNAME`, `SUNGROW_PASSWORD`, `SUNGROW_RSA_PUBLIC_KEY`, `SUNGROW_BASE_URL` from the Supabase Edge Functions secrets store (not from `.env.local` — those are for local scripts only). Must be set via Supabase Dashboard → Edge Functions → Secrets; the local Supabase CLI is 403-locked on Vivek's account for this op, same as for type-gen.
- **Auth (cron → function):** the function is deployed with `verify_jwt=false` because Supabase's new `sb_secret_*` keys aren't valid JWTs. The function does its own check inside: `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` must match — matching the process-document Edge Function pattern. The n8n credential `d4DMha1ex7q95fw8` ("Supabase service role") sends that Bearer value. If `verify_jwt=true` is left on after a redeploy, n8n calls return `Authorization failed - please check your credentials` and the cron fails every 5 min.
- **Cron schedule:** workflow #60 fires `*/5 5-19 * * *` Asia/Kolkata — every 5 min from 05:00 to 19:55 IST only. Skipping night hours saves ~108 wasteful API calls/day per inverter (`17 × 108 = 1836` calls/day saved) and avoids the "everything offline" noise that would otherwise mark every inverter `current_status=unknown` overnight. If/when Sungrow webhook subscriptions are wired up, this can drop to one daily poll.
- **n8n URL:** the workflow JSON hardcodes `https://actqtzoxjilqnldnacqz.supabase.co/functions/v1/inverter-poll`. The earlier `={{ $env.SUPABASE_URL }}` expression failed because the n8n droplet doesn't have `SUPABASE_URL` set in its environment. When the prod project is wired up, fork the workflow (or move the URL into n8n env at the droplet level).
- **Webhook subscription (future):** Sungrow's developer portal offers "Webhook message subscription" — push events for new plants / device online/offline / faults / token expiry. Worth implementing on top of polling (not replacement): real-time fault alerts vs the current ≤5-min poll lag, plus lower API quota. Would land as `POST /api/integrations/sungrow/webhook` route + Sungrow developer-portal subscription config. Deferred — polling is sufficient today.

## Key Files

```
apps/erp/src/app/(erp)/om/
  visits/page.tsx
  tickets/page.tsx
  amc/page.tsx
  plant-monitoring/page.tsx

apps/erp/src/lib/
  amc-actions.ts               (createAmc, updateVisitStatus, rescheduleVisit,
                                assignVisitEngineer, uploadVisitReport — 8 actions total)
  amc-queries.ts               (getAllAmcData with client-side visit-count grouping)
  service-ticket-actions.ts    (updateServiceTicket, updateTicketStatus, deleteServiceTicket)
  ticket-queries.ts            (getAllTickets paginated)
  plant-monitoring-actions.ts + plant-monitoring-queries.ts

apps/erp/src/components/forms/
  project-combobox.tsx               (pure controlled searchable combobox; used in plant-monitoring Add dialog)

apps/erp/src/components/om/
  ticket-status-toggle.tsx, edit-ticket-dialog.tsx
  amc-visit-tracker.tsx, amc-status-toggle.tsx, create-amc-dialog.tsx
  plant-monitoring-password-cell.tsx   (eye toggle + 30s auto-remask + copy)
  project-filter-combobox.tsx          (URL-aware wrapper around ProjectCombobox for plant-monitoring filter bar)

packages/inverter-adapters/    (workspace package)
  base.ts        (InverterAdapter interface, NormalizedReading, error classes,
                  syntheticReading generator)
  sungrow.ts, growatt.ts, sma.ts, huawei.ts   (per-brand stubs)
  factory.ts

supabase/functions/inverter-poll/   (Deno Edge Function)
  Calls get_inverters_due_for_poll(100) → dispatches adapters →
  upserts readings → updates health → logs failures
```

## Inverter Telemetry Architecture (Migration 050)

**Built but awaiting live API credentials. `SYNTHETIC_INVERTER_READINGS=1` env produces test data.**

- **Partitioning**: `inverter_readings` + `inverter_string_readings` are `PARTITIONED` monthly by `RANGE(recorded_at)`. 6 partitions pre-created at migration time.
- Service-role-only `INSERT` on readings tables (app code physically can't mass-write).
- **8 plpgsql/SQL functions**:
  - `get_inverters_due_for_poll(batch_limit)` — dispatcher picker
  - `create_inverter_partition_for_month()`
  - `rollup_inverter_readings_hourly()` / `_daily()` (recompute last 2 days for late-arriving data)
  - `drop_old_inverter_partitions()` (90-day retention, safety-checked against rollup health)
  - `create_service_tickets_from_inverter_alerts()` (daily scan, auto-ticket creation)
- **5 pg_cron schedules**:
  - `0 3 28 * *` — monthly partition creator
  - `17 2 * * *` — hourly rollup
  - `22 2 * * *` — daily rollup
  - `42 3 * * *` — 90-day retention
  - `1 7 * * *` — auto-ticket scan

## Known Gotchas

- Plant Monitoring: `Textarea` isn't exported from `@repo/ui`, use plain `<textarea>` with matching classes.
- AMC project filter only shows projects with AMC contracts (`getProjectsWithAmc` query).
- Service ticket project filter only shows projects with tickets (`getProjectsWithTickets` on `om_service_tickets` FK alias `om_service_tickets_project_id_fkey`).
- Inverter readings: **never** query `inverter_readings` directly from the frontend. Use `inverter_readings_daily` or `_hourly` rollups. Rule #16 (time-series = partitioning + rollup).
- **n8n cron "fires but does nothing" (2026-06-06):** in a Schedule-Trigger workflow, `connections` is keyed by the source node's **name**. Rename the trigger node and the key silently stops matching → the trigger fires (execution = `success`) but no downstream node runs (`started==stopped`, instantaneous). Diagnose via the **n8n execution log** (`GET /api/v1/executions?workflowId=` with `X-N8N-API-KEY`), not the cron expression — timezone is almost never the cause. `scripts/debug-n8n-inverter-cron.ts` dumps live config + executions.
- **Edge Function deploy drift:** the deployed `inverter-poll` can lag the repo (Supabase CLI is 403-locked, so deploys are manual via MCP `deploy_edge_function` and easy to forget). A broken cron hides this — the function never runs, so missing branches/fixes stay invisible. Compare deployed vs repo with `get_edge_function`. Always deploy with **`verify_jwt=false`** (the function does its own `Authorization: Bearer <SERVICE_ROLE_KEY>` check; `true` 401s the n8n cron).
- **Out-of-range `recorded_at` → insert fails:** `inverter_readings` is range-partitioned by month; a reading whose `recorded_at` (e.g. a device's stale or future `last_update_time`) falls outside every existing partition throws `no partition of relation "inverter_readings" found for row`. Pre-create partitions (pg_cron) or clamp `recorded_at` to a sane window.
- Commissioning finalization triggers plant monitoring sync + first AMC contract creation (`free_amc`, auto 3 visits).

## Phase E Intelligence Layer (Migrations 125–128)

### E9 — Milestone Photos (`milestone_photos` table, migration 127)

- `milestone CHECK IN ('panel_install_start','panel_install_complete','inverter_install','commissioning','post_commissioning')`
- `latitude NUMERIC(10,7)` + `longitude NUMERIC(10,7)` + `location_verified BOOLEAN` + `location_distance_m NUMERIC(10,2)`
- `haversine_distance_m(lat1, lon1, lat2, lon2) RETURNS NUMERIC` IMMUTABLE SQL function
- `uploadMilestonePhoto` action: validates GPS via RPC, uploads to `documents` bucket at `milestone-photos/{project_number}/{milestone}/{uuid}.ext`, records verification result
- `getMissingMilestones`: returns which of the 5 milestones have no photo yet for a project

### E10 — Customer Outreach Queue (`customer_outreach_queue` table, migration 127)

- Tracks AI-generated post-commissioning check-in messages (90/180/270/365 days)
- `status CHECK IN ('pending','message_generated','sent','failed')`
- `generateCustomerCheckinsForWeek` server action: queries projects at milestone intervals, generates Claude message, emits `customer_checkin.due` event
- n8n workflow `30-customer-checkin.json`: event-triggered Meta Graph API WhatsApp dispatch
- **VIVEK ACTION**: set `META_PHONE_NUMBER_ID` + `META_WHATSAPP_TOKEN` in n8n

### E11 — BOM Actual vs Budgetary (`bom_actual_vs_budgetary` table, migration 128)

- Per-project per-category tracking of budgetary vs actual quantities and costs
- `category CHECK IN ('panels','inverter','mounting_structure','dc_cable','ac_cable','earthing','la_system','accessories','other')`
- Separate from the existing `bom_correction_factors` table (that's for org-wide ratios; this is per-project actuals)

### E12 — O&M Profitability (`/om/profitability`, migration 128)

- `get_om_profitability(p_start_date DATE, p_end_date DATE)` SQL RPC — aggregates per-project ticket counts, parts cost, service revenue, SLA compliance
- `/om/profitability` page: accessible to founder + om_technician; KPI strip (total tickets, revenue, parts cost, net profit, avg SLA); per-project table with profit/loss colour coding and SLA badge
- Reads via `apps/erp/src/lib/om-profitability-queries.ts` (no R15 violation)

### E13/E14 — Microlearning Engine (migrations 128)

**E13 (learning_modules) + E14 (onboarding_progress) — schema only; no admin UI; no learner UI; not surfaced anywhere in the app today.** Tables exist (mig 128) + 5 seed modules inserted. Surfacing requires a future build.

- `learning_modules` (title, body_md, category, target_role, difficulty CHECK, onboarding_track CHECK, quiz_questions JSONB, pass_score_pct)
- `learning_progress` (employee_id, module_id, sent_at, completed_at, quiz_score, passed; UNIQUE per employee+module)
- `onboarding_progress` (employee_id, onboarding_track, modules_total/completed/passed, completion_pct; UNIQUE per employee+track)
- 5 seed modules: Solar Panel Safety, Inverter Installation (Tamil), Customer Communication, EHS Emergency Response, Basic Electrical Safety
- No routes exist for E13/E14. No admin can create/edit modules. No employee can view or complete modules. The n8n daily-question WhatsApp delivery (9am) described in `hr.md` uses the older `training_questions` + `employee_question_progress` stack (spaced repetition), which is separate from the `learning_modules` schema here.

## Phase F additions (May 2026)

### F1 — Customer drip sequences (`customer_message_log` + 8 n8n workflows)
**Migration 129** added `customer_message_log` (id, project_id FK, channel TEXT, template_name TEXT, recipient_phone TEXT, status, failed_reason, sent_at, wamid). The original migration shipped **without RLS**, exposing customer phone numbers + message content. **Mig 134** added the missing policies — read for `founder` / `marketing_manager` / `om_technician`, ALL for `service_role` (n8n inserts via service-role JWT).

Eight n8n workflows (`infrastructure/n8n/workflows/40-customer-proposal-sent.json` through `47-customer-commissioning-complete.json`) wire ERP events to Meta WhatsApp templates. Each Send + Log node has `continueOnFail: true` so a delivery failure still creates an audit row with `status='failed'` and `failed_reason` populated — good observability. Workflows are **inactive on the droplet** until the 8 customer-facing templates in `infrastructure/n8n/templates.md` get Meta approval (F2 verification is now done, unblocking submission).

**Side note from the 2026-05-24 review**: 5 of 8 workflows reference events that aren't in `00-event-bus-router.json` AND that ERP code never emits via `emitErpEvent`. The router needs Switch cases for `lead.won` / `net_metering.application_submitted` / `project.milestone_complete` and the matching `emitErpEvent` call sites need to be wired up before activation. Tracked as a follow-up; not blocking template submission.

## Phase E intelligence-layer review fixes (mig 134, 2026-05-24)

- **`customer-outreach-actions.ts`** was previously callable by any authenticated user — it used `createAdminClient()` directly without a role gate. Now requires `founder` or `om_technician` role before the admin client is reached. Also fixed `projects.commissioned_at` → `projects.commissioned_date` (the actual column name; `commissioned_at` only exists on `inverters` from mig 050). And the inline `fetch(N8N_EVENT_BUS_URL, ...)` was swapped for the canonical `emitErpEvent('customer_checkin.due', ...)` helper to get the 3-second timeout + typed event name (new event added to `ErpEventName` union).
- **`project-daily-report.ts`** Phase E action was schema-blind — `daily_site_reports.work_completed/panels_installed/inverters_installed/wiring_completed/manpower_count` didn't exist (the real columns are `work_description`, `panels_installed_today`, `structure_progress`, `electrical_progress`, `workers_count + supervisors_count`), `project_tasks` was renamed to `tasks` in mig 007f, `project_milestones.name` should be `milestone_name` and `completed_at` should be `actual_end_date`, and `expenses` needs a join through `expense_categories` for the category label. All rewritten against real schema.
- **`process-document` Edge Function** at `supabase/functions/process-document/index.ts` — review flagged that the idempotency check rejects only `'done'` but flips to `'processing'` without a worker_id, so concurrent invocations both pass the check and both burn Anthropic + OpenAI quota. **Open** — not fixed in this batch.

## Past Decisions & Specs

- Migration 043 (`service_amount`, `closed_at` on tickets)
- Migration 044 (`amc_category`, `amc_duration_months`, visit-level fields)
- Migration 050 (inverter telemetry infrastructure — declarative partitioning + pg_cron + auto-ticket scan)
- Migration 059 (Plant Monitoring credentials, detection helper, commissioning sync trigger, summary RPC)
- Migration 125 (`extracted_at` + `extraction_status` on `documents`)
- Migration 126 (`claimed_at` + `processed_at` + `retry_count` on `zoho_sync_queue`)
- Migration 127 (`milestone_photos` + `haversine_distance_m()` + `customer_outreach_queue`)
- Migration 128 (`bom_actual_vs_budgetary` + `get_om_profitability` RPC + `learning_modules` + `learning_progress` + `onboarding_progress`)
- `docs/superpowers/specs/2026-04-16-plant-monitoring-design.md`
- `docs/superpowers/plans/2026-04-16-plant-monitoring.md`
- `docs/superpowers/specs/2026-04-17-plant-monitoring-project-combobox-design.md` (searchable project picker, no migration)
- `docs/superpowers/plans/2026-04-17-plant-monitoring-project-combobox.md`
- Inverter adapter package: see `packages/inverter-adapters/base.ts`

## Role Access Summary

- **om_technician**: full CRUD on `om_visits`, `om_service_tickets`, `om_visit_reports`. Read on `om_contracts`, `plant_monitoring_credentials`.
- **project_manager**: full CRUD on `om_contracts`, `plant_monitoring_credentials` (from commissioning handoff).
- **founder**: full access.
- **customer**: read-only on own tickets + AMC (customer app — future).
