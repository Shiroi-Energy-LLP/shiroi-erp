# Manivel PM Corrections — Combined Design Spec

**Date:** 2026-04-14
**Author:** Claude (approved by Vivek)
**Scope:** 4 batches of corrections from Manivel after PM testing

---

## Batch A — Project Module Corrections

### A1. Survey PDF Download & Photo Preview

**Problem:** Survey form has no download button. Existing PDF route renders only text — no photos, no signatures.

**Files to change:**
- NEW: `apps/erp/src/app/api/projects/[id]/survey/route.ts` — GET endpoint
- NEW: `apps/erp/src/lib/pdf/survey-report-pdf.tsx` — @react-pdf/renderer component
- EDIT: `apps/erp/src/components/projects/stepper-steps/step-survey.tsx` — add download button

**API route:** `GET /api/projects/[id]/survey`
- Auth required
- Fetch survey from `lead_site_surveys` via project's `lead_id`
- Fetch project info (project_number, customer_name, site_address)
- For each photo field (15 total): generate Supabase Storage signed URL → fetch image buffer
- For signatures (2 fields): base64 data URLs → convert to buffer
- Render PDF via `survey-report-pdf.tsx`
- Return as attachment: `Survey-Report-{projectNumber}.pdf`

**PDF layout (`survey-report-pdf.tsx`):**
1. Shiroi Energy header (same style as DC/QC/Commissioning PDFs)
2. Project info grid: project number, customer name, site address, survey date, surveyor name
3. Section 1 — Project Details: GPS, contact, site access
4. Section 2 — Mounting & Site Feasibility: roof type/condition/area, structure, photos inline
5. Section 3 — Client Discussion: procedure, fixing arrangement
6. Section 4 — Equipment Finalization: 8 items with finalized status + photos
7. Section 5 — AC Cable Routing: status + photo
8. Section 6 — Deviations: panel/inverter/cable remarks
9. Section 7 — Notes & Signatures: both signature images rendered

**Photo rendering:** `@react-pdf/renderer` `Image` component with fetched buffers. Missing photos show "Not captured" text. Max photo width 200px to keep PDF compact.

**Download button:** Visible on step-survey.tsx when `surveyData.survey_status === 'submitted' || surveyData.survey_status === 'approved'`. Uses same blob-download pattern as `CommissioningPdfButton`.

---

### A2. BOQ Quantity Edit

**Problem:** Quantity field is read-only in BOQ table. PM and authorized engineer need to edit it.

**Files to change:**
- EDIT: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx` — add BoqInlineEdit for quantity

**Implementation:**
- Add `<BoqInlineEdit>` for `quantity` field (same component already used for unit_price and gst_rate)
- On quantity change: server action `updateBoqItem()` recalculates `total_price = quantity × unit_price`
- Permission: founder, project_manager, purchase_officer (matches RLS UPDATE policy)
- Blocked when `actualsLocked === true` (existing lock mechanism)
- No migration needed — `updateBoqItem()` already supports quantity updates

---

### A3. Delivery Challan — Null Error Fix + Format

**Problem:** `Cannot read properties of null (reading 'props')` when downloading DC PDF.

**Files to change:**
- EDIT: `apps/erp/src/app/api/projects/[id]/dc/[dcId]/route.ts` — null guards
- EDIT: `apps/erp/src/lib/pdf/delivery-challan-pdf.tsx` — defensive rendering
- EDIT: `apps/erp/src/components/projects/stepper-steps/step-delivery.tsx` — pass siteAddress safely

**Root cause analysis:** The error occurs when `renderToBuffer()` receives a React element tree containing null where a component expects props. Likely triggers:
1. DC with no items (`delivery_challan_items` returns null instead of empty array)
2. Project with null site address fields (site_address_line1, city, state, pincode all null)
3. Employee lookup for `dispatched_by` returns null

**Fix — API route null guards:**
```
const items = dc.delivery_challan_items ?? []
const siteAddress = [project.site_address_line1, project.site_city, project.site_state, project.site_pincode].filter(Boolean).join(', ') || 'Address not available'
const dispatchedByName = employee?.full_name ?? 'Shiroi Energy'
```

**Fix — PDF component:** Every `<Text>` that renders a data field must use `String(value ?? '')`. Items array must be guarded with `items.length > 0` check before rendering table.

**Format verification against spec:**
- Header: "DELIVERY CHALLAN" ✓ (already present)
- Supplier: Shiroi Energy LLP, address, GSTIN: 33ACPFS4398J1ZE, Contact: 9486801859 ✓
- Challan number: DC-001, DC-002 ✓
- Date: auto-filled ✓
- Place of supply + Deliver to: from project address ✓
- Items: S.No, Item Description, HSN Code, Quantity ✓
- Add "Total Items: X" summary row below table
- T&C: Update to exact wording from spec: "Received the above goods in good condition. The consignee takes responsibility for the safety and security of the materials at the site until installation is carried out by Shiroi Energy LLP."
- Signature: Authorized Signature + Client/Receiver Acknowledgment ✓

---

### A4. Execution — Milestone Progress & Task Visibility

**Problem:** Tasks created from /tasks page without milestone_id don't appear in execution. Completion % doesn't propagate clearly.

**Files to change:**
- EDIT: `apps/erp/src/lib/project-stepper-queries.ts` — expand `getStepExecutionData()` query
- EDIT: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx` — show all tasks

**Query change:** Currently filters tasks by `milestone_id IS NOT NULL`. Change to fetch ALL tasks where `project_id = projectId` (with or without milestone_id).

**Display change:** 
- Milestone-assigned tasks: grouped under their milestone (existing behavior)
- Tasks without milestone_id: shown in a new "Other Tasks" group at the bottom of the task table
- The "Other Tasks" group counts toward overall project completion %

**Completion % calculation:** Already task-driven (done/total per milestone). For "Other Tasks" group, count their completion separately and include in the overall average.

---

### A5. Liaison — CEIG Client/Shiroi Scope

**Problem:** CEIG process exists but no way to mark it as "Client scope" (client handles it).

**Files to change:**
- NEW: `supabase/migrations/045_ceig_scope_and_commissioning_signatures.sql`
- EDIT: `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx` — scope selector
- EDIT: `apps/erp/src/lib/liaison-actions.ts` — updateCeigScope action

**Migration 045 (partial — combined with A6):**
```sql
ALTER TABLE net_metering_applications
  ADD COLUMN ceig_scope TEXT CHECK (ceig_scope IN ('shiroi', 'client'));
```

**UI:** For projects with `system_size_kwp >= 10`:
- Show scope selector at top of CEIG section: "CEIG Scope" with two options: "Shiroi" / "Client"
- **Shiroi selected:** `ceig_required = true`, `ceig_scope = 'shiroi'`, full CEIG workflow shown
- **Client selected:** `ceig_required = false`, `ceig_scope = 'client'`, CEIG section shows "Managed by Client" with optional notes field. DB trigger gate bypassed (ceig_required=false).
- For projects < 10 kW: CEIG section hidden (existing behavior unchanged)

**Server action:** `updateCeigScope(applicationId, scope: 'shiroi' | 'client')` → sets ceig_scope AND ceig_required in one update.

---

### A6. Commissioning — Digital Signatures + PDF

**Problem:** DB has signature columns but no UI to capture them. PDF has blank signature lines.

**Files to change:**
- EDIT: `supabase/migrations/045_ceig_scope_and_commissioning_signatures.sql` — add engineer_signature_path
- NEW: `apps/erp/src/components/signature-pad.tsx` — reusable Canvas drawing component
- EDIT: `apps/erp/src/components/projects/forms/commissioning-form.tsx` — add signature fields
- EDIT: `apps/erp/src/lib/project-step-actions.ts` — save signature data on finalize
- EDIT: `apps/erp/src/lib/pdf/commissioning-report-pdf.tsx` — embed signature images
- EDIT: `apps/erp/src/app/api/projects/[id]/commissioning/route.ts` — fetch signature images for PDF

**Migration 045 (combined with A5):**
```sql
ALTER TABLE commissioning_reports ADD COLUMN engineer_signature_path TEXT;
```
(Customer signature columns already exist: customer_name_signed, customer_signed_at, signature_method, signature_storage_path)

**SignaturePad component:**
- HTML5 Canvas (300×150px)
- Touch + mouse drawing support
- Clear button, undo last stroke
- Exports as base64 PNG data URL via `onSignatureChange(dataUrl)` callback
- Border + "Sign here" placeholder text
- Reusable (used for both engineer and client signatures)

**Commissioning form changes:**
- Add two `SignaturePad` fields before the "Finalize" button:
  1. "Engineer Signature" (mandatory)
  2. "Client Signature" (mandatory)
- On finalize:
  - Upload engineer signature PNG to `site-photos/projects/{id}/commissioning/engineer_sig_{timestamp}.png`
  - Upload client signature PNG to same path pattern
  - Update `commissioning_reports`: `engineer_signature_path`, `signature_storage_path`, `signature_method = 'drawn_on_device'`, `customer_signed_at = now()`, `customer_name_signed` from project.customer_name

**PDF update:**
- API route fetches signed URLs for both signature images
- PDF component renders actual signature images (via `Image` component) instead of blank lines
- "Prepared By" section shows engineer name + signature image
- "Customer Signature" section shows customer name + signature image

---

## Batch B — Task / AMC / Tickets Corrections

### B1. Tasks — Strikethrough, Project List, Filter

**Files to change:**
- EDIT: `apps/erp/src/components/tasks/tasks-table.tsx` — remove styling
- EDIT: `apps/erp/src/lib/tasks-actions.ts` — increase project limit
- NEW: `apps/erp/src/lib/tasks-queries.ts` (or add to existing) — getProjectsWithTasks()
- EDIT: `apps/erp/src/app/(erp)/tasks/page.tsx` — use new query for filter
- EDIT: `apps/erp/src/components/tasks/searchable-project-filter.tsx` — update props

**1. Remove strikethrough (tasks-table.tsx):**
- Line 68: Remove `task.is_completed ? 'opacity-50' : ''` → always `''`
- Line 81: Remove `task.is_completed ? 'line-through text-n-400' : 'text-n-900'` → always `'text-n-900'`
- Status badge (Open red / Closed green) remains the sole indicator

**2. Show all 314 projects in create/edit forms (tasks-actions.ts):**
- `getActiveProjects()`: Remove `.limit(200)` and remove `.not('status', 'in', '("completed")')` filter
- This returns all non-deleted projects for use in create/edit dropdowns

**3. Filter shows only projects with tasks:**
- New query `getProjectsWithTasks()`:
  ```sql
  SELECT DISTINCT p.id, p.project_number, p.customer_name
  FROM tasks t
  JOIN projects p ON t.project_id = p.id
  WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL
  ORDER BY p.customer_name
  ```
- Used only for the SearchableProjectFilter on the /tasks page
- Create/edit dialogs continue using full project list from `getActiveProjects()`

---

### B2. AMC Schedule — Table Restructure

**Files to change:**
- EDIT: `apps/erp/src/app/(erp)/om/amc/page.tsx` — new column layout
- EDIT: `apps/erp/src/lib/amc-actions.ts` — add computed visit fields to query
- EDIT: `apps/erp/src/components/om/amc-visit-tracker.tsx` — progress counter format

**New table columns (9):**

| Column | Source | Display |
|--------|--------|---------|
| Project Name | customer_name | Clickable link |
| Category | amc_category | Free AMC / Paid AMC badge |
| Scheduled Visits | computed from visits | "X / Y" (completed / total) |
| Status | mapped status | Open/Closed toggle |
| Next AMC Date | next unfinished visit scheduled_date | Date or "—" |
| Completed Date | last completed visit completed_at | Date or "—" |
| Notes | notes | Truncated text |
| Actions | — | Edit · Delete buttons |
| Report | — | Upload PDF button |

**Removed columns:** Start Date, End Date, Assigned To

**Data query changes (`getAllAmcData`):**
- For each contract, compute:
  - `completed_visit_count`: COUNT of visits with status='completed'
  - `total_visit_count`: visits_included (or actual visit count)
  - `next_visit_date`: MIN(scheduled_date) from visits WHERE status NOT IN ('completed','cancelled')
  - `last_completed_date`: MAX(completed_at) from visits WHERE status='completed'
- These can be fetched via `getVisitsForContract()` on expand, or computed in a single query with subselects

**Auto-progression logic:**
- On visit completion (except last): next visit's scheduled_date becomes "Next AMC Date"
- On final visit completion: "Completed Date" fills, status optionally auto-closes

**Report column:** Upload PDF button per contract row for the contract-level AMC summary report. Upload to `project-files/{projectId}/amc-reports/{contractId}_{timestamp}.pdf`. Store path in a new `report_file_path TEXT` field on `om_contracts`. Display as download link when file exists. Per-visit reports remain in the expandable visit tracker (existing feature).

**Filter fix:** Create `getProjectsWithAmc()` query — only projects with at least one AMC contract. Used for the project filter dropdown with typeahead. Create form keeps full project list with SearchableProjectSelect.

---

### B3. Service Tickets — Number, Name, Filters

**Files to change:**
- EDIT: `apps/erp/src/app/(erp)/om/tickets/page.tsx` — number format, project display, filter
- NEW: `apps/erp/src/lib/ticket-queries.ts` (or add to existing) — getProjectsWithTickets()
- EDIT: `apps/erp/src/components/om/create-ticket-dialog.tsx` — SearchableProjectSelect

**1. Ticket number format:**
- Current: "TKT-0042" → New: "001", "002", etc.
- Extract numeric portion from ticket_number, zero-pad to 3 digits
- Display logic: `String(parseInt(ticket.ticket_number.replace('TKT-', ''))).padStart(3, '0')`

**2. Project name display:**
- Remove stacked project_number + customer_name
- Show only `customer_name` as clickable link to `/projects/{project_id}`
- Same pattern as tasks table

**3. Filter by project — only projects with tickets:**
- New query `getProjectsWithTickets()`:
  ```sql
  SELECT DISTINCT p.id, p.project_number, p.customer_name
  FROM service_tickets t
  JOIN projects p ON t.project_id = p.id
  WHERE p.deleted_at IS NULL
  ORDER BY p.customer_name
  ```
- Replace current FilterSelect with SearchableProjectFilter (typeahead)

**4. Create form — searchable project dropdown:**
- Replace plain `<select>` with `SearchableProjectSelect` component
- Load all projects (full list) with typeahead search

---

## Batch C — Purchase Order Module

### C1. Line Item Rate Editing

**Files to change:**
- EDIT: `apps/erp/src/app/(erp)/procurement/[poId]/page.tsx` — inline rate editing
- NEW: `apps/erp/src/lib/po-actions.ts` — updatePoLineItemRate server action
- EDIT: existing procurement actions if needed

**Inline editing:**
- `unit_price` field editable via click-to-edit when PO status is `draft` or `sent` (pending acknowledgment)
- On rate change: auto-recalculate per row `total_price = unit_price × quantity_ordered`
- Footer recalculates: `subtotal = SUM(total_price)`, `gst_amount = subtotal × 0.18` (or per-item GST), `total_amount = subtotal + gst_amount`
- Permission: founder, purchase_officer (matches RLS)
- Once PO status is `acknowledged`, `partially_delivered`, `fully_delivered`, `closed`: rate fields read-only

**Server action:** `updatePoLineItemRate(poId, itemId, newRate)` → updates `unit_price`, recalculates `total_price` and `gst_amount` for that item, then recalculates PO-level `subtotal`, `gst_amount`, `total_amount`.

---

### C2. PO Format — Standardized PDF

**Files to change:**
- NEW: `apps/erp/src/lib/pdf/purchase-order-pdf.tsx` — @react-pdf/renderer component
- NEW: `apps/erp/src/app/api/procurement/[poId]/pdf/route.ts` — GET endpoint

**PDF layout (matching Shiroi reference):**

```
┌─────────────────────────────────────────────────┐
│ SHIROI ENERGY LLP          │ ████████████████████│
│ No.75/34, Third Main Road  │ █ PURCHASE ORDER  █│
│ Kasturbai Nagar, Adyar     │ ████████████████████│
│ Chennai TN 600020          │                     │
│ GSTIN: 33ACPFS4398J1ZE     │                     │
│ accounts@shiroienergy.com  │                     │
├─────────────────────────────────────────────────┤
│ PO No: SE/STR/649/2526  Date: 14-Apr-2026       │
│ Terms: 30 days            Project: [name]        │
│ Place of Supply: [state]                         │
├────────────────────┬────────────────────────────┤
│ Vendor Details     │ Ship To                     │
│ [vendor name]      │ [project site address]      │
│ [vendor address]   │ [contact person]            │
│ GSTIN: [vendor]    │ [phone]                     │
├────┬───────────┬───┬─────┬────────┬─────────────┤
│ #  │ Item      │HSN│ Qty │ Rate   │ Amount      │
├────┼───────────┼───┼─────┼────────┼─────────────┤
│ 1  │ Panel...  │...│  10 │ ₹16.00 │ ₹160.00     │
│ ...│           │   │     │        │             │
├────┴───────────┴───┴─────┴────────┼─────────────┤
│ Items: 5                          │ Sub Total    │
│ Notes: ...                        │ CGST 9%      │
│ T&C: ...                          │ SGST 9%      │
│                                   │ Round Off    │
│                                   │ ██GRAND TOTAL│
├───────────────────────────────────┴─────────────┤
│                    For Shiroi Energy LLP         │
│                    Authorized Signature ________ │
└─────────────────────────────────────────────────┘
```

**Data source:**
- PO header: `purchase_orders` table (po_number, po_date, payment_terms_days, notes)
- Items: `purchase_order_items` table (item_description, hsn_code, quantity_ordered, unit_price, total_price, gst_rate)
- Vendor: `vendors` table via `vendor_id` FK (company_name, address, gstin)
- Project: `projects` table via `project_id` FK (customer_name, site_address)
- Totals: calculated from items. Per-item GST uses each item's `gst_rate` field (not hardcoded 9%). For intra-state (Tamil Nadu): split as CGST + SGST (each = gst_amount/2). Subtotal = SUM(total_price), Total GST = SUM(gst_amount), Grand Total = Subtotal + Total GST + Round Off

---

### C3. PO Actions + PDF Download

**Files to change:**
- EDIT: `apps/erp/src/app/(erp)/procurement/[poId]/page.tsx` — action buttons
- EDIT: `apps/erp/src/app/(erp)/procurement/orders/page.tsx` — action buttons on list
- NEW: `apps/erp/src/components/procurement/po-download-button.tsx`

**Action buttons (on PO list and detail):**
- **Download PDF:** Fetches from `/api/procurement/[poId]/pdf`, blob download
- **Edit:** Navigate to edit form (only when status is draft/sent)
- **Delete:** Soft-delete with confirm dialog. Restricted to founder, project_manager. Logs deletion via `deleted_at` timestamp.
- File naming: `{po_number.replace(/\//g, '-')}_PurchaseOrder.pdf`

**Company header:** Always fixed in PDF template. Never editable. Vendor auto-populated from selected vendor record.

---

## Batch D — Price Book / Item Master

### D1. Migration — Expand Price Book Table

**Files to change:**
- NEW: `supabase/migrations/046_price_book_expansion.sql`

**Migration 046:**
```sql
-- Add vendor and default_qty columns
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS default_qty NUMERIC(10,2) DEFAULT 1;

-- Drop old restrictive CHECK constraint on item_category and replace with expanded one
ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_check 
  CHECK (item_category IN (
    'panel', 'inverter', 'battery', 'structure',
    'dc_cable', 'dc_access', 'ac_cable', 'dcdb', 'acdb',
    'lt_panel', 'conduit', 'earthing', 'earth_access',
    'net_meter', 'civil_work', 'installation_labour', 'transport',
    'miscellaneous', 'walkway', 'gi_cable_tray', 'handrail', 'other'
  ));

-- Soft delete support
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Rate change audit
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS rate_updated_at TIMESTAMPTZ;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS rate_updated_by UUID REFERENCES profiles(id);
```

### D2. Import 217 Items

- Fetch data from Google Sheet (or parse provided CSV/JSON)
- Map columns: Category→item_category, Items→item_description, Make→brand, Qty→default_qty, Units→unit, Rate/Unit→base_price, Vendor→vendor_name
- Category mapping: "Panel"→'panel', "DC & Access"→'dc_access', "LT Panel"→'lt_panel', "Earth & Access"→'earth_access', "GI Cable Tray"→'gi_cable_tray', etc.
- ₹0.00 rates stored as `base_price = 0` (not blocked)
- Data fetched from Google Sheet: https://docs.google.com/spreadsheets/d/1cUOOWQmM5DIeAyM9POv3KCXiTiB7VtUbwEoG33OwKNs/
- Insert as part of migration 046 SQL (INSERT statements) or as a seed script run after migration

### D3. Price Book Page Overhaul

**Files to change:**
- EDIT: `apps/erp/src/app/(erp)/price-book/page.tsx` — full rewrite with CRUD

**New table columns:**
| S.No | Category | Item | Make | Qty | Unit | Rate/Unit | Vendor | Actions |
|------|----------|------|------|-----|------|-----------|--------|---------|

**Features:**
- **Add item:** Dialog with all fields. Purchase Engineer / Admin.
- **Edit item:** Inline click-to-edit on rate, or Edit dialog for all fields. Rate changes set `rate_updated_at = now()`.
- **Delete item:** Admin only. Sets `deleted_at`. Confirm dialog.
- **"Rate pending" badge:** Amber badge on items with `base_price = 0`
- **Filters:** Category dropdown (14 options + all), Make dropdown (dynamic from data), Vendor dropdown (dynamic from data). All with typeahead.
- **Global search:** SearchInput component searching item_description, brand, vendor_name
- **Pagination:** 50 items per page with count:'estimated'

**Visibility:** Accessible to project_manager and purchase_officer (per Vivek's instruction). Add to sidebar for these roles if not already present.

### D4. BOQ/PO Integration

When adding BOQ items or PO line items:
- "Select from Price Book" button opens a searchable picker
- Selecting an item auto-fills: item_description, brand, unit, unit_price (from base_price), hsn_code, vendor
- Rate is pre-filled but overridable by Purchase Engineer
- `price_book_id` FK stored on the line item for traceability

---

## Migrations Summary

| Migration | Tables | Changes |
|-----------|--------|---------|
| **045** | `commissioning_reports`, `net_metering_applications` | Add `engineer_signature_path TEXT`, add `ceig_scope TEXT CHECK (IN ('shiroi','client'))` |
| **046** | `price_book` | Add `vendor_name`, `default_qty`, `deleted_at`, `rate_updated_at`, `rate_updated_by`. Drop+recreate item_category CHECK with 22 categories. Seed 217 items. |

---

## Implementation Order

1. **Batch A** — Project Module (Survey PDF, BOQ qty, DC fix, Execution, Liaison CEIG, Commissioning sigs)
2. **Batch B** — Task / AMC / Tickets corrections
3. **Batch C** — Purchase Order (rate editing, PDF template, actions)
4. **Batch D** — Price Book (migration, import, CRUD, integration)

After all 4 batches: update CLAUDE.md, master reference, commit + push.
Each batch with SQL changes: create migration file first, then apply via MCP.
