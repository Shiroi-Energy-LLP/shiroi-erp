# PM Corrections — FINAL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete overhaul of the project module to match PM Manivel's specifications exactly. Fix all bugs. Build every missing feature. This is the final build.

**Architecture:** Enhancements to the existing 10-step project stepper. New DB tables for liaison steps and daily logs. Expanded columns on survey, commissioning, and BOM tables. Canvas-based signature pad. PDF generation via API routes.

**Tech Stack:** Next.js 14 App Router, Supabase PostgreSQL, Server Components + Server Actions, @react-pdf/renderer or html-to-pdf for PDFs, HTML Canvas for signatures.

---

## PHASE 0: BUG FIXES (Do First)

### Task 0A: Fix Advance Status FK Error

**Files:**
- Modify: `apps/erp/src/lib/project-step-actions.ts` (~line 254-315)

**Root cause:** `advanceProjectStatus()` looks up employee via `profile_id`, but the FK constraint on `project_status_history.changed_by` fails if the employee lookup returns null or RLS blocks the insert.

- [ ] Add explicit null check after employee lookup with clear error message
- [ ] Wrap the history insert in try/catch with user-friendly error
- [ ] Check RLS policy on `project_status_history` — ensure insert is allowed for PM/founder/engineer roles
- [ ] If RLS is the issue, create migration to fix the INSERT policy

---

### Task 0B: Fix File Delete — RLS Policy

**Files:**
- New: `supabase/migrations/022_fix_file_delete_policy.sql`

**Root cause:** DELETE policy on `project-files` storage bucket only allows `founder`. Must include `project_manager` and `site_supervisor`.

- [ ] Write migration:
```sql
DROP POLICY IF EXISTS "project_files_delete" ON storage.objects;
CREATE POLICY "project_files_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder', 'project_manager', 'site_supervisor')
    )
  );
```
- [ ] Apply to dev, test deletion as PM role

---

### Task 0C: Fix BOM gst_type Enum Error

**Files:**
- Modify: `apps/erp/src/lib/project-step-actions.ts` (~line 420)

**Root cause:** Hardcoded `gst_type: 'cgst_sgst'` but enum only allows `'supply'` | `'works_contract'`.

- [ ] Change to `gst_type: 'supply'` for BOM material items
- [ ] Remove the `as any` cast — use proper type

---

### Task 0D: Fix Execution Tab Error Handling

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`
- Modify: `apps/erp/src/lib/project-stepper-queries.ts`

**Root cause:** Query throws error → no error boundary → tab shows nothing.

- [ ] Wrap `getStepExecutionData()` in try/catch, return empty milestones on error
- [ ] Add console.error with context for debugging
- [ ] Ensure empty state ("No Milestones") always renders even on query failure

---

### Task 0E: Fix Survey Form Value Mismatches

This is partially superseded by the full survey overhaul (Task 3), but fix immediately so current form doesn't error:

**Files:**
- Modify: `apps/erp/src/components/projects/forms/survey-form.tsx`

**Root cause:** Form sends `'RCC Flat'` but DB expects `'flat_rcc'`. Also mismatches on `shading_assessment`, `structure_type`, `meter_type`.

- [ ] Map form options to correct DB values:
  - roof_type: `flat_rcc`, `sloped_rcc`, `tin_sheet`, `mangalore_tile`, `asbestos`, `metal_deck`, `other`
  - shading_assessment: `none`, `minimal`, `moderate`, `severe`
  - structure_type: `rcc_column`, `elevated_ms`, `ground_mount`, `carport`, `other`
  - meter_type: `single_phase`, `three_phase`
- [ ] Use value/label pairs: `<option value="flat_rcc">RCC Flat</option>`

---

## PHASE 1: DEFAULT VIEWS + PROJECT LIST

### Task 1: Default View Feature (All Tables)

**Files:**
- Modify: `apps/erp/src/components/data-table/view-tabs.tsx`
- Modify: `apps/erp/src/lib/views-actions.ts`
- Modify: All pages that use DataTable (leads, contacts, companies, projects, proposals)

**What:** Users can mark any saved view as their default. When they navigate to the page without `?view=` param, their default view loads automatically.

**DB:** `is_default` column already exists on `table_views`. Backend `saveView()` already accepts `isDefault`. Just need:

- [ ] **Step 1:** In `views-actions.ts`, add `setDefaultView(viewId, entityType)` server action that:
  1. Clears `is_default=false` on all views for this user + entity_type
  2. Sets `is_default=true` on the selected view
- [ ] **Step 2:** Add `getDefaultView(entityType)` function that returns the user's default view if any
- [ ] **Step 3:** In `view-tabs.tsx`, add "Set as Default" option in the view dropdown/context menu. Show a ⭐ indicator on the default view tab.
- [ ] **Step 4:** In each page (leads, contacts, companies, projects, proposals), modify the view loading:
```typescript
const defaultView = views.find((v: any) => v.is_default);
const activeView = params.view
  ? views.find((v: any) => v.id === params.view)
  : defaultView ?? null;
```
- [ ] Type check and commit

---

### Task 2: Project List Column Fix

**Files:**
- Modify: `apps/erp/src/components/data-table/column-config.ts`

- [ ] In `PROJECT_COLUMNS`: set `defaultVisible: false` on `contracted_value` and `project_manager_name`
- [ ] Add `remarks` column definition with `defaultVisible: true`
- [ ] Commit

---

## PHASE 2: SURVEY OVERHAUL

### Task 3: Complete Survey Form — Manivel's 7-Section Format

**Files:**
- New: `supabase/migrations/023_survey_form_expansion.sql`
- Rewrite: `apps/erp/src/components/projects/forms/survey-form.tsx`
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-survey.tsx`
- New: `apps/erp/src/components/signature-pad.tsx` (reused across Survey, DC, Commissioning)

**Migration — new columns on `lead_site_surveys`:**
```sql
-- Section 2: Mounting & Feasibility
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS mounting_feasibility BOOLEAN;
-- roof_type already exists, update CHECK constraint to include Manivel's values
-- shadow_analysis already partially exists as shading_assessment

-- Section 3: Client Discussion
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS mounting_procedure_explained BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS fixing_arrangement_discussed BOOLEAN;

-- Section 4: Equipment Location (each has Yes/No + photo path)
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS inverter_location_finalized BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS inverter_location_photo TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dc_routing_finalized BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dc_routing_photo TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS earthing_location_finalized BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS earthing_location_photo TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS la_location_finalized BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS la_location_photo TEXT;

-- Section 5: Electrical Connectivity
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS termination_point_finalized BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS termination_point_photo TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_available BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_photo TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dg_eb_interconnection BOOLEAN;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dg_eb_photo TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_rating TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_rating_photo TEXT;

-- Section 6: Deviations
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS deviation_additional_panels TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS deviation_additional_inverter TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS deviation_routing_changes TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS deviation_cable_changes TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS deviation_other TEXT;

-- Section 7: Sign-off
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS client_signature TEXT; -- base64 canvas data
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS engineer_signature TEXT; -- base64 canvas data
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS signoff_date DATE;

-- GPS
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS survey_latitude NUMERIC(10,7);
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS survey_longitude NUMERIC(10,7);
```

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** Build `signature-pad.tsx` — HTML Canvas-based signature capture component. Touch-friendly for tablet. Outputs base64 PNG. Clear/undo buttons. Used by Survey, DC, Commissioning.
- [ ] **Step 3:** Rewrite `survey-form.tsx` with 7 sections matching PM's exact structure:
  - Section 1: Project Details (auto-filled project name, system size, date picker, GPS capture via `navigator.geolocation`)
  - Section 2: Mounting & Feasibility (checkboxes: Feasible/Not Feasible, Roof Type radio: RCC/Metal/Tile/Ground, Shadow Analysis Yes/No + text)
  - Section 3: Client Discussion (checkboxes for each item)
  - Section 4: Equipment Location (4× Yes/No + individual photo upload using Supabase Storage)
  - Section 5: Electrical Connectivity (4× Yes/No + individual photo upload)
  - Section 6: Deviations (text fields)
  - Section 7: Sign-off (2× signature pads + date)
- [ ] **Step 4:** Rewrite `step-survey.tsx` read-only display to show all 7 sections
- [ ] **Step 5:** Add "Download PDF" button (Task 11 will implement the actual PDF)
- [ ] Type check and commit

---

## PHASE 3: BOM → BOQ → DC FLOW

### Task 4: BOM Enhancement

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-bom.tsx`
- New: `apps/erp/src/components/projects/bom-category-filter.tsx`
- Modify: `apps/erp/src/components/projects/forms/bom-line-form.tsx`

**PM's BOM categories:**
Solar Panels, Inverter, MMS, DC & Accessories, AC & Accessories, Conduits, Miscellaneous, Safety & Accessories, Earth & Accessories, Generation Meter & Accessories, I&C, Statutory Approvals, Transport & Civil, Others

- [ ] **Step 1:** Create `bom-category-filter.tsx` — client component with category dropdown that filters BOM rows client-side
- [ ] **Step 2:** Add `Unit` column to BOM table (column exists in DB, just not displayed)
- [ ] **Step 3:** Show "Prepared By" (engineer name) at bottom of BOM
- [ ] **Step 4:** Ensure BOM form dropdown categories match the PM's list exactly
- [ ] **Step 5:** Add "Submit BOM" button that locks BOM and enables BOQ tab (store `bom_submitted_at` timestamp)
- [ ] Type check and commit

---

### Task 5: BOQ Rework — Item-Level Status + Rate/GST

**Files:**
- New: `supabase/migrations/024_boq_item_status.sql`
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx`
- Modify: `apps/erp/src/lib/project-stepper-queries.ts`
- New: `apps/erp/src/lib/boq-actions.ts`

**Migration:**
```sql
-- BOQ status enum
CREATE TYPE boq_item_status AS ENUM (
  'yet_to_finalize', 'yet_to_place', 'order_placed',
  'received', 'ready_to_dispatch', 'delivered'
);

-- Add BOQ fields to bom_line_items (BOQ is a view on BOM items)
ALTER TABLE proposal_bom_lines ADD COLUMN IF NOT EXISTS boq_status boq_item_status DEFAULT 'yet_to_finalize';
ALTER TABLE proposal_bom_lines ADD COLUMN IF NOT EXISTS boq_rate NUMERIC(14,2);
ALTER TABLE proposal_bom_lines ADD COLUMN IF NOT EXISTS boq_gst_pct NUMERIC(5,2);
ALTER TABLE proposal_bom_lines ADD COLUMN IF NOT EXISTS boq_total NUMERIC(14,2);

-- Project-level BOQ completion flag
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_completed_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_completed_by UUID REFERENCES employees(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bom_submitted_at TIMESTAMPTZ;
```

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** BOQ tab should only be accessible if BOM is submitted (check `bom_submitted_at`)
- [ ] **Step 3:** Rewrite `step-boq.tsx` as item-level table:
  - Columns: Category, Item, Make, Qty, Status (dropdown), Rate (₹ editable), GST% (dropdown: 5/18/28), Total (auto-calc: Qty × Rate × (1 + GST%/100))
  - Category dropdown filter at top
  - Each row editable inline (server action to save)
- [ ] **Step 4:** Add Final Summary section at bottom:
  - Total Budget Value (sum of all BOQ totals)
  - Project Cost (from proposal `total_after_discount`)
  - Actual Budget = BOQ Total + Site Expenses
  - Expected Margin % = (Project Cost - Actual Budget) / Project Cost × 100
- [ ] **Step 5:** "Mark BOQ Completed" checkbox — only PM can check this. Locks editing for non-PM users after checked.
- [ ] **Step 6:** Create `boq-actions.ts` with server actions: `updateBoqItem()`, `markBoqCompleted()`
- [ ] Type check and commit

---

### Task 6: Delivery Challan from BOQ + PDF

**Files:**
- New: `supabase/migrations/025_delivery_challan_items.sql`
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-delivery.tsx`
- Rewrite: `apps/erp/src/components/projects/forms/delivery-challan-form.tsx`
- New: `apps/erp/src/lib/delivery-actions.ts`

**Migration:**
```sql
-- DC items junction table
CREATE TABLE delivery_challan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id UUID NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  bom_line_id UUID NOT NULL REFERENCES proposal_bom_lines(id),
  quantity NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sequential DC number per project
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS dc_sequence INTEGER;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS transport_vehicle_number TEXT;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS transport_driver_name TEXT;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS transport_mode TEXT;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS received_by_signature TEXT; -- base64
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS authorized_signature TEXT; -- base64
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS dc_status TEXT DEFAULT 'dispatched'
  CHECK (dc_status IN ('dispatched', 'delivered'));

-- Enable RLS
ALTER TABLE delivery_challan_items ENABLE ROW LEVEL SECURITY;
-- [Add appropriate RLS policies]
```

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** "Create DC" button opens popup/dialog showing all BOQ items with status `ready_to_dispatch`. User can:
  - Check items to include
  - Adjust quantity per item (for partial dispatch, e.g., 50 of 100 panels)
  - Enter transport details (vehicle number, driver name, mode)
- [ ] **Step 3:** On "Generate DC":
  - Auto-assign sequential DC number (DC1, DC2, DC3...) per project
  - Save DC record + DC items
  - Update BOQ item status: if full qty dispatched → `delivered`, if partial → stays `ready_to_dispatch` with remaining qty tracked
  - Generate PDF immediately
- [ ] **Step 4:** DC PDF includes: Shiroi letterhead, project details, item table (description, qty, unit), transport details, signature pads (Received By + Authorized), DC number, date
- [ ] **Step 5:** Keep "Upload DC" as manual override option for edge cases
- [ ] **Step 6:** Display DC list with DC1, DC2... sequential labels, items per DC, status (Dispatched/Delivered)
- [ ] Type check and commit

---

## PHASE 4: EXECUTION & TASKS

### Task 7: Execution Milestones + Daily Activity Logs as Tasks

**Files:**
- New: `supabase/migrations/026_execution_daily_logs.sql`
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`
- New: `apps/erp/src/components/projects/execution-daily-log.tsx`
- New: `apps/erp/src/lib/execution-actions.ts`
- Modify: `apps/erp/src/lib/project-stepper-queries.ts`

**PM's 10 Execution Milestones (always the same for every project):**
1. Site Visit
2. Design Approval
3. Material Delivery
4. Structure Installation
5. Civil Work
6. Panel Installation
7. DC Conduit & Cable Wiring Work
8. AC Conduit & Cable Wiring Work
9. Inverter, DCDB & ACDB Installation
10. Earth Pit Installation & Termination

**Migration:**
```sql
-- Extend project_milestones
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES employees(id);
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS assigned_date DATE;
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS action_date DATE;
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS done_by UUID REFERENCES employees(id);
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Daily activity logs per milestone — each creates a Task
CREATE TABLE milestone_daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id), -- linked task in tasks table
  log_date DATE NOT NULL,
  work_description TEXT NOT NULL,
  progress_pct INTEGER DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  issues_delays TEXT,
  assigned_to UUID REFERENCES employees(id),
  updated_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE milestone_daily_logs ENABLE ROW LEVEL SECURITY;
-- [RLS policies]
```

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** "Initialize Milestones" button that seeds the 10 predefined milestones for a project (with `milestone_order` 1-10)
- [ ] **Step 3:** Rewrite `step-execution.tsx`:
  - Table: Category (milestone name), Assigned To (dropdown), Assigned Date, Action Date, Status (Open/In Progress/Closed dropdown), Done By, Remarks
  - Progress bar per milestone (0-100% with color: 🔴 Open, 🟡 In Progress, 🟢 Completed)
  - Each milestone row expandable → shows daily activity log entries
- [ ] **Step 4:** Build `execution-daily-log.tsx`:
  - Expandable section under each milestone
  - Sub-table: Date, Work Description, Progress %, Issues/Delays, Assigned To, Updated By
  - Inline "Add Daily Entry" form
  - **Each daily entry also creates a Task** in the main `tasks` table with `entity_type='project'`, assigned to the selected engineer → appears in their "My Tasks"
- [ ] **Step 5:** Create `execution-actions.ts` with:
  - `initializeProjectMilestones(projectId)` — seeds 10 milestones
  - `updateMilestone(milestoneId, data)` — update status, assigned_to, etc.
  - `addDailyLog(milestoneId, data)` — creates log entry + linked task
  - `getExecutionData(projectId)` — milestones with daily logs
- [ ] **Step 6:** Navigation: From execution → "View Tasks" per milestone. From tasks page → project name is clickable link to `/projects/[id]?tab=execution`
- [ ] Type check and commit

---

## PHASE 5: QC, LIAISON, COMMISSIONING

### Task 8: QC — Manivel's Checklist Format + PM Approval Gate

**Files:**
- New: `supabase/migrations/027_qc_checklist_format.sql` (if needed)
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-qc.tsx`
- Modify: `apps/erp/src/components/projects/forms/qc-inspection-form.tsx`

**PM's QC Checklist Items:**
1. Visual Inspection Completed — Yes/No + Remarks
2. Mechanical Installation Verified — Yes/No + Remarks
3. Electrical Connections Checked — Yes/No + Remarks
4. Cable Dressing Completed — Yes/No + Remarks
5. Earthing System Verified — Yes/No + Remarks
6. Protection Devices Installed — Yes/No + Remarks
7. Site Cleanliness Verified — Yes/No + Remarks

**Gate logic:** QC must be uploaded AND approved by PM before project can move to Liaison.

- [ ] **Step 1:** Check if `qc_gate_inspections` table can store these items (it may already have a checklist structure). If not, add migration with `checklist_items JSONB` column.
- [ ] **Step 2:** Rewrite QC form to match PM's format: 7-item checklist, each with Yes/No toggle + Remarks text field
- [ ] **Step 3:** Add "Submit for Approval" button (sets status to `pending_approval`)
- [ ] **Step 4:** PM sees "Approve QC" / "Reject QC" buttons. Approval sets status to `approved`.
- [ ] **Step 5:** Liaison tab checks: if QC not approved, show message "QC must be approved by Project Manager before proceeding to Liaison"
- [ ] **Step 6:** Add "Save Changes" + "Print / Download as PDF" buttons
- [ ] Type check and commit

---

### Task 9: Liaison — TNEB 5-Step + CEIG 7-Step Tracker

**Files:**
- New: `supabase/migrations/028_liaison_process_steps.sql`
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx`
- New: `apps/erp/src/components/projects/liaison-process-tracker.tsx`
- New: `apps/erp/src/lib/liaison-step-actions.ts`

**Migration:**
```sql
CREATE TABLE liaison_process_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  process_type TEXT NOT NULL CHECK (process_type IN ('tneb', 'ceig')),
  step_number INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  assigned_to UUID REFERENCES employees(id),
  start_date DATE,
  completion_date DATE,
  remarks TEXT,
  document_path TEXT, -- uploaded document
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, process_type, step_number)
);

ALTER TABLE liaison_process_steps ENABLE ROW LEVEL SECURITY;
-- [RLS policies]
```

**TNEB Steps (5):** Document Collection, Registration Process, Estimate & Payment, Inspection Arrangement, Net Meter Installation

**CEIG Steps (7):** Document Collection, Registration Process, Estimate & Payment, Drawing Approvals, Inspection Arrangement, DR & RR Approval, Final Approvals

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** Build `liaison-process-tracker.tsx` — two collapsible sections (TNEB / CEIG), each showing steps as rows with: Step Name, Status (dropdown: Pending/In Progress/Completed), Assigned To (employee dropdown), Start Date, Completion Date, Document Upload, Remarks
- [ ] **Step 3:** "Initialize Liaison Steps" button seeds the standard steps for a project
- [ ] **Step 4:** Create `liaison-step-actions.ts` with CRUD operations
- [ ] **Step 5:** Keep existing net metering status display alongside the new step tracker
- [ ] **Step 6:** Auto-update: when all TNEB steps are "Completed", update main liaison status
- [ ] Type check and commit

---

### Task 10: Commissioning — Full Detailed Format + 24h Lock + PDF

**Files:**
- New: `supabase/migrations/029_commissioning_expansion.sql`
- Rewrite: `apps/erp/src/components/projects/forms/commissioning-form.tsx`
- Rewrite: `apps/erp/src/components/projects/stepper-steps/step-commissioning.tsx`
- New: `apps/erp/src/lib/commissioning-actions.ts`

**Migration — new columns on `commissioning_reports`:**
```sql
-- DC Tests
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS string_voltage_voc NUMERIC(8,2);
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS string_current_isc NUMERIC(8,2);
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS polarity_check BOOLEAN;

-- AC Tests
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS output_voltage NUMERIC(8,2);
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS frequency NUMERIC(6,2);
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS phase_sequence TEXT;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS earthing_resistance NUMERIC(8,2);

-- Inverter Commissioning
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS inverter_startup_successful BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS grid_synchronization BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS parameters_configured BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS fault_status TEXT;

-- Monitoring
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS monitoring_platform TEXT;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS monitoring_link TEXT;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS monitoring_login_id TEXT;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS monitoring_password TEXT;

-- Performance
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS expected_output_kw NUMERIC(8,2);
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS performance_ratio NUMERIC(5,2); -- auto-calc

-- Safety
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS spd_installed BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS emergency_shutdown_working BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS warning_labels_installed BOOLEAN;

-- Documentation & Handover
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS as_built_drawings_submitted BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS operation_manual_provided BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS warranty_certs_provided BOOLEAN;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS client_training_completed BOOLEAN;

-- Sign-off
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS client_signature TEXT; -- base64
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS engineer_signature TEXT; -- base64

-- 24h lock
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE commissioning_reports ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
```

**RLS for monitoring credentials:** Visible only to site_engineer (for their project), project_manager, founder.

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** Rewrite `commissioning-form.tsx` with 11 sections matching PM's pages 14-17:
  1. Project Details (auto-filled)
  2. System Overview (module type, inverter model, mounting type, counts)
  3. Installation Details (tilt angle, orientation, cable type, earthing)
  4. Pre-Commissioning Checks (7-item checklist, each Yes/No + remarks)
  5. DC Tests (Voc, Isc, IR, Polarity)
  6. AC Tests (Voltage, Frequency, Phase Sequence, Earthing Resistance)
  7. Inverter Commissioning (startup, grid sync, params, faults)
  8. Performance (Initial Power, Expected Output, auto-calc PR = Initial/Expected × 100)
  9. Monitoring (platform, link, login, password)
  10. Safety (SPD, emergency shutdown, warning labels)
  11. Documentation & Handover (4 checkboxes)
  12. Remarks
  13. Declaration text + Signatures (canvas pads)
- [ ] **Step 3:** "Preview Report" button shows formatted read-only view before saving
- [ ] **Step 4:** "Save Draft" (can edit anytime) and "Submit" (starts 24h lock countdown)
- [ ] **Step 5:** After 24h from `submitted_at`, `is_locked=true` — no more edits. Show lock indicator.
- [ ] **Step 6:** Monitoring credentials: RLS or UI-level restriction — only show to engineer assigned to project, PM, and founder roles
- [ ] **Step 7:** PDF generation (Task 11)
- [ ] Type check and commit

---

## PHASE 6: AMC & SERVICE

### Task 11: AMC Module Enhancement

**Files:**
- New: `supabase/migrations/030_amc_enhancement.sql`
- Modify: `apps/erp/src/app/(erp)/om/amc/page.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-amc.tsx`
- Rewrite: `apps/erp/src/components/om/create-amc-dialog.tsx`
- New: `apps/erp/src/lib/amc-actions.ts`

**Key rules (from Manivel + master reference):**
- Free AMC: 3 visits/year (every 4 months from commissioning)
- Paid AMC: variable — 3, 4, or monthly (for cleaning contracts)
- Multiple AMC contracts per project allowed (free + paid can coexist)
- Revenue tracking: contract amount, payment status
- AMC types: Monthly, Quarterly, Half-Yearly, Yearly

**Migration:**
```sql
-- Extend om_contracts
ALTER TABLE om_contracts ADD COLUMN IF NOT EXISTS amc_category TEXT DEFAULT 'free'
  CHECK (amc_category IN ('free', 'paid'));
ALTER TABLE om_contracts ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'not_applicable'
  CHECK (payment_status IN ('not_applicable', 'pending', 'paid', 'overdue'));
ALTER TABLE om_contracts ADD COLUMN IF NOT EXISTS contract_amount NUMERIC(14,2);

-- Ensure multiple contracts per project are allowed (remove any unique constraint if exists)
```

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** Rewrite `create-amc-dialog.tsx`:
  - AMC Type: Monthly / Quarterly / Half-Yearly / Yearly
  - Category: Free AMC / Paid AMC
  - If Paid: contract amount field
  - Auto-generate visit dates based on frequency + commissioning date
  - Assign engineer per visit
- [ ] **Step 3:** Update `/om/amc/page.tsx`:
  - Table columns: Project, AMC Type, Category (Free/Paid), Assigned To, Scheduled Date, Status, Report (View/Download), Actions
  - Add SearchInput + FilterSelect (Project, Engineer, AMC Type, Status, Category)
  - Allow creating multiple AMC contracts per project
- [ ] **Step 4:** Report upload per AMC visit (Supabase Storage)
- [ ] **Step 5:** In `step-amc.tsx` (project detail), show ALL AMC contracts for this project (not just one)
- [ ] Type check and commit

---

### Task 12: Service Module Enhancement

**Files:**
- New: `supabase/migrations/031_service_enhancement.sql`
- Modify: `apps/erp/src/app/(erp)/om/tickets/page.tsx`
- Modify: `apps/erp/src/components/om/create-ticket-dialog.tsx`

**Migration:**
```sql
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS service_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS report_file_path TEXT;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(14,2);
```

- [ ] **Step 1:** Create and apply migration, regenerate types
- [ ] **Step 2:** Update `create-ticket-dialog.tsx`: add Estimated Amount field, project dropdown
- [ ] **Step 3:** Update `/om/tickets/page.tsx`:
  - Add SearchInput + FilterSelect (Project, Engineer, Status)
  - Add Amount column to table
  - Inline status update: Open → In Progress → Closed (dropdown in table row)
- [ ] **Step 4:** Report upload per service (view/download)
- [ ] **Step 5:** Link with AMC: option to "Create Service from AMC Visit"
- [ ] Type check and commit

---

## PHASE 7: PDF EXPORTS

### Task 13: PDF Generation for All Forms

**Files:**
- New: `apps/erp/src/app/api/pdf/survey/route.ts`
- New: `apps/erp/src/app/api/pdf/bom/route.ts`
- New: `apps/erp/src/app/api/pdf/boq/route.ts`
- New: `apps/erp/src/app/api/pdf/commissioning/route.ts`
- New: `apps/erp/src/app/api/pdf/delivery-challan/route.ts`
- New: `apps/erp/src/app/api/pdf/qc/route.ts`
- New: `apps/erp/src/lib/pdf-templates.ts` (shared layout/branding)

Each PDF route:
1. Fetches data for the given project ID
2. Renders a Shiroi-branded PDF (logo, colors, clean layout)
3. Returns as downloadable PDF response

- [ ] **Step 1:** Check existing proposal PDF pattern (`/api/pdf/proposal/route.ts` or similar) and follow same approach
- [ ] **Step 2:** Create shared PDF template with Shiroi header, footer with page numbers
- [ ] **Step 3:** Build PDF routes one by one:
  - **Survey PDF:** 7-section layout matching the form, embedded photos, signature images
  - **BOM PDF:** Table with Category, Item, Make, Qty, Unit. "Prepared By" footer
  - **BOQ PDF:** Table with Rate/GST/Total + Final Summary section
  - **Commissioning PDF:** 11-section client-ready report with all test results, monitoring details, signatures
  - **DC PDF:** Item list, transport details, signature blocks, sequential DC number
  - **QC PDF:** Checklist with Yes/No results and remarks
- [ ] **Step 4:** Add "Download PDF" and "Print View" buttons on each stepper step
- [ ] Type check and commit

---

## PHASE 8: INTERLINKING

### Task 14: Task ↔ Execution Navigation

**Files:**
- Modify: `apps/erp/src/app/(erp)/tasks/page.tsx`
- Modify: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`

- [ ] **Step 1:** In tasks page: make Project Name a clickable `<Link>` to `/projects/[id]?tab=execution`
- [ ] **Step 2:** In execution milestones: add "View Tasks" icon per milestone → links to `/tasks?entity_type=project&search=[milestone name]`
- [ ] **Step 3:** Add "Category" column to tasks table matching the 10 execution milestone names
- [ ] Type check and commit

---

## DB MIGRATIONS SUMMARY

| # | Migration | Tables/Columns |
|---|-----------|---------------|
| 022 | Fix file delete RLS | storage.objects DELETE policy |
| 023 | Survey expansion | ~25 new columns on `lead_site_surveys` |
| 024 | BOQ item status | `boq_item_status` enum + 4 columns on `proposal_bom_lines` + 3 on `projects` |
| 025 | DC items | `delivery_challan_items` table + 7 columns on `delivery_challans` |
| 026 | Execution daily logs | 5 columns on `project_milestones` + `milestone_daily_logs` table |
| 027 | QC format | `checklist_items` JSONB if needed on `qc_gate_inspections` |
| 028 | Liaison steps | `liaison_process_steps` table |
| 029 | Commissioning expansion | ~25 new columns on `commissioning_reports` |
| 030 | AMC enhancement | 3 columns on `om_contracts` |
| 031 | Service enhancement | 3 columns on `service_tickets` |

---

## EXECUTION ORDER

```
Phase 0: Bug fixes (Tasks 0A-0E)              ~2 hours
Phase 1: Default views + project list (1-2)    ~2 hours
Phase 2: Survey overhaul (3)                   ~4 hours
Phase 3: BOM → BOQ → DC flow (4-6)            ~10 hours
Phase 4: Execution + daily logs (7)            ~5 hours
Phase 5: QC + Liaison + Commissioning (8-10)   ~8 hours
Phase 6: AMC + Service (11-12)                 ~4 hours
Phase 7: PDF exports (13)                      ~6 hours
Phase 8: Interlinking (14)                     ~1 hour
                                         TOTAL: ~42 hours
```

---

## CLARIFICATIONS RECEIVED FROM MANIVEL (April 7, 2026)

| # | Question | Answer |
|---|----------|--------|
| 1 | Photo uploads per survey field? | Each Yes/No gets its own photo upload slot |
| 2 | GPS capture device? | Tablet/phone at site (engineer in field) |
| 3 | Partial dispatch? | Yes — 50 of 100 panels in DC1, rest in DC2 |
| 4 | DC format? | Design new one (no existing template) |
| 5 | Daily logs → tasks? | Yes, appear in /tasks, assignable to engineers |
| 6 | Multiple engineers per milestone? | Yes, different engineers on different days |
| 7 | Execution milestones fixed? | Same 10 for every project (for now) |
| 8 | QC checklist complete? | Yes, 7 items as listed |
| 9 | Commissioning lock? | 24h after submission, then locked |
| 10 | Monitoring creds visibility? | Site engineer (for project), PM, management only |
| 11 | Free AMC visits? | 3 per year |
| 12 | Paid AMC? | Variable: 3, 4, or monthly. Revenue tracking needed (skip invoicing for now) |
| 13 | Signatures? | Canvas-based finger drawing on tablet/browser |
| 14 | Execution flow confirmed? | PM creates daily activity → assigns engineer → shows in My Tasks |
| 15 | Default view scope? | Per user only (not role-wide) |
| 16 | DC transport details? | Yes — vehicle number, driver name, mode |
| 17 | Commissioning format? | Full detailed (pages 14-17), not simplified |
| 18 | BOQ lock after completion? | Editable only by PM after "BOQ Completed" |
| 19 | GST rates? | 5%, 18%, 28% (12% discontinued in India) |
| 20 | Rate = per unit? | Yes |
| 21 | QC gate? | QC uploaded + PM approved before Liaison |
