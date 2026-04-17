# Liaison Module

> CEIG clearance (Tamil Nadu Chief Electrical Inspectorate General), TNEB / DISCOM net metering applications, and document/objection tracking for every grid-connected solar project. Owned by marketing post-revamp; PM sees it read-only from the project stepper.
> Related modules: [projects](./projects.md) (stepper step #9), [sales](./sales.md) (marketing owns liaison). Cross-cutting references: master reference §4 (CEIG rule), §7 (DB spine).

## Overview

Every grid-connected Shiroi project eventually needs a net metering connection with TNEB (TANGEDCO), and systems ≥10 kWp need a CEIG electrical safety clearance before TNEB will accept the application. The liaison module tracks that regulatory pipeline — from the moment the application is created through CEIG approval, DISCOM submission, net meter installation, and final activation. A DB trigger (`enforce_ceig_block`, migration 006c / fixed in 007e) hard-blocks DISCOM status advancement until `ceig_status = 'approved'` whenever `ceig_required = TRUE`. Ownership shifted to the marketing team in the April 15 marketing+design revamp (migration 052): `marketing_manager` now holds full CRUD on `net_metering_applications`; `project_manager` is SELECT-only so Manivel can see progress from the project stepper but cannot edit.

## Routes / Screens

- `/liaison` — dashboard. 4 summary cards (Total / Pending CEIG / Pending Net Meter / CEIG Approved) + navigation card to the full list.
- `/liaison/net-metering` — 7-column table across all applications: Project, Application #, DISCOM, Application Date, CEIG Status, Net Meter Status, Current Stage. Rows link to detail.
- `/liaison/net-metering/[projectId]` — per-project detail with full CEIG / TNEB / document / objection panels.
- **`/projects/[id]` → Liaison stepper step (#9)** — same workflow bar + cards, via `StepLiaison`. When `viewerRole === 'project_manager'`, `readOnly={true}` is passed (see `apps/erp/src/app/(erp)/projects/[id]/page.tsx` line 183) — the whole panel is `pointer-events-none` with an amber banner explaining marketing owns it.

## User Flow / Workflow Bar

A 6-stage visual progress bar at the top of the stepper step (`deriveWorkflowStages` in `step-liaison.tsx`):

1. **Application Created** — `net_metering_applications` row inserted via `LiaisonCreateButton`
2. **CEIG Clearance** — shown only when `showCeig` is true (see rule below). `ceig_status: pending → applied → inspection_scheduled → approved`
3. **TNEB Applied** — `discom_status` moved off `pending` / `not_started`
4. **TNEB Approved** — `discom_status IN ('approved', 'net_meter_installed', 'activated')`
5. **Meter Installed** — `net_meter_installed = true`
6. **Activated** — `discom_status = 'activated'`

**CEIG visibility rule (same as projects module gotcha #5):**
```
showCeig = application.ceig_required
        || (sizeKwp >= 10 && systemType !== 'off_grid')
```
So on-grid and hybrid ≥10 kWp show the CEIG card; off-grid never does. Threshold is `>=` not `>` (TN regulatory cutoff).

**CEIG scope toggle** (`CeigScopeToggle`, migration 045): `ceig_scope ∈ {'shiroi', 'client'}`. When the client handles CEIG themselves, Manivel/marketing flip the toggle to `client` — the CEIG card collapses to a "CEIG managed by Client" card and the status form hides. Setting scope to `shiroi` also sets `ceig_required = TRUE`.

## Key Tables

- **`net_metering_applications`** (one-per-project, UNIQUE on `project_id`, from migration 004d):
  - Identity: `id`, `project_id` FK, `managed_by` → employees
  - CEIG: `ceig_required`, `ceig_scope` (`shiroi`|`client`, migration 045), `ceig_status` (`not_applicable, pending, applied, inspection_scheduled, approved, rejected, reapplied`), `ceig_application_date`, `ceig_inspection_date`, `ceig_approval_date`, `ceig_certificate_number`, `ceig_approval_storage_path`, `ceig_rejection_reason`
  - DISCOM/TNEB: `discom_name` (default `'TNEB'`), `discom_status` (`pending, applied, under_review, site_inspection_scheduled, approved, net_meter_installed, rejected, objection_raised`), `discom_application_date`, `discom_application_number`
  - Meter: `net_meter_installed`, `net_meter_installed_date`, `net_meter_serial_number`, `net_meter_sanction_path`
  - Follow-ups: `last_followup_date`, `next_followup_date`, `followup_count`, `notes`
  - Indexes: `project_id`, `discom_status`, partial on `next_followup_date WHERE discom_status NOT IN ('net_meter_installed', 'approved')`
- **`liaison_documents`** — 10 `document_type` values: `application_form, single_line_diagram, load_calculation, ownership_proof, eb_bill, ceig_certificate, discom_sanction, net_meter_installation, objection_response, other`. `status: draft | submitted | accepted | rejected | resubmitted`. `storage_path` is `UNIQUE`, files live in **`project-files` bucket**.
- **`liaison_objections`** — objection tracking with `objection_source` (`ceig, tneb, discom_field, municipal`) + `objection_type` (8 values including `document_missing, load_calculation_error, capacity_mismatch`), `response_submitted`/`response_date`, `resolved`/`resolved_date`, `days_open`. Inserting an objection auto-flips `discom_status` → `objection_raised`.
- **`activities` + `activity_associations`** — reused for the inline "Notes & Activity Log" (via `addLiaisonActivity`, same HubSpot-style timeline as sales).

## Key Files

```
apps/erp/src/app/(erp)/liaison/
  page.tsx                                      ← dashboard (4 summary cards)
  net-metering/page.tsx                         ← application list
  net-metering/[projectId]/page.tsx             ← per-project detail

apps/erp/src/components/liaison/
  net-metering-detail.tsx                       ← detail panel reused by the per-project page

apps/erp/src/components/projects/stepper-steps/
  step-liaison.tsx                              ← 6-stage workflow bar + CEIG/DISCOM/Meter/Followup/Docs/Activity cards; accepts readOnly prop

apps/erp/src/components/projects/forms/
  liaison-form.tsx                              ← 9 client components:
                                                   LiaisonCreateButton, DiscomStatusForm, CeigStatusForm,
                                                   CeigScopeToggle, NetMeterForm, FollowupForm,
                                                   LiaisonFieldEditor (click-to-edit), LiaisonDocUpload,
                                                   LiaisonActivityForm

apps/erp/src/lib/
  liaison-actions.ts                            ← 9 server actions: createNetMeteringApplication,
                                                   updateCeigStatus, updateDiscomStatus,
                                                   updateNetMeterInstallation, recordFollowup,
                                                   uploadLiaisonDocument, addLiaisonActivity,
                                                   updateLiaisonFields, updateCeigScope, createObjection
  liaison-queries.ts                            ← dashboard + list queries
  project-stepper-queries.ts::getStepLiaisonData ← parallelized fetch for StepLiaison (project + application + documents)
```

## Business Rules & Gotchas

1. **CEIG gate — hard DB block.** `enforce_ceig_block` trigger (migration 006c → fixed in 007e to use `ceig_status != 'approved'`) on `BEFORE UPDATE OF net_metering_applications`. When `ceig_required = TRUE` and `ceig_status != 'approved'`, any attempt to move `discom_status` off `'pending'` raises `CEIG clearance required before TNEB submission`. `updateDiscomStatus` catches this and returns a friendly error. **Do not work around it.** If you genuinely need to bypass (e.g. client-handled CEIG where Shiroi doesn't have the cert), set `ceig_scope = 'client'` — `updateCeigScope` sets `ceig_required = FALSE` in the same UPDATE, which disarms the trigger.
2. **CEIG applies to on-grid + hybrid ≥10 kWp, NOT off-grid.** This was backwards in an earlier version (see projects module gotcha #5). Always use `sizeKwp >= 10 && systemType !== 'off_grid'`.
3. **PM read-only after migration 052.** RLS on `net_metering_applications` grants `marketing_manager` + `founder` full ALL, and `project_manager` + `finance` SELECT only. The UI enforces the same via `readOnly` on `StepLiaison` — the whole panel is `pointer-events-none` with the amber banner. If a PM can suddenly edit, check both the prop and the policy.
4. **`updateCeigStatus` side-effect.** When `ceig_status = 'approved'`, the action also sets `projects.ceig_cleared = true` + `ceig_cleared_at = now()`. Keep that in sync if you refactor.
5. **Follow-up counter.** `recordFollowup` reads current `followup_count`, increments in app code, and writes back — there's no SQL atomic. Don't expect race-safe concurrent increments.
6. **Objection cascade.** `createObjection` inserts into `liaison_objections` AND flips `discom_status → 'objection_raised'` in the same action. Resolve the objection → caller must bump `discom_status` back manually.
7. **Document upload bucket.** Goes to **`project-files`** bucket (same as the projects documents tab, NOT `site-photos`). `liaison_documents.storage_path` is globally `UNIQUE` — uploading a file with the same generated path twice will fail; `LiaisonDocUpload` generates paths including a timestamp.

## Recent Changes

- **Migration 045** — added `ceig_scope` (`shiroi`|`client`) to `net_metering_applications` + `engineer_signature_path` to `commissioning_reports` (unrelated, same migration).
- **Liaison V2 (April 11)** — full rebuild of the stepper step: 6-stage visual workflow bar, click-to-edit fields (`LiaisonFieldEditor` wraps dates, application #s, certificate #s with inline save), follow-up form with auto-increment counter, document upload across 10 types, activities-backed notes log.
- **Migration 052 (April 15 marketing+design revamp)** — rehomed liaison ownership. `marketing_manager` got full write on `net_metering_applications`; `project_manager` downgraded to SELECT-only. `step-liaison.tsx` gained the `readOnly` prop and `projects/[id]/page.tsx` computes `liaisonReadOnly = viewerRole === 'project_manager'` at render.
- **Migration 007e (March 29)** — fixed the CEIG block trigger; original referenced a nonexistent `ceig_cleared` column. Correct check is `NEW.ceig_status != 'approved'`.

## Past Decisions & Specs

- `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md` — the broader marketing+design revamp spec that rehomed liaison to marketing.
- `docs/superpowers/plans/` — marketing+design revamp plan (April 15) + category-standardisation.

## Related Migrations

- **004d** — `net_metering_applications`, `liaison_documents`, `liaison_objections` schema + indexes + initial RLS
- **006c** — `enforce_ceig_block` trigger (initial, buggy column ref)
- **007e** — CEIG trigger fix (`ceig_status != 'approved'`)
- **045** — `ceig_scope` column (shiroi|client)
- **052** — RLS rehoming: `marketing_manager` write, `project_manager` read-only

## Role Access Summary

| Role | Access |
|---|---|
| `marketing_manager` (Prem) | Full CRUD on `net_metering_applications`, `liaison_documents`, `liaison_objections`; drives the workflow end-to-end |
| `founder` | Full access everywhere |
| `project_manager` (Manivel) | **SELECT-only** on `net_metering_applications` post-052; sees the liaison step from `/projects/[id]` in read-only mode |
| `finance` | SELECT-only (to reconcile CEIG/TNEB fees against vouchers) |
| `customer` | SELECT on own project's application via customer app (future) |
