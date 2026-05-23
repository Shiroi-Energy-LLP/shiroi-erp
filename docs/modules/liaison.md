# Liaison Module

> CEIG clearance (Tamil Nadu Chief Electrical Inspectorate General), TNEB / DISCOM net metering applications, and document/objection tracking for every grid-connected solar project. Owned by marketing post-revamp; PM sees it read-only from the project stepper.
> Related modules: [projects](./projects.md) (stepper step #9), [sales](./sales.md) (marketing owns liaison). Cross-cutting references: master reference §4 (CEIG rule), §7 (DB spine).

## Overview

Every grid-connected Shiroi project needs a net metering connection with TNEB (TANGEDCO), and systems ≥10 kWp need a CEIG electrical safety clearance before TNEB will accept the application. The liaison module tracks that regulatory pipeline — from NMA creation through CEIG approval, TNEB application, inspection, demand note, meter installation, and service effected. A DB trigger (`enforce_ceig_block`, migration 006c / fixed in 007e) hard-blocks DISCOM status advancement until `ceig_status = 'approved'` whenever `ceig_required = TRUE`. Ownership: `marketing_manager` (Prem) has full CRUD; `project_manager` (Manivel) is SELECT-only and sees liaison from the project stepper.

**`ceig_scope`** lives on `projects` (migration 115). Manivel sets it at order entry — not Prem. When `ceig_scope = 'client'`, `ceig_required` is set to FALSE on NMA creation and the CEIG panel collapses.

## Routes / Screens

- `/liaison` — unified page: 5 clickable summary cards (Total / Awaiting Client / CEIG Pending / CEIG In Process / TNEB Active) + polished TNEB-vocabulary table. Each card appends `?filter=<key>` to filter the table.
- `/liaison/net-metering` — redirects to `/liaison`.
- `/liaison/net-metering/[projectId]` — per-project detail with full CEIG / TNEB / document / objection panels.
- **`/projects/[id]` → Liaison stepper step (#9)** — workflow bar + cards, via `StepLiaison`. When `viewerRole === 'project_manager'`, `readOnly={true}` — whole panel is `pointer-events-none` with an amber banner.

## User Flow / Workflow Bar

8-stage progress bar (`deriveWorkflowStages` in `step-liaison.tsx`); CEIG step shown only when `showCeig` is true:

1. **Application Created** — NMA row inserted
2. **CEIG Clearance** — shown when `project.ceig_scope === 'shiroi' && sizeKwp >= 10 && systemType !== 'off_grid'`
3. **Applied** — `discom_status !== 'pending'`
4. **Verified** — `discom_status IN ('tneb_verified', 'tneb_inspected', 'tneb_estimated', 'installation_completed', 'service_effected')`
5. **Inspected** — `discom_status IN ('tneb_inspected', 'tneb_estimated', 'installation_completed', 'service_effected')`
6. **Estimated** — `discom_status IN ('tneb_estimated', 'installation_completed', 'service_effected')`
7. **Installation Completed** — `discom_status IN ('installation_completed', 'service_effected')`
8. **Service Effected** — `discom_status = 'service_effected'`

## Key Tables

- **`net_metering_applications`** (one-per-project, UNIQUE on `project_id`, from migration 004d):
  - Identity: `id`, `project_id` FK, `managed_by` → employees
  - CEIG: `ceig_required`, `ceig_status` (`not_applicable, pending, applied, inspection_scheduled, approved, rejected, reapplied`), `ceig_application_date`, `ceig_inspection_date`, `ceig_approval_date`, `ceig_certificate_number`, `ceig_approval_storage_path`, `ceig_rejection_reason`
  - DISCOM/TNEB: `discom_name` (default `'TANGEDCO'`), `discom_status` (`pending, applied, tneb_verified, tneb_inspected, tneb_estimated, installation_completed, service_effected, rejected, objection_raised`), `discom_application_date`, `discom_application_number`
  - Awaiting client: `awaiting_client_details BOOLEAN NOT NULL DEFAULT FALSE`, `awaiting_client_since TIMESTAMPTZ NULL`, `awaiting_client_note TEXT NULL`; partial index on `awaiting_client_details = TRUE`
  - Meter: `net_meter_installed`, `net_meter_installed_date`, `net_meter_serial_number`, `net_meter_sanction_path`
  - Follow-ups: `last_followup_date`, `next_followup_date`, `followup_count`, `notes`
- **`projects.ceig_scope`** (`shiroi`|`client`, migration 115) — set by Manivel at project entry. `'shiroi'` = Shiroi handles CEIG; `'client'` = client handles, `ceig_required` set to FALSE on NMA creation and CEIG panel collapses.
- **`liaison_documents`** — 10 `document_type` values: `application_form, single_line_diagram, load_calculation, ownership_proof, eb_bill, ceig_certificate, discom_sanction, net_meter_installation, objection_response, other`. `storage_path` is `UNIQUE`, files in **`project-files` bucket**.
- **`liaison_objections`** — `objection_source` (`ceig, tneb, discom_field, municipal`) + `objection_type` (8 values). Inserting an objection auto-flips `discom_status → 'objection_raised'`.
- **`activities` + `activity_associations`** — HubSpot-style timeline via `addLiaisonActivity`.

## Key Files

```
apps/erp/src/app/(erp)/liaison/
  page.tsx                                      ← unified page: 5 summary cards + TNEB table (filter via ?filter=)
  net-metering/page.tsx                         ← redirect to /liaison
  net-metering/[projectId]/page.tsx             ← per-project detail

apps/erp/src/components/liaison/
  liaison-status-badge.tsx                      ← TnebStageBadge, CeigStageBadge, AwaitingClientBadge
  awaiting-client-toggle.tsx                    ← AwaitingClientToggle (mark/resolve awaiting-client flag)
  net-metering-detail.tsx                       ← detail panel

apps/erp/src/components/projects/stepper-steps/
  step-liaison.tsx                              ← 8-stage workflow bar; readOnly prop for PM

apps/erp/src/components/projects/forms/
  liaison-form.tsx                              ← LiaisonCreateButton, DiscomStatusForm, CeigStatusForm,
                                                   NetMeterForm, FollowupForm, LiaisonFieldEditor,
                                                   LiaisonDocUpload, LiaisonActivityForm

apps/erp/src/lib/
  liaison-actions.ts                            ← createNetMeteringApplication (auto-computes ceig_required),
                                                   updateCeigStatus, updateDiscomStatus,
                                                   updateNetMeterInstallation, recordFollowup,
                                                   uploadLiaisonDocument, addLiaisonActivity,
                                                   updateLiaisonFields, setAwaitingClientDetails,
                                                   createObjection
  liaison-queries.ts                            ← getNetMeteringApplication, getLiaisonDocuments,
                                                   getLiaisonObjections, getAllNetMeteringApplications
                                                   (accepts LiaisonFilter: all|awaiting_client|ceig_pending|
                                                   ceig_in_process|tneb_active)
  liaison-summary-queries.ts                    ← getLiaisonSummary() → get_liaison_summary() RPC (5 counts)
  project-stepper-queries.ts::getStepLiaisonData ← fetches project (including ceig_scope) + application + documents
```

## Business Rules & Gotchas

1. **CEIG gate — hard DB block.** `enforce_ceig_block` trigger (migration 007e) on `BEFORE UPDATE OF net_metering_applications`. When `ceig_required = TRUE` and `ceig_status != 'approved'`, any attempt to move `discom_status` off `'pending'` raises `CEIG clearance required before TNEB submission`. `updateDiscomStatus` catches this and returns a friendly error. **Do not work around it.** To bypass legitimately, set `projects.ceig_scope = 'client'` via the project detail — this sets `ceig_required = FALSE` on NMA creation (it does NOT retroactively update an existing NMA; if already created, directly update `ceig_required = FALSE` via `updateLiaisonFields`).
2. **CEIG applies to on-grid + hybrid ≥10 kWp, NOT off-grid.** Always `sizeKwp >= 10 && systemType !== 'off_grid'`.
3. **`ceig_scope` is on `projects`, NOT `net_metering_applications`** (post migration 115). Read it from `project.ceig_scope`. NMA auto-sets `ceig_required` at creation time using `ceig_scope + system_size_kwp + system_type` from the parent project.
4. **PM read-only.** `project_manager` has SELECT-only on `net_metering_applications`. The UI enforces this via `readOnly` on `StepLiaison`.
5. **`updateCeigStatus` side-effect.** When `ceig_status = 'approved'`, also sets `projects.ceig_cleared = true` + `ceig_cleared_at = now()`.
6. **Awaiting-client flag is orthogonal.** A project at `tneb_inspected` can simultaneously have `awaiting_client_details = TRUE`. It's a blocking flag, not a status.
7. **Follow-up counter.** `recordFollowup` increments `followup_count` in app code — no SQL atomic. Not race-safe.
8. **Objection cascade.** `createObjection` inserts into `liaison_objections` AND flips `discom_status → 'objection_raised'`. Resolving requires manually bumping `discom_status` back.
9. **Document upload bucket.** Goes to **`project-files`** bucket. `liaison_documents.storage_path` is globally `UNIQUE` — `LiaisonDocUpload` appends `Date.now()` to avoid collisions.
10. **`get_liaison_summary()` RPC** (migration 115) returns 5 BIGINTs in one query — use it for the `/liaison` summary cards. Never aggregate in JS (NEVER-DO #12).

## Recent Changes

- **Migration 115 (May 23, 2026)** — TNEB vocabulary rename, `ceig_scope` moved to `projects`, `awaiting_client_*` columns, `get_liaison_summary()` RPC. See spec `2026-05-23-liaison-tneb-redesign-design.md`.
- **Migration 052 (April 15 marketing+design revamp)** — rehomed liaison ownership. `marketing_manager` full write; `project_manager` SELECT-only.
- **Liaison V2 (April 11)** — stepper step rebuild: 8-stage workflow bar, click-to-edit fields, follow-up form, document upload, activities log.
- **Migration 045** — original `ceig_scope` added to `net_metering_applications` (now moved to `projects` in mig 115).
- **Migration 007e (March 29)** — fixed CEIG block trigger.

## Past Decisions & Specs

- `docs/superpowers/specs/2026-05-23-liaison-tneb-redesign-design.md` — TNEB vocabulary + awaiting-client + ceig_scope migration + unified page redesign.
- `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md` — broader marketing+design revamp that rehomed liaison to marketing.

## Related Migrations

- **004d** — `net_metering_applications`, `liaison_documents`, `liaison_objections` schema + indexes + initial RLS
- **006c** — `enforce_ceig_block` trigger (initial, buggy column ref)
- **007e** — CEIG trigger fix (`ceig_status != 'approved'`)
- **045** — original `ceig_scope` on `net_metering_applications` (moved to `projects` in 115)
- **052** — RLS rehoming: `marketing_manager` write, `project_manager` read-only
- **115** — TNEB vocabulary rename, `ceig_scope` → `projects`, awaiting-client columns, `get_liaison_summary()` RPC

## Role Access Summary

| Role | Access |
|---|---|
| `marketing_manager` (Prem) | Full CRUD on `net_metering_applications`, `liaison_documents`, `liaison_objections`; drives the workflow end-to-end |
| `founder` | Full access everywhere |
| `project_manager` (Manivel) | **SELECT-only** on `net_metering_applications`; sets `ceig_scope` on `projects` at order entry |
| `finance` | SELECT-only (to reconcile CEIG/TNEB fees against vouchers) |
| `customer` | SELECT on own project's application via customer app (future) |
