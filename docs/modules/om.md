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

## Past Decisions & Specs

- Migration 043 (`service_amount`, `closed_at` on tickets)
- Migration 044 (`amc_category`, `amc_duration_months`, visit-level fields)
- Migration 050 (inverter telemetry infrastructure — declarative partitioning + pg_cron + auto-ticket scan)
- Migration 059 (Plant Monitoring credentials, detection helper, commissioning sync trigger, summary RPC)
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
