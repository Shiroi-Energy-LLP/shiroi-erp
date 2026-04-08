# PM Corrections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all feedback from PM Manivel Muthu across 9 modules: Project list view, Survey form, BOM/BOQ, Delivery notes, Execution/Tasks, Commissioning, Liaison, AMC, and Service module.

**Architecture:** Changes are primarily UI enhancements to the existing 10-step project stepper. Most data models already exist — the gaps are in form fields, PDF export, and a few missing UX features. No new DB tables needed; a few columns may need adding.

**Tech Stack:** Next.js 14 App Router, Supabase PostgreSQL, Server Components + Server Actions, existing stepper pattern (`?tab=` query params)

---

## Gap Analysis: What Manivel Wants vs What Exists

| Area | PM Wants | Current State | Gap |
|------|----------|---------------|-----|
| **Project list** | Hide Contracted Value & PM Name from main table | Both visible as default columns | Change `defaultVisible` in column-config.ts |
| **Project list** | Show Remarks column | Not in PROJECT_COLUMNS | Add column definition |
| **Project list** | Auto-search | ✅ Just shipped | None |
| **Survey form** | Full solar survey (mounting feasibility, shadow analysis, equipment location with photos, electrical connectivity, deviations, signatures, GPS, PDF export) | Basic survey with roof_type, shading, electrical load, net metering eligibility | Major form overhaul — need ~15 new fields + photo uploads + PDF |
| **BOM** | Category dropdown filter, Unit column, "Create BOI" flow, PDF export, engineer name | Has BOM lines with category, make, qty, unit_price, total — but no unit column, no category filter, no PDF | Add category filter, unit field, PDF export |
| **BOQ** | Status dropdown per item (Yet to Finalize → Delivered), Rate/GST/Total columns, Final Summary with margin %, PDF, "BOQ Completed" checkbox | Has Estimated vs Actual variance view — completely different model from what PM wants | Significant rework — need item-level status, rate+GST, final summary |
| **Delivery** | Create DC from "Ready to Dispatch" BOQ items, sequential DC numbers (DC1, DC2...), signatures, link items back to BOQ | Has delivery challan form but not linked to BOQ items, no sequential numbering | Add BOQ item selection, auto-numbering |
| **Execution** | Category-based milestones (10 specific categories), Assigned To, Action Date, Daily Activity Log sub-entries per task, progress bar | Has milestones with completion_pct but no assigned_to, no daily log sub-entries, no specific categories | Add fields + daily log + predefined categories |
| **Tasks** | Project-linked tasks with Category, Assigned To, Action Date, Status, Interlinked with Execution | Tasks exist but entity-linked generically, not tied to execution milestones | Improve interlinking between tasks and execution milestones |
| **Commissioning** | Detailed form: DC/AC tests, monitoring details (link/login/password), Performance Ratio auto-calc, Preview before save, PDF generation | Has basic commissioning form with IR test, panel count, initial reading — missing DC/AC test details, monitoring creds, PR calc, preview, PDF | Expand form significantly |
| **Liaison** | TNEB process (5 steps) + CEIG process (7 steps), each with status/assigned/dates/remarks | Shows TNEB status + CEIG status as summary cards — not step-by-step tracking | Add granular step tracking with status per step |
| **AMC** | Table: Project, AMC Type (Monthly/Quarterly/etc), Category (Free/Paid), Assigned To, Status, Report view/download | Has AMC visit schedule after commissioning — limited to Free AMC only, no Paid AMC, no report view | Expand to support paid AMC, report uploads |
| **Service** | Full service module: search, filters, create/edit, status workflow, amounts, report upload | Service tickets exist under O&M but basic — no amounts, no report upload | Enhance existing service ticket module |

---

## Priority Grouping

### P0 — Quick Wins (< 1 hour each, high visibility)
These are column/config changes that directly address PM complaints:

1. Project list column visibility fix
2. BOM category filter

### P1 — Form Enhancements (2-4 hours each)
Expand existing forms with missing fields:

3. Survey form overhaul
4. Commissioning form expansion
5. Liaison step-by-step tracking
6. Execution milestones enhancement (categories + assigned_to + daily log)

### P2 — New Features (4-8 hours each)
Features that need new logic/components:

7. BOQ rework (item-level status + rate/GST + summary)
8. Delivery note from BOQ items
9. AMC module enhancement (paid AMC + reports)
10. Service module enhancement

### P3 — Polish (2-4 hours each)
11. PDF export for Survey, BOM, BOQ, Commissioning, DC
12. Task ↔ Execution interlinking

---

## Detailed Tasks

### Task 1: Project List — Column Visibility Fix

**Files:**
- Modify: `apps/erp/src/components/data-table/column-config.ts`

**What:** Hide `contracted_value` and `project_manager_name` from default project table view. Add `remarks` column.

- [ ] **Step 1:** In `column-config.ts`, find `PROJECT_COLUMNS` array. Set `defaultVisible: false` on the `contracted_value` and `project_manager_name` column definitions.

- [ ] **Step 2:** Add a new column entry for `remarks` after the `year` column:
```ts
{
  key: 'remarks',
  label: 'Remarks',
  sortable: false,
  defaultVisible: true,
  format: 'text',
}
```

- [ ] **Step 3:** In `apps/erp/src/app/(erp)/projects/page.tsx`, verify `remarks` is already in the flatData mapping (it is: `remarks: p.notes ?? ''`). Confirm the key matches.

- [ ] **Step 4:** Type check: `cd apps/erp && npx tsc --noEmit`

- [ ] **Step 5:** Commit: `git commit -m "fix: project list — hide value/PM, add remarks column (PM feedback)"`

---

### Task 2: BOM — Category Filter + Unit Column

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-bom.tsx`
- Modify: `apps/erp/src/lib/project-stepper-queries.ts` (if needed to fetch unit)

**What:** Add a client-side category dropdown filter above the BOM table. Add Unit column to BOM table. Show "Prepared By" engineer name.

- [ ] **Step 1:** Create a new client component `apps/erp/src/components/projects/bom-category-filter.tsx` that wraps the BOM table with a category dropdown filter. The filter should be client-side (no URL params needed since BOM is scoped to one project). Use useState to filter displayed rows by category.

Categories (from PM doc):
```
Solar Panels, Inverter, MMS, DC & Accessories, AC & Accessories, Conduits, Miscellaneous, Safety & Accessories, Earth & Accessories, Generation Meter & Accessories, I&C, Statutory Approvals, Transport & Civil, Others
```

- [ ] **Step 2:** In `step-bom.tsx`, add a "Unit" column to the BOM table (the `bom_line_items` table already has a `unit` column). Add "Prepared By" footer text showing the current user/creator.

- [ ] **Step 3:** Type check and commit.

---

### Task 3: Survey Form Overhaul

**Files:**
- Modify: `apps/erp/src/components/projects/forms/survey-form.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-survey.tsx`
- Possibly: SQL migration for new columns on `project_site_surveys`

**What:** Expand the survey form to match PM's detailed solar site survey structure:

**Section 1 — Project Details** (mostly exists): Project Name (auto), System Size (auto), Survey Date, Survey Location (GPS)

**Section 2 — Mounting & Feasibility** (partially exists): Mounting Feasibility (Yes/No), Roof Type (exists), Shadow Analysis (exists but needs Yes/No + detail text)

**Section 3 — Client Discussion** (NEW): Mounting Procedure Explained (Yes/No), Fixing Arrangement Discussed (Yes/No)

**Section 4 — Equipment Location** (NEW): Inverter Location Finalized (Yes/No) + Photo Upload, DC Cable Routing (Yes/No) + Photo Upload, Earthing Pit Location (Yes/No) + Photo Upload, Lightning Arrester Location (Yes/No) + Photo Upload

**Section 5 — Electrical Connectivity** (partially exists): Final Termination Point (Yes/No) + Photo, Spare Feeder Available (Yes/No) + Photo, DG-EB Interconnection (Yes/No) + Photo, Spare Feeder Rating + Photo

**Section 6 — Deviations** (NEW): Additional Panels, Additional Inverter, Routing Changes, Cable Size Changes, Other Requests

**Section 7 — Sign-Off** (NEW): Client Signature, Engineer Signature, Date

- [ ] **Step 1:** Check current `project_site_surveys` table schema via `packages/types/database.ts`. Identify which columns exist and which need adding.

- [ ] **Step 2:** Create migration for new columns: `mounting_feasibility`, `mounting_procedure_explained`, `fixing_arrangement_discussed`, `inverter_location_finalized`, `dc_routing_finalized`, `earthing_location_finalized`, `la_location_finalized`, `termination_point_finalized`, `spare_feeder_available`, `dg_eb_interconnection`, `spare_feeder_rating`, `deviation_additional_panels`, `deviation_additional_inverter`, `deviation_routing_changes`, `deviation_cable_changes`, `deviation_other`, `client_signature_name`, `engineer_signature_name`, `signoff_date`. All boolean fields default to null. Text fields nullable.

- [ ] **Step 3:** Apply migration to dev, regenerate types.

- [ ] **Step 4:** Expand `survey-form.tsx` with the new sections. Use accordion or section headers to organize the 7 sections. Each Yes/No field renders as a toggle/checkbox pair. Photo uploads use the existing Supabase Storage pattern (project-files bucket).

- [ ] **Step 5:** Update `step-survey.tsx` read-only display to show the new sections.

- [ ] **Step 6:** Type check and commit.

---

### Task 4: Commissioning Form Expansion

**Files:**
- Modify: `apps/erp/src/components/projects/forms/commissioning-form.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-commissioning.tsx`
- Migration for new columns on `commissioning_reports`

**What:** Expand commissioning form to match PM's detailed structure:

**Missing fields to add:**
- DC tests: String Voltage (Voc), String Current (Isc), Polarity Check
- AC tests: Output Voltage, Frequency, Phase Sequence, Earthing Resistance
- Inverter commissioning: Startup status, Grid Synchronization, Parameters Configured, Fault Status
- Monitoring: Platform/App Name, Monitoring Link, Login ID, Password
- Performance: Expected Output (kW), Performance Ratio (auto-calc: initial_power / rated_power × 100)
- Safety: SPD Installed, Emergency Shutdown Working, Warning Labels Installed
- Documentation: As-built drawings submitted, Operation manual provided, Warranty certs provided, Client training completed
- Sign-off: Client signature, Engineer signature

- [ ] **Step 1:** Check current `commissioning_reports` columns. Identify gaps.

- [ ] **Step 2:** Create migration adding new columns. All new fields nullable to not break existing records.

- [ ] **Step 3:** Apply migration, regenerate types.

- [ ] **Step 4:** Expand `commissioning-form.tsx` with sectioned layout matching the PM's 11 sections. Add auto-calculated Performance Ratio.

- [ ] **Step 5:** Add "Preview Report" button that shows a read-only formatted view before saving.

- [ ] **Step 6:** Update `step-commissioning.tsx` display to show all new fields.

- [ ] **Step 7:** Type check and commit.

---

### Task 5: Liaison — Step-by-Step Process Tracking

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx`
- New: `apps/erp/src/components/projects/liaison-process-tracker.tsx`
- Migration for new table or columns

**What:** Replace the current summary cards with a step-by-step process tracker for TNEB (5 steps) and CEIG (7 steps), each with Status dropdown (Pending/In Progress/Completed), Assigned To, Start Date, Completion Date, Remarks.

**TNEB Process Steps:**
1. Document Collection
2. Registration Process
3. Estimate & Payment
4. Inspection Arrangement
5. Net Meter Installation

**CEIG Process Steps:**
1. Document Collection
2. Registration Process
3. Estimate & Payment
4. Drawing Approvals
5. Inspection Arrangement
6. DR & RR Approval
7. Final Approvals

- [ ] **Step 1:** Design approach — either add a `liaison_process_steps` table with `project_id, process_type (tneb/ceig), step_number, step_name, status, assigned_to, start_date, completion_date, remarks` OR use a JSONB column on `net_metering_applications`. Recommend: new table for query flexibility.

- [ ] **Step 2:** Create migration with the new table + RLS policies.

- [ ] **Step 3:** Apply migration, regenerate types.

- [ ] **Step 4:** Create `liaison-process-tracker.tsx` — a client component that displays TNEB and CEIG steps as two collapsible sections. Each step shows as a row with status dropdown, assigned to dropdown (from employees), date pickers, and remarks textarea. Uses server action to update.

- [ ] **Step 5:** Create server action `apps/erp/src/lib/liaison-step-actions.ts` for CRUD on liaison steps. Include an "Initialize Steps" action that seeds the default steps for a project.

- [ ] **Step 6:** Update `step-liaison.tsx` to render the new process tracker alongside existing net metering status.

- [ ] **Step 7:** Type check and commit.

---

### Task 6: Execution Milestones Enhancement

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`
- New: `apps/erp/src/components/projects/execution-daily-log.tsx`
- Migration for new columns on `project_milestones` + new `milestone_daily_logs` table

**What:** Enhance execution tab with:
1. Predefined milestone categories (10 from PM doc)
2. Assigned To, Assigned Date, Action Date, Done By fields per milestone
3. Daily Activity Log sub-entries per milestone (Date, Work Description, Progress %, Issues/Delays, Updated By)
4. Progress bar per milestone

**PM's 10 Execution Categories:**
- Site Visit, Design Approval, Material Delivery, Structure Installation, Civil Work, Panel Installation, DC Conduit & Cable Wiring Work, AC Conduit & Cable Wiring Work, Inverter/DCDB/ACDB Installation, Earth Pit Installation & Termination

- [ ] **Step 1:** Check current `project_milestones` columns. Need to add: `assigned_to (uuid FK employees)`, `assigned_date (date)`, `action_date (date)`, `done_by (uuid FK employees)`.

- [ ] **Step 2:** Create `milestone_daily_logs` table: `id, milestone_id (FK), log_date, work_description, progress_pct, issues_delays, updated_by (FK employees), created_at`. Add RLS.

- [ ] **Step 3:** Create migration, apply, regenerate types.

- [ ] **Step 4:** Update `step-execution.tsx` to show enhanced milestone table with Assigned To, Action Date, Status (Open/In Progress/Closed dropdown), Done By columns. Add progress bar using `completion_pct`.

- [ ] **Step 5:** Create `execution-daily-log.tsx` — expandable rows under each milestone showing daily log entries. Client component with inline add form (Date, Description, Progress %, Issues).

- [ ] **Step 6:** Create server actions for daily log CRUD: `apps/erp/src/lib/milestone-log-actions.ts`.

- [ ] **Step 7:** Add "Initialize Milestones" button that seeds the 10 predefined categories for a project.

- [ ] **Step 8:** Type check and commit.

---

### Task 7: BOQ Rework — Item-Level Status + Rate/GST

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx`
- Modify: `apps/erp/src/components/projects/forms/boq-variance-form.tsx`
- Migration for new columns on `project_budget_variances` or new BOQ items table

**What:** PM wants BOQ to be an item-level view (not category-level variance). Each BOM item should appear in BOQ with: Category, Item, Make, Qty, **Status** (Yet to Finalize → Delivered), Rate, GST%, Total. Plus Final Summary section with Project Cost, Actual Budget, Expected Margin.

This is a significant departure from the current category-level variance model. Two approaches:

**Option A (recommended):** Keep current variance model for internal use, add a new `boq_items` view that mirrors BOM items with status + rate + GST columns. This preserves the existing BOQ while giving PM his item-level view.

**Option B:** Replace current BOQ entirely with item-level model.

- [ ] **Step 1:** Add new columns to `bom_line_items`: `boq_status` (enum: yet_to_finalize, yet_to_place, order_placed, received, ready_to_dispatch, delivered), `rate` (numeric), `gst_pct` (numeric), `boq_total` (computed or stored).

- [ ] **Step 2:** Create migration with the new enum and columns. Apply, regenerate types.

- [ ] **Step 3:** Rework `step-boq.tsx` to show item-level table: Category, Item, Make, Qty, Status (dropdown), Rate (₹), GST (%), Total (auto-calc). Add category filter dropdown.

- [ ] **Step 4:** Add Final Summary section at bottom: Project Cost (from proposal), Actual Budget (sum of BOQ totals + site expenses), Expected Margin % ((Project Cost - Actual Budget) / Project Cost × 100).

- [ ] **Step 5:** Add "Mark BOQ Completed" checkbox that updates a project flag.

- [ ] **Step 6:** Type check and commit.

---

### Task 8: Delivery Notes from BOQ Items

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-delivery.tsx`
- Modify: `apps/erp/src/components/projects/forms/delivery-challan-form.tsx`
- New: `apps/erp/src/lib/delivery-note-actions.ts` (if not existing)

**What:**
1. "Create DC" should show items with status "Ready to Dispatch" from BOQ
2. User selects items → generates DC with sequential number (DC1, DC2, DC3)
3. Each DC stores selected items, quantities, project ref, dispatch date
4. Include Received By + Authorized Signature fields

- [ ] **Step 1:** Add `delivery_note_number` (auto-incremented per project, e.g., DC1, DC2) to `delivery_challans` or equivalent table. Add `dc_items` junction: `dc_id, bom_item_id, quantity`.

- [ ] **Step 2:** Create migration, apply, regenerate types.

- [ ] **Step 3:** Rework `delivery-challan-form.tsx` to fetch BOQ items with status "ready_to_dispatch", display as checkable list, auto-assign DC number.

- [ ] **Step 4:** Update `step-delivery.tsx` to show DC number (DC1, DC2...) and list of items per DC.

- [ ] **Step 5:** Add status tracking per DC: Dispatched → Delivered.

- [ ] **Step 6:** When DC is created, auto-update BOQ item status from "ready_to_dispatch" to "delivered".

- [ ] **Step 7:** Type check and commit.

---

### Task 9: AMC Module Enhancement

**Files:**
- Modify: `apps/erp/src/app/(erp)/om/amc/page.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-amc.tsx`
- Modify: `apps/erp/src/components/om/create-amc-dialog.tsx`

**What:**
1. Support AMC Type: Monthly / Quarterly / Half-Yearly / Yearly
2. Support Category: Free AMC / Paid AMC
3. Add filters: Project Name, Engineer Name, AMC Type, Status
4. Report upload/view per visit
5. Auto-generate schedules based on AMC type frequency

- [ ] **Step 1:** Check `om_contracts` and `om_visit_schedules` tables for existing columns. Need to add `amc_category` (free/paid), ensure `contract_type` covers Monthly/Quarterly/Half-Yearly/Yearly.

- [ ] **Step 2:** Create migration if needed. Apply, regenerate types.

- [ ] **Step 3:** Update `create-amc-dialog.tsx` to allow selecting AMC Type and Category. Auto-generate visit dates based on frequency from commissioning date.

- [ ] **Step 4:** Update `/om/amc/page.tsx` to add auto-search + filter dropdowns (using SearchInput + FilterSelect components).

- [ ] **Step 5:** Add report upload functionality to AMC visits using Supabase Storage.

- [ ] **Step 6:** Type check and commit.

---

### Task 10: Service Module Enhancement

**Files:**
- Modify: `apps/erp/src/app/(erp)/om/tickets/page.tsx`
- Modify: `apps/erp/src/components/om/create-ticket-dialog.tsx`

**What:**
1. Add Service Amount (₹) field
2. Add search bar + filters (Project, Engineer, Status, Date Range)
3. Status workflow: Open → In Progress → Closed
4. Report upload per service
5. Link with AMC module (create service from AMC visits)

- [ ] **Step 1:** Check `service_tickets` table columns. Add `service_amount` (numeric, nullable), `report_file_path` (text, nullable) if not present.

- [ ] **Step 2:** Create migration if needed. Apply, regenerate types.

- [ ] **Step 3:** Update `create-ticket-dialog.tsx` with amount field.

- [ ] **Step 4:** Update `/om/tickets/page.tsx` — add SearchInput + FilterSelect components (Project, Engineer, Status). Add Amount column to table.

- [ ] **Step 5:** Add inline status update dropdown in the table.

- [ ] **Step 6:** Type check and commit.

---

### Task 11: PDF Export — Survey, BOM, BOQ, Commissioning, DC

**Files:**
- New: `apps/erp/src/app/api/pdf/[type]/route.ts` (or per-type routes)
- Uses existing PDF generation pattern (if any) or new using @react-pdf/renderer or server-side HTML→PDF

**What:** Generate downloadable PDFs for:
1. Survey report (formatted like PM's solar site survey form)
2. BOM list (table format with engineer name)
3. BOQ Budget Analysis (with Final Summary)
4. Commissioning Report (client-ready format)
5. Delivery Challan (with signatures)

- [ ] **Step 1:** Check existing PDF generation in the codebase (proposal PDF route exists). Follow same pattern.

- [ ] **Step 2:** Create PDF templates for each document type. Use consistent Shiroi branding (logo, colors, fonts).

- [ ] **Step 3:** Add "Download PDF" and "Print View" buttons to each relevant stepper step.

- [ ] **Step 4:** Test PDF generation for each type.

- [ ] **Step 5:** Commit.

---

### Task 12: Task ↔ Execution Interlinking

**Files:**
- Modify: `apps/erp/src/app/(erp)/tasks/page.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`

**What:**
1. Clicking Project Name in Tasks → opens project execution view
2. From Execution → view related tasks for that milestone
3. From Tasks → view project milestones
4. Add "Category" column to tasks (matching execution milestone categories)

- [ ] **Step 1:** In tasks page, make Project Name a clickable link to `/projects/[id]?tab=execution`.

- [ ] **Step 2:** In execution step, add a "View Tasks" link per milestone that filters to `entity_type=project&entity_id=X`.

- [ ] **Step 3:** Add `category` field to task creation form matching the 10 execution categories.

- [ ] **Step 4:** Type check and commit.

---

## Execution Order

```
Task 1  (30min)  →  Quick column fix — immediate PM satisfaction
Task 2  (1hr)    →  BOM category filter — quick win
Task 12 (1hr)    →  Task interlinking — quick navigation fix
Task 3  (4hr)    →  Survey form overhaul — biggest visibility item
Task 4  (3hr)    →  Commissioning expansion
Task 6  (4hr)    →  Execution milestones + daily logs
Task 5  (3hr)    →  Liaison step tracking
Task 7  (4hr)    →  BOQ rework
Task 8  (3hr)    →  Delivery from BOQ
Task 9  (2hr)    →  AMC enhancement
Task 10 (2hr)    →  Service enhancement
Task 11 (6hr)    →  PDF export (all types)
```

**Total estimated effort: ~34 hours of implementation**

---

## DB Migrations Summary

The following migrations will be needed (can be batched):

1. **Migration 022:** Survey form fields — ~20 new columns on `project_site_surveys`
2. **Migration 023:** Commissioning form fields — ~25 new columns on `commissioning_reports`
3. **Migration 024:** Liaison process steps table + RLS
4. **Migration 025:** Execution enhancements — `project_milestones` new columns + `milestone_daily_logs` table
5. **Migration 026:** BOQ item-level fields — enum + columns on `bom_line_items`
6. **Migration 027:** Delivery note items — `dc_items` table + `delivery_note_number` column
7. **Migration 028:** AMC + Service additions — `amc_category`, `service_amount`, `report_file_path`

---

## Notes for Vivek

- The PM is not asking for anything architecturally new — it's all enhancements to the existing stepper workflow
- The biggest effort items are Survey form (Task 3), BOQ rework (Task 7), and PDF export (Task 11)
- Tasks 1, 2, 12 can be done immediately as quick wins to show responsiveness
- The liaison step-by-step tracker (Task 5) is a genuinely good addition — currently the liaison view is too high-level
- The "Daily Activity Log" per execution milestone (Task 6) is the most impactful feature — it solves the real problem of tracking multi-day work without creating duplicate tasks
