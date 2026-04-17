# Projects Module

> 12-stage project lifecycle driven by the PM. Covers BOI (multi-version, lockable), BOQ (budget analysis), Delivery Challans, Execution (10 milestones, tasks), Actuals (voucher tracking), QC (7-section structured form), Commissioning (string-level tests, signatures), and Documents.
> Related modules: [purchase](./purchase.md) (BOQ → vendor POs), [liaison](./liaison.md) (CEIG step), [finance](./finance.md) (voucher approvals, invoicing). See also master reference §7.

## Overview

A project is spawned automatically when a proposal is accepted — the `create_project_from_accepted_proposal` trigger fires on `proposals.status = 'accepted'` and writes a new row into `projects`. Winning a lead cascades through `trg_mark_proposal_accepted_on_lead_won` (migration 055) into the same trigger, so Marketing never has to touch projects directly. From that point forward Manivel (the PM) drives a 12-stage stepper: Details → Survey → BOI → BOQ → Delivery → Execution → Actuals → QC → Liaison → Commissioning → Free AMC → Documents. BOI and Actuals are immutable-once-locked (`boi_locked`, `actuals_locked`) to stop post-facto budget drift. The BOQ step hands off to Purchase (`Send to Purchase` bulk-updates BOQ items from `yet_to_finalize` → `yet_to_place`), Liaison owns CEIG + TNEB, Actuals routes vouchers through Finance, and Commissioning triggers a plant-monitoring credential sync. The final Documents tab is the single pane of glass the customer, O&M, and finance all pull from.

## Project Status Enum

Migration 031 collapsed 11→8 statuses:

`order_received`, `yet_to_start`, `in_progress`, `completed`, `holding_shiroi`, `holding_client`, `waiting_net_metering`, `meter_client_scope`

Status is editable in-place in the `ProjectHeader` dropdown. Change is audited through `log_project_status_change` (which looks up `employees.id` via `profile_id = auth.uid()` — see migration 031).

## Stepper (12 stages)

### 1. Details

Editable boxes on the Details tab:
- **FinancialBox** — role-gated (PM / founder / finance / marketing). Contracted value, actual BOQ total, approved site expenses, margin %.
- **SystemConfigBox** — size (kWp), type (`on_grid` / `off_grid` / `hybrid`), mounting (`elevated` / `low_raise` / `minirail` / `long_rail` / `customized`), panel / inverter / battery / cable brand+model, `scope_la` / `scope_civil` / `scope_meter` (`shiroi` | `client`), remarks.
- **CustomerInfoBox** — debounced contact picker → `primary_contact_id` FK, site + billing address, Google Maps link.
- **TimelineTeamBox** — 6 date fields (order_date, planned_start, etc.) + PM + site_supervisor dropdowns.

### 2. Survey

Full survey form (~1,191 LOC, split per CLAUDE.md rule #14 into 5 modules under `components/projects/forms/survey-form/`). ~25 fields including GPS, roof details, electrical, shading, signatures, and 16+ photo fields (stored in site-photos bucket). PDF via `@react-pdf/renderer` at `GET /api/projects/[id]/survey`.

### 3. BOI (Bill of Items)

Multi-version BOI (BOI-1, BOI-2, ...) with `draft → submitted → approved → locked` workflow (migration 036). `boi_id` FK on `project_boq_items`. 14 Manivel-curated categories. Inline add/delete for draft BOIs only; once locked, a new BOI-N can be created. Prepared-by / approved-by / locked-by attribution displayed per version.

At the bottom of the BOI step: **Estimated Site Expenses (General)** — single `EditableField` over `projects.estimated_site_expenses_budget` (migration 034). This is the baseline for BOQ margin calc + Actuals variance.

### 4. BOQ (Bill of Quantities — Budget Analysis)

5-card summary: Project Cost, Material Budget, Site Expenses, Total Outflow, Final Margin %. Category-wise breakdown with subtotals (excl / incl GST) in a 12px-font compact table. Two action buttons:
- **Send to Purchase** — bulk updates items `yet_to_finalize → yet_to_place`; feeds `/procurement/project/[id]`.
- **Auto-Price from Price Book** — 4-strategy layered matching in `applyPriceBookRates` (`project-step-actions.ts`): (1) normalized-exact (whitespace+punct strip, lowercase), (2) substring either direction, (3) Jaccard token overlap ≥0.3, (4) single-candidate fallback when category has exactly one entry.

BOQ quantity is inline-editable (double-click cell, auto-recalculates `total_price`). Marking "BOQ Complete" sets `boq_completed` on the project.

### 5. Delivery (Delivery Challans)

A DC is a ship-to-site docket. PM selects items from the "Ready to Dispatch" pool, sets quantities per DC (partial ships allowed), and attaches transport details (vehicle, driver). Ship-To auto-fills from project site address.

DC PDF via `@react-pdf/renderer` at `GET /api/projects/[id]/dc/[dcId]` — Shiroi company header with GSTIN, DC-001/002 sequential numbering, 4-col item table (S.No / Item Description / HSN Code / Quantity), T&C section, Engineer + Client signature lines. Status flow: `draft → dispatched → delivered`.

### 6. Execution (10 milestones + tasks)

Milestones come from `execution_milestones_master` (migration 042) — a lookup table replacing the old CHECK constraint:

1. Material Delivery
2. Structure Installation
3. Panel Installation
4. Electrical Work
5. Earthing Work
6. Civil Work
7. Testing & Commissioning
8. Net Metering
9. Handover
10. Follow-ups

11-col task table per project: Task Name, Milestone, Assigned To, Assigned Date, Status (Open/Closed inline toggle), Priority, Due Date, Notes, Done By, Activity Log (expandable row), Actions. Per-milestone completion % auto-calculated from task completion ratio. Planned / Actual milestone dates editable. Tasks without a `milestone_id` appear in a separate "Other Tasks" group so nothing is invisible.

### 7. Actuals

`VoucherTable` with category filter and inline edit on pending rows. Vouchers live in `project_site_expenses` with `status` in `pending / approved / rejected / auto_approved`. Submit / approve / reject happen in `/vouchers` (the cross-project approval queue — owned by finance + founder + PM).

BOQ quantity is editable by PM here (click-to-edit). Lock mechanism: `actuals_locked` + `actuals_locked_at` + `actuals_locked_by` on `projects` (migration 038). Locking makes BOI / BOQ / Actuals read-only; a pending-voucher warning gates the lock action. Margin color coding: green ≥15%, amber ≥5%, red <5%.

### 8. QC

Structured "Solar System Quality Check Form" (migration 039). 7 sections × 26 Yes/No items + per-item Remarks:

| Section | Items |
|---|---|
| Panel Installation | 4 |
| Structure & Mounting | 4 |
| Electrical Wiring | 4 |
| Inverter | 4 |
| Earthing & Protection | 3 |
| Battery (if applicable) | 4 |
| Safety | 3 |

Project Details section at top is auto-populated (project name, location, client, system size/type) + editable (installation date, checked_by, inspection_date). Photo upload per section — stored in **site-photos** bucket (not project-files) at `projects/{id}/qc/{sectionId}_{timestamp}.{ext}`. Final Approval: `Approved` or `Rework Required`. QC PDF at `GET /api/projects/[id]/qc/[inspectionId]`.

IR test auto-ticket: IR reading < 0.5 MΩ on a commissioning or O&M visit → DB trigger auto-creates a critical service ticket with 4h SLA (see master reference §7.9).

### 9. Liaison

CEIG Clearance (≥10 kWp, non-off-grid) → TNEB Application → Net Meter Installation → Activation. Visual step-by-step workflow bar, click-to-edit fields (dates, application numbers, certificate numbers), follow-up form, document upload (10 types), activity log via `activities` table.

**Scope toggle** (migration 045): `ceig_scope = 'shiroi' | 'client'`. When client handles liaison, the CEIG card hides and a "Managed by Client" card shows instead. When Marketing owns liaison (`marketing_manager` role), PM view is read-only (`step-liaison.tsx` accepts a `readOnly` prop).

### 10. Commissioning

Multi-string electrical test table (Inverter No / String No / Vmp / Isc / Polarity Check) stored as JSONB in `string_test_data` (migration 040). Monitoring portal link + login + password (feeds Plant Monitoring module via `fn_sync_plant_monitoring_from_commissioning` trigger on status → submitted/finalized). Performance Ratio %. Engineer + client digital signatures captured via `SignaturePad` (HTML5 Canvas) and stored in project-files bucket under `signatures/`; the PDF embeds actual signature images.

Status: `draft → submitted → finalized`. `finalized` locks the report.

### 11. Free AMC

Auto-creates 3 scheduled visits on first AMC contract of type `free_amc`. Free AMC typically covers months 1 / 6 / 12 post-commissioning. See [om.md](./om.md) for full AMC module (V4, contract-centric table).

### 12. Documents

12 category boxes as separate Cards: Customer Documents, Site Photos (auto-rotating slideshow), AutoCAD/Design, Layouts/Designs, Purchase Orders, Invoices, Delivery Challans, Warranty Cards, Excel/Costing, Documents/Approvals, SESAL, General.

Drag-and-drop recategorization uses Supabase Storage `.move()` — which is an UPDATE on `storage.objects` under the hood (see **gotcha #2**). Auto-populated DC / QC / Survey PDFs via `GeneratedDocRow`. WhatsApp photos surface via site-photos bucket under `projects/{id}/whatsapp/`. Lead files from `proposal-files` bucket are also shown (for projects that came through the sales funnel).

## Key Tables

- `projects` — 8-status enum, `boi_locked`, `boq_completed`, `actuals_locked`, `ceig_scope`, `estimated_site_expenses_budget`, scope_la/civil/meter, cable brand/model, billing_address, location_map_link, order_date, primary_contact_id
- `project_bois` — multi-version BOI (migration 036)
- `project_boq_items` — `boi_id` FK, `hsn_code`, `vendor_id` FK for purchase routing
- `project_site_expenses` — voucher workflow (migration 033): `voucher_number`, `expense_category`, `status`, `submitted_by/at`, `approved_by/at`, `rejected_reason`, `receipt_file_path`
- `project_milestones` — links to `execution_milestones_master`
- `project_tasks` / `tasks` — universal entity model (`entity_type + entity_id`)
- `delivery_challans` + `delivery_challan_items` — with `hsn_code` (migration 037)
- `qc_gate_inspections` — checklist JSONB includes `photos[]`, `project_info`, `approval_status`
- `net_metering_applications` — `ceig_scope`, `ceig_required`
- `commissioning_reports` — `string_test_data` JSONB, `monitoring_portal_*`, `performance_ratio_pct`, `engineer_signature_path`
- `execution_milestones_master` — the 10 milestones (migration 042)

## Key Files

```
apps/erp/src/app/(erp)/projects/
  page.tsx                    ← list with 8-status filter
  [id]/page.tsx               ← detail with 12-stage stepper

apps/erp/src/components/projects/
  detail/project-stepper.tsx
  detail/project-header.tsx
  detail/{financial-box,system-config-box,customer-info-box,timeline-team-box}.tsx
  detail/documents-tab.tsx
  stepper-steps/step-{details,survey,bom,boq,delivery,execution,actuals,qc,liaison,commissioning,amc}.tsx
  forms/survey-form/{index,types,shared,sections-primary,sections-secondary}.tsx
  forms/{commissioning-form,qc-inspection-form,site-expense-form,signature-pad}.tsx
  forms/{create-dc-dialog,dc-actions-buttons,boi-category-filter,voucher-table-controls}.tsx
  project-files/{index,types,helpers,parts-rows,parts-boxes,generated-docs}.tsx
  handover-pack.tsx, lead-files.tsx

apps/erp/src/lib/
  project-detail-actions.ts       ← FinancialBox gate, setProjectStatus, updateProjectField
  project-step-actions.ts         ← applyPriceBookRates (4-strategy), sendBoqToPurchase, BOI workflow
  project-stepper-queries.ts      ← parallelized per-step data fetch
  projects-queries.ts, pm-queries.ts, project-stages.ts, project-status-helpers.ts
  site-expenses-actions.ts        ← submit/approve/reject vouchers

API routes:
  GET /api/projects/[id]/survey                   ← survey PDF
  GET /api/projects/[id]/qc/[inspectionId]        ← QC PDF
  GET /api/projects/[id]/dc/[dcId]                ← DC PDF
  GET /api/projects/[id]/commissioning            ← commissioning PDF
```

## Known Gotchas

1. **PDF rendering on Vercel.** `@react-pdf/renderer` MUST be in `next.config.js` `experimental.serverComponentsExternalPackages` — its `fontkit` / `pdfkit` / `linebreak` deps use dynamic `require()` that webpack can't statically bundle for Vercel serverless functions. Without this listing, every PDF route fails silently with an opaque 500.
2. **Documents tab drag-drop needs UPDATE RLS.** Supabase Storage `.move()` is implemented as an UPDATE on `storage.objects`. The `project-files` bucket was missing an UPDATE policy in migration 010; fixed in migration 047. `site-photos` got the same fix in migration 054. Symptom when the policy is missing: "Object not found" (the post-update visibility check fails because RLS hides the row).
3. **Status change FK chain.** `log_project_status_change` looks up `employees.id` via `profile_id = auth.uid()` (migration 031). Same pattern on `log_lead_status_change` (migration 055) and `log_proposal_status_change` (migration 056). Writing `auth.uid()` directly into `*_status_history.changed_by` fails FK.
4. **Project spawn cascade.** `accepted` proposal → `create_project_from_accepted_proposal` trigger → project row. Lead set to `won` → `trg_mark_proposal_accepted_on_lead_won` finds the most recent in-play proposal (detailed preferred), flips it to `accepted` → same cascade.
5. **CEIG visibility.** `sizeKwp >= 10 && systemType !== 'off_grid'` (includes on-grid + hybrid, the main Shiroi use case). This was backwards before the migration-045-adjacent fix — it was hiding CEIG for on-grid, which is exactly the system type that needs it for TNEB net metering.
6. **QC photos bucket.** QC photos go to **site-photos** bucket (not project-files), under `projects/{id}/qc/{sectionId}_{timestamp}.{ext}`.
7. **Actuals lock is sticky.** Locking BOI / BOQ / Actuals via `actuals_locked` makes all three tabs read-only. Always warn on pending vouchers before locking.
8. **Display.** `formatProjectNumber` strips `SHIROI/PROJ/` prefix for compact UI.
9. **Survey API route.** Path is `/api/projects/[id]/survey` (NOT `/survey/pdf`) — single `route.ts` that returns the PDF as attachment.

## Past Decisions & Specs

- Migration 031 — status collapse 11→8, auto-create-project trigger, FK lookup fix
- Migration 033 / 034 — project detail fields (scope, cable, billing, location map, order_date, primary_contact_id), voucher workflow, `estimated_site_expenses_budget`
- Migration 036 — BOI versioning (`project_bois`, `boi_id` FK)
- Migration 037 — DC `hsn_code` backfill from `proposal_bom_lines`
- Migration 038 — `actuals_locked` mechanism
- Migration 039 — QC approval workflow, structured checklist
- Migration 040 — Commissioning `string_test_data`, monitoring credentials, performance_ratio_pct, `finalized` status
- Migration 042 — `execution_milestones_master` (replaces CHECK constraint)
- Migration 045 — `ceig_scope`, `engineer_signature_path`
- Migration 047 — `project-files` UPDATE RLS policy (fixes drag-drop)
- Migration 054 — storage RLS perf fix (STABLE helper) + site-photos UPDATE policy
- `docs/archive/projects-dashboard-notes.md` — Manivel's original PM workflow intent and data-model mapping
- `docs/archive/CLAUDE_MD_2026-04-17_ARCHIVED.md` — historical migration + feature timeline
- Specs under `docs/superpowers/specs/` — `2026-04-14-manivel-corrections-design.md`, `2026-04-17-purchase-module-v2-design.md`

## Role Access Summary

| Role | Access |
|---|---|
| `project_manager` (Manivel) | Full CRUD; drives the stepper end-to-end |
| `founder` | Full access + voucher approval at `/vouchers` |
| `site_supervisor` | Create daily reports, upload photos, update task status |
| `finance` | Voucher approval, invoicing; read-only on project detail |
| `marketing_manager` | Read-only on projects; owns Liaison step while PM can view |
| `om_technician` | Read-only until commissioning finalizes; then drives O&M (see [om.md](./om.md)) |
