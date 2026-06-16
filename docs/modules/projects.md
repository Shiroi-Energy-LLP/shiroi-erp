# Projects Module

> 13-tab project lifecycle driven by the PM. Covers BOI (multi-version, lockable), BOQ (budget analysis), Delivery Challans, Execution (10 milestones, tasks), Actuals (voucher tracking), QC (7-section structured form), Commissioning (string-level tests, signatures), Progress (weighted completion %), Materials (site cut-length log), Certificates (DC digital signatures), and a "More" dropdown for Milestones / Delays / Change Orders / Reports.
> Related modules: [purchase](./purchase.md) (BOQ → vendor POs), [liaison](./liaison.md) (CEIG step), [finance](./finance.md) (voucher approvals, invoicing). See also master reference §7.

## Overview

A project is spawned automatically when a proposal is accepted — the `create_project_from_accepted_proposal` trigger fires on `proposals.status = 'accepted'` and writes a new row into `projects`. Winning a lead cascades through `trg_mark_proposal_accepted_on_lead_won` (migration 055) into the same trigger, so Marketing never has to touch projects directly. From that point forward Manivel (the PM) drives a 13-tab workflow: Details → Survey → BOI → BOQ → Delivery → Execution → QC → Liaison → Commissioning → Free AMC → Progress → Materials → Certificates (plus a "More" dropdown housing Milestones, Delays, Change Orders, and Reports). The old "Actuals" tab is now the standalone `/expenses` module (see stage 7 below); it is no longer a primary tab. BOI and Actuals are immutable-once-locked (`boi_locked`, `actuals_locked`) to stop post-facto budget drift. The BOQ step hands off to Purchase (`Send to Purchase` bulk-updates BOQ items from `yet_to_finalize` → `yet_to_place`), Liaison owns CEIG + TNEB, Actuals routes vouchers through Finance, and Commissioning triggers a plant-monitoring credential sync. The final Documents tab is the single pane of glass the customer, O&M, and finance all pull from.

## Project Status Enum

Migration 031 collapsed 11→8 statuses:

`order_received`, `yet_to_start`, `in_progress`, `completed`, `holding_shiroi`, `holding_client`, `waiting_net_metering`, `meter_client_scope`

Status is editable in-place in the `ProjectHeader` dropdown. Change is audited through `log_project_status_change` (which looks up `employees.id` via `profile_id = auth.uid()` — see migration 031).

## Tabs (13 — in order)

### 1. Details

Editable boxes on the Details tab:
- **FinancialBox** — visible to PM / founder / finance / marketing; **Project Value (`contracted_value`) is editable by PM + founder only** (2026-06-11 — server gate in `updateProjectField` + matching client gate; the old client≠server mismatch where finance saw the editor is fixed). Shows contracted value, actual BOQ total, approved site expenses, margin %.
- **SystemConfigBox** — size (kWp), type (`on_grid` / `off_grid` / `hybrid`), mounting (`elevated` / `low_raise` / `minirail` / `long_rail` / `customized`), panel / inverter / battery / cable brand+model, `scope_la` / `scope_civil` / `scope_meter` (`shiroi` | `client`), remarks.
- **CustomerInfoBox** — debounced contact picker → `primary_contact_id` FK, site + billing address, Google Maps link.
- **TimelineTeamBox** — 6 date fields (order_date, planned_start, etc.) + PM + site_supervisor dropdowns.
- **DeleteProjectCard** (2026-06-11, mig 177) — danger-zone card, PM + founder only. Soft delete: type the exact `project_number` to confirm → `deleted_at` + `deleted_by` set, project vanishes from every list and the detail page 404s (`getProject` filters deleted). No restore UI by design — restore is a DB operation. Hard delete is impossible regardless (RESTRICT FKs from invoices/payments/POs/site reports/…).
- **List search (2026-06-11):** the /projects search box is a typeahead (`ProjectsSearchBox` → `search_projects_lite` RPC) — suggestions show "Customer – Project Name" + number and jump straight to the project; the list filter itself resolves ids via the same RPC (injection-safe, replaces the old `.or()` ILIKE; `project_name` is now searchable). `ProjectCombobox` (expenses/activities/OM/tickets/AMC dialogs) also searches + displays `project_name`.
- **List header dashboard + ops columns (2026-06-16, mig 185).** Above the table sits a `ProjectsSummaryHeader` strip: a **Total System Size** stat (summed `system_size_kwp`) + a count chip for every status. Fed by `get_project_status_summary(p_fy)` (per-status `COUNT`+`SUM(kwp)` with a `TOTAL` row via GROUPING SETS; same `order_date`/`created_at` FY logic as the list), so it **recomputes when the FY filter changes** — the page is a server component, no client state. Default columns are now **Project · Customer—Project · Location · Size · Status · Notes · Activities · Year** (`getDefaultColumns('projects')`): **Notes** (`notes`) is inline-editable + word-wraps (`ColumnDef.wrap`); **Activities** (`fieldType:'activities_link'`) links to `/projects/[id]?tab=execution`; **Year** is now an editable **FY dropdown** (`fieldType:'fy'`) — saving writes `order_date = '<FYstart>-04-01'` (the `year`→`order_date` map + `fyToOrderDate` transform live in `updateCellValue`; shared `lib/helpers/fiscal-year.ts` with 8 vitest). Adding/saving custom column sets is unchanged (saved views, mig 178).
- **CompanyProjectEditor** (mig 172) — links the project to a `companies` record (`projects.company_id`) + sets `projects.project_name` via the reusable `CompanyPicker` (shared with leads). Won deals inherit both automatically: `create_project_from_accepted_proposal` now copies `company_id` + `project_name` from the lead. The `/projects` list shows a default **"Customer — Project"** column (`company.name ?? customer_name`, + ` — project_name`); `project_name` is inline-editable there; `project_number` stays the row link. Old projects (pre-mig-172) display the fallback customer_name until the Phase-2 backfill links them.

### 2. Survey

Full survey form (~1,191 LOC, split per CLAUDE.md rule #14 into 5 modules under `components/projects/forms/survey-form/`). ~25 fields including GPS, roof details, electrical, shading, signatures, and 16+ photo fields (stored in site-photos bucket). PDF via `@react-pdf/renderer` at `GET /api/projects/[id]/survey`.

### 3. BOI (Bill of Items)

Multi-version BOI (BOI-1, BOI-2, ...) with `draft → submitted → approved → locked` workflow (migration 036). `boi_id` FK on `project_boq_items`. 14 Manivel-curated categories. Inline add/delete for draft BOIs only; once locked, a new BOI-N can be created. Prepared-by / approved-by / locked-by attribution displayed per version.

**Per-item edit in ANY state (2026-06-11, mig 175).** PM + founder can edit item fields (description / brand / model / qty / unit / rate / GST) via a pencil dialog regardless of BOI status — including `locked`. The guardrail replacing hard immutability is the append-only audit table `project_boq_item_history` (who / when / field old→new as JSONB): `updateBoiItem` (project-bom-actions.ts) writes the audit row FIRST and aborts the edit if that insert fails. A history (clock) icon per row lazy-loads the trail via the `getBoiItemHistory` server action. Diff computed by the pure helper `boq-item-diff.ts` (vitest-covered, normalizes Postgres NUMERIC strings). Locked BOIs show an amber "edits remain possible and are recorded" hint to PM/founder.

At the bottom of the BOI step: **Estimated Site Expenses (General)** — single `EditableField` over `projects.estimated_site_expenses_budget` (migration 034). This is the baseline for BOQ margin calc + Actuals variance.

### 4. BOQ (Bill of Quantities — Budget Analysis)

5-card summary: Project Cost, Material Budget, Site Expenses, Total Outflow, Final Margin %. Category-wise breakdown with subtotals (excl / incl GST) in a 12px-font compact table. Two action buttons:
- **Send to Purchase** — bulk updates items `yet_to_finalize → yet_to_place`; feeds `/procurement/project/[id]`.
- **Auto-Price from Price Book** — 4-strategy layered matching in `applyPriceBookRates` (`project-step-actions.ts`): (1) normalized-exact (whitespace+punct strip, lowercase), (2) substring either direction, (3) Jaccard token overlap ≥0.3, (4) single-candidate fallback when category has exactly one entry.

BOQ quantity is inline-editable (double-click cell, auto-recalculates `total_price`). A visible **pencil Edit dialog** per row (2026-06-11, `BoqEditButton` in boq-variance-form.tsx) exposes the same `updateBoqItem` fields discoverably (description / brand / model / qty / rate / GST — no unit). Marking "BOQ Complete" sets `boq_completed` on the project.

**Download BOQ PDF (2026-06-16).** A `BoqDownloadButton` sits in the BOQ card header (alongside Auto-Price / Send to Purchase). It renders `lib/pdf/boq-pdf.tsx` client-side via `@react-pdf/renderer` `pdf().toBlob()` (no server route / storage) — line items + project number/customer (from `getProjectHeader`) + generator name (from `getUserProfile`). It's the same component the procurement BOQ view already used; this just surfaces it inside the project module.

**Auto-deliver on DC dispatch (2026-06-11, mig 176).** When a Delivery Challan flips `draft → dispatched` (`submitDeliveryChallan`), the `mark_dc_boq_items_delivered(p_dc_id)` RPC advances that DC's linked BOQ items `ready_to_dispatch → delivered` — guarded so items in any other status are untouched. Best-effort: an RPC failure logs but doesn't roll back the dispatch. Caveat (flagged in spec): a partial-qty dispatch still delivers the whole line; cumulative-qty semantics (`dispatched_qty ≥ quantity`) is a deferred refinement.

### 5. Delivery (Delivery Challans)

A DC is a ship-to-site docket. PM selects items from the "Ready to Dispatch" pool, sets quantities per DC (partial ships allowed), and attaches transport details (vehicle, driver). Ship-To auto-fills from project site address.

DC PDF via `@react-pdf/renderer` at `GET /api/projects/[id]/dc/[dcId]` — Shiroi company header with GSTIN, DC-001/002 sequential numbering, 4-col item table (S.No / Item Description / HSN Code / Quantity), T&C section, Engineer + Client signature lines. Status flow: `draft → dispatched → delivered`.

### 6. Execution (10 milestones + tasks + activities)

**Tasks | Activities sub-tabs (2026-06-11).** The Execution tab now has a client-side toggle (`ExecutionSubTabs`, both views server-rendered, CSS visibility only):
- **Tasks & Milestones** — the existing milestone table + execution tasks. The header "Overall %" is now the **milestone-weighted** number from `get_project_completion_pct` (mig 173) — same figure as the Progress tab and the `projects.completion_pct` cache. The task fetch in `getStepExecutionData` is hardened with a second merged query so universal-entity tasks (`entity_type='project'`, `project_id NULL`) are always visible (two `.eq` queries, no `.or()` interpolation).
- **Activities** (mig 174) — daily site activity log: Date · Stage (FK to `execution_milestones_master`, **or a free-text custom stage** via "Other (type below)…" → `stage_custom`, mig 177 — master list untouched, summary/stage filters operate on master stages only) · Done By (free text — crews aren't employees) · Description (word-wrapped) · **SE / OS / Contractor** manpower counts (SE = Shiroi, OS = outsourced) · Notes. Summary chips (totals via `get_project_activities_summary` RPC — SQL aggregation, never JS). Client-side filters: date range / stage / manpower type. PM + founder add/edit/soft-delete (`deleted_at`; RLS has no DELETE policy); all employees read. Files: `project-activities-{constants,queries,actions}.ts` + `components/projects/activities/`. A **global `/activities` page** (nav: founder / PM / site_supervisor) shows all projects consolidated with a Project column (**project name only** — `project_name ?? customer_name`, no number sub-line, per Vivek 2026-06-11), server-side filters (project combobox / date range / stage) + pagination, org-wide manpower stats, and an **Add Activity** button (PM/founder) whose dialog includes a project picker.

#### Tamil voice-to-text site reports (B1, May 2026)

Site supervisors + PMs can send 30-sec voice notes in Tamil / Tanglish
via WhatsApp instead of typing the daily site report. Flow:

1. Voice note arrives on the registered employee WhatsApp number → Meta webhook → n8n workflow #64 → ERP `/api/whatsapp/voice-report`
2. Sarvam Saaras-v2 ASR transcribes (Tamil + Tanglish supported)
3. Claude Haiku structures the transcript against `daily_site_reports` schema + detects material requisitions
4. Reply in Tamil + English: "Got it (Project SHR-124): 12 panels, structure complete. Reply YES to save."
5. On YES: `daily_site_reports` row inserted + any flagged `material_requisitions` created
6. Original .ogg audio saved to `voice-reports/` Storage bucket for audit

Setup:
- Employee's `whatsapp_number` column in `employees` must be populated
- `SARVAM_API_KEY` set in `.env.local` and Vercel env vars
- n8n workflow #64 active (`infrastructure/n8n/workflows/64-employee-voice-report.json`)
- `META_ACCESS_TOKEN` + `META_PHONE_NUMBER_ID` env vars set in n8n

Audit: `voice_report_log` table (mig 138) tracks every voice note from transcript
to applied report — status flow: `transcribing → awaiting_confirmation → confirmed_applied | rejected | error`.
Founder + the sender can SELECT (RLS).

If SARVAM_API_KEY is unset the API returns a 503 with a graceful WA reply directing the employee to type the report on the web.

Files:
- `apps/erp/src/app/api/whatsapp/voice-report/route.ts` — API handler (audio + YES/NO)
- `apps/erp/src/lib/ai/voice-report-structurer.ts` — Haiku structuring call
- `apps/erp/src/lib/ai/sarvam-client.ts` — Sarvam ASR client

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

### 7. Actuals (read-only list; voucher entry inline or via `/expenses`)

**Voucher entry** lives in the standalone `/expenses` module (migration 066). The Actuals tab embeds a read-only `SiteExpensesReadonly` view filtered to the project, plus (2026-06-11) a **"+ Add Expense" button** that opens `AddExpenseDialog` with the project pre-selected and locked (`defaultProjectId` + `lockProject` props). The dialog's project picker on `/expenses` is now the searchable `ProjectCombobox` with an explicit "General expense (no project)" checkbox — the old empty-selection-silently-means-general behavior was a bug, now a validation error. Vouchers flow through the 3-stage project-linked workflow (submitted → verified → approved).

BOQ quantity is editable by PM here (click-to-edit). Lock mechanism: `actuals_locked` + `actuals_locked_at` + `actuals_locked_by` on `projects` (migration 038). Locking makes BOI / BOQ / Actuals read-only. Margin color coding: green ≥15%, amber ≥5%, red <5%.

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

### 11. Progress (tab: `?tab=completion`)

**Rewritten 2026-06-11 (mig 173).** `MilestoneProgressPanel` — read-only weighted-milestone breakdown: per milestone weight (new `execution_milestones_master.weight`, 10 rows summing to 100) × task completion ratio (zero-task milestones fall back to stored `project_milestones.completion_pct`), overall % from the rewritten `get_project_completion_pct` RPC. Data assembled in `getMilestoneProgressData` (project-completion-queries.ts). Tasks are edited on the Execution tab; nothing is editable here. `MilestonePhotosPanel` unchanged below it.

`projects.completion_pct` is now a **trigger-maintained cache** (`fn_refresh_project_completion_pct` AFTER I/U/D on `tasks` + `project_milestones`) — it was previously never updated (header/list/stage-gating showed stale zeros; backfill 2026-06-11 took non-zero projects from 2 → 19). The manual checklist (`CompletionChecklist`, `project_completion_items`, migs 121–122) is **retired** — UI + actions + constants deleted; the table is kept (no data destruction) but nothing reads it. The legacy `project_milestone_weights` table (mig 004a, 8-name CHECK, unseeded) is also deliberately bypassed. The old `handover` weight gotcha is moot.

### 12. Free AMC

Auto-creates 3 scheduled visits on first AMC contract of type `free_amc`. Free AMC typically covers months 1 / 6 / 12 post-commissioning. See [om.md](./om.md) for full AMC module (V4, contract-centric table).

### 13. Materials (tab: `?tab=materials`)

New in mig 121. `CutLengthTab` surfaces `inventory_cut_records` per project — site supervisors log cable/conduit cuts by material type, specification, length, and rolls. Summary strip shows total meters per material type via `get_project_cable_summary` RPC. Independent of `stock_pieces` (no FK — see inventory.md).

### 14. Certificates (tab: `?tab=certificates`)

New in mig 122. `DcCertificatesPanel` — records DC certificates (`dc_certificates` table, UNIQUE per project + certificate_type) with typed customer name + phone + notes. `signDcCertificate` action enforces immutability at app level. **DB-level gate added in mig 137**: `dc_certs_update` policy now includes `USING (signed_at IS NULL) WITH CHECK (signed_at IS NULL)` — a signed certificate cannot be overwritten via direct DB update (authenticated role). Service-role is the intended admin escape hatch.

### (More dropdown) — Milestones, Delays, Change Orders, Reports

Auxiliary sub-routes under `/projects/[id]/milestones`, `/delays`, `/change-orders`, `/reports`. Surfaced via the "More ▾" dropdown in the tab bar (Radix `DropdownMenu`).

### Documents

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
- `execution_milestones_master` — the 10 milestones (migration 042) + `weight` INT summing to 100 (mig 173)
- `project_activities` — daily activity log w/ SE/OS/contractor manpower counts, `stage_id` → master, soft-delete, `get_project_activities_summary` RPC (mig 174). **2026-06-16 (mig 184):** `project_id` is now nullable + a free-text `project_name_custom` fallback (CHECK one-of-two) so PMs/founders can log Service/AMC/misc activities not tied to an ERP project — via `ProjectCombobox.allowCustom` on the global /activities Add dialog; the list shows the custom label (no link) and `addProjectActivity`/`updateProjectActivity`/`deleteProjectActivity` match by activity id.
- `project_boq_item_history` — append-only BOI item edit audit (`changes` JSONB old→new, `changed_by` → employees; mig 175)
- `projects.completion_pct` — trigger-maintained cache of `get_project_completion_pct` (mig 173); do NOT write it by hand

## Key Files

```
apps/erp/src/app/(erp)/projects/
  page.tsx                    ← list with 8-status + FY (Apr–Mar, order_date) filters + typeahead search box
  [id]/page.tsx               ← detail with 13-tab workflow

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

apps/erp/src/components/projects/
  activities/{activities-panel,activities-client,activity-form-dialog}.tsx   ← Activities sub-tab (mig 174)
  execution-sub-tabs.tsx           ← Tasks | Activities toggle
  completion/milestone-progress-panel.tsx   ← Progress tab weighted breakdown (mig 173)

apps/erp/src/app/(erp)/activities/page.tsx   ← global all-projects activity log
apps/erp/src/components/activities/global-activities-filters.tsx

apps/erp/src/lib/
  project-detail-actions.ts       ← Project Value PM-only gate, setProjectStatus, updateProjectField
  project-step-actions.ts         ← barrel; applyPriceBookRates (4-strategy), sendBoqToPurchase, BOI workflow
  project-bom-actions.ts          ← BOI CRUD + updateBoiItem (audited, any state) + getBoiItemHistory (mig 175)
  project-activities-{constants,queries,actions}.ts   ← Activities data layer (mig 174)
  project-completion-queries.ts   ← getProjectCompletionPct + getMilestoneProgressData (mig 173)
  boq-item-diff.ts (+ .test.ts)   ← pure audit-diff helper
  project-stepper-queries.ts      ← parallelized per-step data fetch (+ entity-task merge)
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
4. **Project spawn cascade.** `accepted` proposal → `create_project_from_accepted_proposal` trigger → project row. Lead set to `won` → `trg_mark_proposal_accepted_on_lead_won` finds the most recent in-play proposal (detailed preferred), flips it to `accepted` → same cascade. **Default PM safety net (mig 104):** `trg_default_project_manager_on_insert` is a BEFORE INSERT trigger on `projects` that resolves the latest active project_manager (Manivel today) and fills `project_manager_id` if the caller left it NULL. Catches every direct-INSERT path (HubSpot/Zoho/Drive imports + the `createProjectFromLead` server-action manual fallback used from `/sales/[id]`). No-ops when the column is already populated, so `create_project_from_accepted_proposal` (migs 063/064/094) keeps its explicit PM lookup. **Mig 169 (2026-06-08)** added the final intake path: a lead Won with *no* proposal (gate off) used to spawn nothing — now `fn_mark_proposal_accepted_on_lead_won` auto-stubs an accepted budgetary proposal so the cascade still runs and this BEFORE-INSERT trigger still assigns Manivel.
5. **CEIG visibility.** `sizeKwp >= 10 && systemType !== 'off_grid'` (includes on-grid + hybrid, the main Shiroi use case). This was backwards before the migration-045-adjacent fix — it was hiding CEIG for on-grid, which is exactly the system type that needs it for TNEB net metering.
6. **QC photos bucket.** QC photos go to **site-photos** bucket (not project-files), under `projects/{id}/qc/{sectionId}_{timestamp}.{ext}`.
7. **Actuals lock is sticky.** Locking BOI / BOQ / Actuals via `actuals_locked` makes all three tabs read-only. Always warn on pending vouchers before locking.
8. **Display.** `formatProjectNumber` strips `SHIROI/PROJ/` prefix for compact UI.
9. **Survey API route.** Path is `/api/projects/[id]/survey` (NOT `/survey/pdf`) — single `route.ts` that returns the PDF as attachment.
10. **Report writes need the employee id, not the profile id.** `daily_site_reports.submitted_by`, `site_photos.uploaded_by`, and `site_report_corrections.requested_by` are FKs to `employees(id)`. The report pages used to pass `getUserProfile().id` (the profiles/auth uid) into these columns, so every web-form insert failed `..._fkey` for all roles (surfaced 2026-06-09 as "Manivel can't add daily reports" — RLS `dsr_insert` passes for `project_manager`; the failure is the FK downstream). `submitReportAction` / `submitCorrectionAction` now resolve the employee id from the session via `getCurrentEmployeeId()` (`apps/erp/src/lib/auth.ts`) and never trust a client-passed identity. The same `*_by`-employee-FK trap can lurk in any action that writes an attribution column.

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
- **Migrations 121–122 (Phase C-ops, May 24, 2026)** — three new project-detail tabs (**Progress**, **Materials**, **Certificates**) plus the underlying schema:
  - `project_completion_items` (10 components per project with weights summing to 100, weighted RPC `get_project_completion_pct`) + `CompletionChecklist` component on the Progress tab.
  - `inventory_cut_records` (lives in inventory.md but surfaces here via `CutLengthTab` on the Materials tab).
  - `projects.handover_pdf_path` column + `/api/projects/[id]/handover-pdf` route + `generateHandoverPackPdf` server action (3-page react-pdf doc rendered in-process, uploaded to `project-files/handover-packs/`, returns 1-hour signed URL).
  - `dc_certificates` (UNIQUE per project + certificate_type) + `signDcCertificate` action + `DcCertificatesPanel` on the Certificates tab. App-level immutability gate added in the 2026-05-24 review (`dc-certificate-actions.ts:50-68` refuses re-sign when `signed_at IS NOT NULL`). **DB-level enforcement added in mig 137** — not mig 134. Mig 134 only added the `inventory_cut_records` UPDATE policy; the DC-cert RLS gate (`USING (signed_at IS NULL) WITH CHECK (signed_at IS NULL)`) arrived in mig 137.
- **Migration 134** — review-pass fixes: `inventory_cut_records` UPDATE policy (typo corrections), `customer_message_log` RLS, attendance `WITH CHECK` lockdown (HR module).
- **Migration 137** — DC-cert `dc_certs_update` policy wrapped in `USING (signed_at IS NULL)` — DB-level immutability gate. Also fixed `get_liaison_summary()` role gate and added `proposal_total_sanity` CHECK.
- **`(public)/p/[token]/pdf/route.ts`** (2026-05-24) — public PDF route for the customer proposal portal (lives in sales.md; cross-referenced here because the same `proposal-files` bucket is used).
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
