# O&M Module

> Post-commissioning operations: service tickets, AMC contracts + visits, plant monitoring, inverter telemetry (in progress).
> Related modules: [projects] (Commissioning → syncs plant monitoring creds, triggers AMC scheduling), [finance] (service_amount on tickets, paid AMC invoicing).

## Overview

O&M is the post-handover side of the system — everything that happens after a project reaches `commissioning_reports.status IN ('submitted', 'finalized')`. On that transition, a DB trigger upserts plant monitoring credentials and the PM creates the first Free AMC contract (3 scheduled visits auto-seeded from the warranty period). Service tickets cover ad-hoc support and SLA-tracked incident response, with auto-creation wired to commissioning IR test failures and (soon) inverter telemetry anomalies. Plant monitoring today is a credential vault + portal link registry; migration 050 laid the full inverter telemetry foundation (partitioned readings, pg_cron rollups, auto-ticket scan) which will go live once Sungrow/Growatt API registration completes.

## Screens / Routes

- `/om/visits` — scheduled + past visits
- `/om/tickets` — service ticket list (TKT-NNN format, padStart 3 digits)
  - 12-column table: Ticket #, Project, Title, Issue Type, Severity, Status, Assigned To, Service Amount, Created, SLA Due, Resolved By, Actions
  - Inline status toggle (6 statuses: open/assigned/in_progress/resolved/closed/escalated — auto-sets `resolved_at`/`resolved_by`, `closed_at`)
  - Edit dialog, Delete (soft via status=closed)
  - Filters: status, severity, issue_type, engineer, project, search
- `/om/amc` — contract-centric AMC table
  - 9 columns: Project Name clickable, Category Free/Paid, Scheduled Visits X/Y expandable, Status Open/Closed toggle, Next AMC Date, Completed Date, Notes, Actions, Report
  - Create AMC: Free = auto-creates 3 visits, Paid = prompts duration/visits/amount
  - `AmcVisitTracker` per-contract expandable sub-table with inline status + edit panel (work done, issues, resolution, customer feedback, report file upload to `project-files` bucket)
- `/om/plant-monitoring` — credential storage + future inverter live data
  - 3 summary cards (total, per-brand, missing credentials)
  - Sticky filter bar (project combobox / brand / search) — project filter is a searchable combobox, not a plain select
  - 7-col table: Project, Brand, Username, Password (30s auto-remask + copy), Portal Link, Created, Actions
  - Add/Edit/Delete dialogs (founder + project_manager only; om_technician read-only)
  - Add dialog: project picker is a searchable combobox with ↑↓/Enter/Esc keyboard nav, "Create a new project →" link when no match
  - Auto-sync from `commissioning_reports` on status transition via DB trigger

## Key Business Rules

- **Ticket numbering**: `TKT-001`, `TKT-002` via `String(parseInt(...)).padStart(3, '0')` (migration 043).
- **SLA**: critical severity = 4h (IR test failure creates auto-ticket).
- **Service ticket auto-creation**:
  - IR reading < 0.5 MΩ on commissioning → DB trigger creates critical ticket (4h SLA).
  - Inverter alert scan (daily pg_cron): `PR < 0.70` OR `offline > 60min` OR `fault > 0` → creates TKT-NNN with 7-day dedup window (migration 050, `create_service_tickets_from_inverter_alerts()`).
- **AMC categories**: `free_amc` (warranty — 3 visits auto) / `paid_amc` (customer-purchased with duration/visits/amount).
- **Plant monitoring credential sync**: `fn_sync_plant_monitoring_from_commissioning()` triggers on `commissioning_reports` UPDATE when `status` becomes `submitted`/`finalized` AND all three monitoring fields are non-null. Upserts via `ON CONFLICT (project_id, portal_url)` so re-submissions refresh, don't duplicate.
- **Brand auto-detection**: `plant_monitoring_detect_brand(TEXT)` IMMUTABLE function classifies portal URL into sungrow / growatt / sma / huawei / fronius / solis / other via lowercase substring match.
- **No physical DELETE** on `plant_monitoring_credentials` — soft delete via `deleted_at`.

## Key Tables

- `om_service_tickets` (TKT-NNN, `service_amount NUMERIC(14,2)`, `closed_at`, `resolution_notes`)
- `om_contracts` (`amc_category`, `amc_duration_months`, `annual_value`)
- `om_visit_schedules` (`scheduled_date`, `visit_number`, `status`)
- `om_visit_reports` (`work_done`, `issues_identified`, `resolution_details`, `customer_feedback`, `completed_by`, `report_file_paths TEXT[]`)
- `plant_monitoring_credentials` (multi-entry-per-project, soft delete, partial unique `(project_id, portal_url) WHERE deleted_at IS NULL`)
- **Inverter telemetry** (migration 050):
  - `inverters` (master: 6-brand CHECK, `polling_interval_minutes`, `current_status`)
  - `inverter_monitoring_credentials` (vault secret refs only, never raw)
  - `inverter_readings` + `inverter_string_readings` (**PARTITIONED monthly by `RANGE(recorded_at)`**)
  - `inverter_readings_hourly` + `inverter_readings_daily` (rollup tables — frontend queries these, **never** raw)
  - `inverter_poll_failures` (audit log)

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

- `learning_modules` (title, body_md, category, target_role, difficulty CHECK, onboarding_track CHECK, quiz_questions JSONB, pass_score_pct)
- `learning_progress` (employee_id, module_id, sent_at, completed_at, quiz_score, passed; UNIQUE per employee+module)
- `onboarding_progress` (employee_id, onboarding_track, modules_total/completed/passed, completion_pct; UNIQUE per employee+track)
- 5 seed modules: Solar Panel Safety, Inverter Installation (Tamil), Customer Communication, EHS Emergency Response, Basic Electrical Safety
- Admin UI for learning modules and onboarding progress: **pending** (tables and seed data exist)

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
