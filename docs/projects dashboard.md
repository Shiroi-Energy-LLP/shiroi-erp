# Projects Module — PM Intent & Workflow Reference

> Source: AI Studio prototype by Project Manager (Manivel)
> Location: `docs/Ai studio/Projects/Shiroi-Projects-Dashboard-Flow-main/`
> Purpose: Use this file as the workflow and layout reference when building the projects module screens.
> Cross-referenced against: Master Reference v2.6, Design System, Brand Guide, 134-table schema.
> This is NOT production code — it is a spec derived from the PM's prototype.

---

## 1. What the PM Built

A standalone Vite + React prototype with 7 screens and mock data for 2 sample projects.

| # | Screen | Purpose |
|---|--------|---------|
| 1 | Dashboard | KPI cards, pie chart (project status), operational stats, today's tasks |
| 2 | Project List | Filterable table with status badges and progress bars |
| 3 | Project Detail | 10-step stepper covering the full project lifecycle |
| 4 | Task List | Cross-project execution tasks with daily activity logging |
| 5 | AMC List | Annual maintenance contract records |
| 6 | Service List | Service/maintenance request tracking |
| 7 | Expense List | Per-project expense tracking with summary card |

---

## 2. PM's 10-Step Project Lifecycle

The PM envisions a **linear stepper** on a single page. Each step is a distinct work phase. The stepper is both navigation and progress indicator — the PM clicks any step to jump there, and completed/active/pending states are visible at a glance.

| Step | Name | Data Entered / Reviewed |
|------|------|-------------------------|
| 1 | Project Details | Client info, technical specs, scope assignments, financial overview |
| 2 | Final Site Survey | 30+ field checklist with photo uploads, electrical connectivity, signatures |
| 3 | Bill of Items | BOM line items: category, make, qty, unit, rate, GST, vendor, status |
| 4 | BOQ Budget Analysis | Side-by-side BOQ vs Actual, variance cards, margin highlighting |
| 5 | Delivery Note | DC creation: items from BOM, per-delivery quantities, 4 signature fields |
| 6 | Execution | Task table with 10 milestones, daily activity logs per task |
| 7 | Quality Check | 25+ boolean checklist grouped by category, pass/fail, photos |
| 8 | Liasonning | TNEB (5 milestones) + CEIG (7 milestones), documents per milestone |
| 9 | Commissioning | System overview, test readings, inverter startup, performance, signatures |
| 10 | Free AMC | 4 quarterly visits in Year 1, schedule with status tracking |

**Key intent:** The PM should never leave the project detail page to complete any step.

---

## 3. Dashboard — What the PM Sees at a Glance

### Top KPI Cards (4 across)

| Card | Value | Icon | Color | Trend |
|------|-------|------|-------|-------|
| Total System Size | Sum of all project kWp | Sun | Shiroi Green | % change from last month |
| Total Clients | Unique client count | Users | Steel Blue | New clients this month |
| Total Sales | Sum of project budgets (₹ in Lakhs) | IndianRupee | Lime | % growth |
| Avg. Profit % | (Sales - Actual Cost) / Sales | TrendingUp | Cyan | ₹ per project avg |

### Middle Section (2/3 + 1/3 grid)

- **Left 2/3:** Donut pie chart — project count by status (brand color sequence)
- **Right 1/3:** Two widgets stacked:
  - **Operations widget:** Progress bars for Open Tasks, Open Services, AMCs This Month (ratio of open/total)
  - **Today's Tasks widget** (dark panel, #001F0D): Top 3 projects with location + status, clickable to detail

**PM's intent:** Portfolio health overview — capacity, revenue, and what needs attention today. Zero clicks to know if something is off. This is a PM-centric view (not the founder dashboard, which prioritises cash position and alerts).

---

## 4. Project List

### Layout
- Header: "All Projects" title + "New Project" button (top right)
- Filter bar: Search + Status dropdown + System Size dropdown
- Table below

### Columns

| Column | Content | Notes |
|--------|---------|-------|
| Client ID | e.g., CL001 | Short identifier |
| Project Name | Full name | Primary click target → opens detail |
| System Size | X kWp | With Zap icon |
| Location | City/area | With MapPin icon |
| Status | Badge | Colour-coded |
| % Complete | Number + progress bar | Visual indicator |
| Start Date | DD MMM YYYY | |
| End Date | DD MMM YYYY | |
| Remarks | Short text | Truncated with tooltip |

### Filters the PM uses daily
- **Text search** across project name, client ID, location
- **Status:** All / Confirmed / In Progress / Completed / On Hold
- **System size:** All / <10 kWp / 10–50 kWp / >50 kWp

---

## 5. Project Detail — Per-Step Deep Dive

### Step 1: Project Details

Three cards: 2-column grid + full-width financial card.

**Card 1 — Client Information:**
Contact Name, Contact Number, Email, Location, Complete Address, Google Maps Link. Inline edit mode (toggle edit icon per card).

**Card 2 — Technical Specifications:**
System Size (kWp), System Type (On Grid / Off Grid / Hybrid), Mounting Type (Low Raise / Elevated / Asbestos Shed / Metal Shed), Mounting Structure (GI / MS / Mini Rails / Long Rails / Customized), Inverter Make, Panel Make, Cable Make, Scope assignments (LA, Civil, Statutory, CEIG — each Shiroi or Client), Remarks.

**Card 3 — Financial Overview (full width):**
4 stat boxes: Contract Value, Considered Margin %, Actual Cost (BOI + Expenses), Actual Margin %. Margin highlighted green if positive, red if negative.

### Step 2: Final Site Survey

Comprehensive site feasibility form:
- Project selection dropdown (for copying data from another project)
- Location (lat/lng + address), Mounting feasibility, Roof type (RCC / Metal / Tile / Ground Mount)
- Shadow analysis (boolean + source text if shadowed)
- 8 location items, each with boolean + photo upload: Mounting procedure, Fixing arrangement, Inverter location, DC cable routing, Earthing pit, LA location, Termination point, Spare feeder
- Electrical: Meter details, Phase type, Connected load, Sanctioned load
- AC cable routing (boolean + photo)
- Deviations: boolean + free-text per type (general, panels, inverter, routing, cable, other)
- Client signature + Engineer signature (signature canvas)
- Submit button with timestamp

### Step 3: Bill of Items (BOM)

Editable table with line items:

| Column | Type | Values |
|--------|------|--------|
| Category | Dropdown | 14 categories (see Section 11) |
| Description | Text | Free text |
| Make | Text | Manufacturer/brand |
| Qty | Number | |
| Unit | Text | Nos, Mtrs, Sets, etc. |
| Status | Dropdown | 6 stages (see Section 11) |
| Rate | Number | Per unit |
| GST % | Number | |
| Vendor | Text | |

- Add/delete rows. Auto-calculated line total = Rate x Qty x (1 + GST%). Footer shows grand total.
- "Prepared By" field.

### Step 4: BOQ Budget Analysis

Side-by-side comparison:
- Left column: BOQ (planned budget per category)
- Right column: Actual (from BOM line items + expenses)
- Variance column: over/under per category
- 3 summary cards: Total BOQ Budget, Total Actual Cost, Variance (green if under, red if over)
- "Budget Analysis Completed" checkbox

### Step 5: Delivery Note

Multiple DCs per project:
- DC Number (DC1, DC2, etc.), Date
- Items selected from BOM, per-item quantity delivered
- 4 signature fields: Receiver, Authorized Signatory, Client, Engineer (signature canvas)
- Add / delete deliveries

### Step 6: Execution

Task table pre-populated from 10 execution milestones (see Section 11). Each task has: Category, Title, Assigned To, Assigned Date, Action Date, Status (Open / In Progress / Closed), Done By, Remarks.

**Daily Logs per task** (expandable row): Date, Activity description, Done By, Remarks. PM adds logs day by day. Custom tasks beyond the 10 milestones can be added. Inline edit + delete per task.

### Step 7: Quality Check

Structured inspection checklist grouped by category:

- **Panel Installation:** Panels secure, Tilt angle correct, No damage, Panels clean
- **Mounting Structure:** Aligned, Bolts tight, Corrosion protection, Earthing complete
- **Electrical Wiring:** Cable routing correct, MC4 connectors fixed, No exposed wires, Insulation intact
- **Inverter:** Properly installed, Display working, No errors, Ventilation OK
- **Safety & Protection:** Earthing resistance OK, LA installed, SPD installed, Grounding secure
- **Battery (if hybrid):** Installed, Terminals tight, No leakage, Ventilation OK
- **System Performance:** Generating power, Voltage in limits, Monitoring working
- **Safety Compliance:** Warning signs, Fire extinguisher, Site clean

Each item: pass/fail toggle. Overall status: Approved / Rework Required. Inspector name, date, remarks, photo upload per section.

### Step 8: Liasonning Process

Two parallel tracks:

**TNEB/DISCOM (5 milestones):**
1. Documents Collected → 2. Registration → 3. Estimate Paid → 4. Inspection Arranged → 5. Net Meter Installed

**CEIG (7 milestones):**
1. Documents Collected → 2. Registration → 3. Estimate Paid → 4. Drawing Approved → 5. Inspection Arranged → 6. DR/RR Received → 7. Final Approval

Each milestone: Completed (boolean), Date, Completed By, Document (upload).

### Step 9: System Commissioning

**System Overview:** Type, Module type, Inverter model, Mounting type, # modules, # inverters

**Installation Details:** Tilt angle, Orientation, Structure type, Cable size, Earthing details

**Pre-Commissioning Checks:** String connection, DC polarity, AC breaker, Earthing continuity, SPD, Fire safety

**Test Results (numerical):**
- String Voc (V), String Isc (A), Insulation Resistance (megaohm) — *critical: <0.5 triggers auto-ticket in DB*
- Output Voltage (V), Frequency (Hz), Earthing Resistance (ohm)
- Polarity Check (pass/fail), Phase Sequence (pass/fail)

**Inverter Commissioning:** Startup, Grid sync, Parameters configured, Fault status

**Performance:** Initial power, Expected power, Performance ratio, Monitoring working

**Monitoring Credentials:** Login, Password, Link

**Signatures:** Client + Engineer (canvas). Declaration checkbox + Remarks.

### Step 10: Free AMC

Schedule table: Visit #, Scheduled Date, Status (Pending / Completed / Missed), Completed Date, Engineer, Report URL, Remarks. "Generate Schedule" button auto-creates 4 quarterly visits from commissioning date.

---

## 6. Cross-Project Screens

### Task List
- Flattened view of all execution tasks across all projects
- Filters: Search, Status, Project, Engineer
- Table: Task Description, Project Name, Assigned To, Date, Status
- Expandable daily logs per task
- Add/edit/delete tasks via modal
- Click project name → navigate to that project's detail

### Service List
- Table: Project Name, Description (+ create date), Assigned To (+ action date), Amount (₹), Status (Open / In Progress / Closed)
- Filters: Search, Status
- Add service button

### AMC List
- Table: Project Name, Type, Category (Free AMC / Paid AMC), Assigned To, Action Date, View Report
- Filters: Search, Category
- Add AMC record button

### Expense List
- **Summary card at top:** Total expenses across visible records
- Table: Project Name, Category, Description (+ voucher #), Engineer, Amount (₹), Status, View Receipt
- Categories: Travel & Allowance, Food & Accommodation, Local Expenses, Material Purchase, Transport
- Filters: Search, Category

---

## 7. Visual & UX Preferences

### Layout
- **Sidebar navigation** (not top nav) — collapsible (240px → 56px), dark theme (#001F0D)
- **User avatar** in sidebar footer with name + role
- **Header:** white background, page title, search bar, "+ New" action button
- **Content:** light background (#F6FAF6), white cards/tables
- **Dense tables** preferred over cards for lists

### Component Patterns
- White card backgrounds, subtle borders (border-n200), rounded corners
- Framer Motion transitions between stepper steps (slide left/right)
- Progress bars for completion ratios (thin, 1px height)
- Status badges: pill-shaped, coloured background + text
- Icon + text for info fields (icon left, label above value)
- Inline edit pattern: toggle per card section, not per field (edit icon → save/cancel buttons)

### Interactions
- **Stepper is clickable** — PM can jump to any step, not sequential only
- **Rows are clickable** — entire table row navigates to detail
- **Expandable rows** — task list rows expand for daily logs
- **Modal forms** — for adding/editing records (not full-page navigation)
- **Signature canvas** — for survey, delivery notes, commissioning
- **Photo uploads** — for survey items and QC checks

---

## 8. Data Model Differences — PM vs Database Schema

| Area | PM's Model | Database Schema | Resolution |
|------|-----------|----------------|------------|
| **Project status** | `Confirmed / In Progress / Completed / On Hold` | Full lifecycle enum: `survey → proposal_accepted → in_progress → commissioning → commissioned → handed_over` etc. | Use DB enum. PM's 4 statuses are too coarse for the real pipeline. |
| **BOM naming** | "BOI" (Bill of Items) | "BOM" (Bill of Materials): `proposal_bom_lines`, `bom_correction_factors` | Use "BOM" terminology. PM's 14 categories and 6 statuses are useful UI reference. |
| **Financial model** | `budget`, `actualBudget`, `margin` — 4 fields | `project_cash_positions` (incoming - outgoing = net), `is_invested` flag, `project_profitability`, `project_cost_variances`, invoices, payments | Use DB model. PM's budget-vs-actual intent is correct, but numbers come from `project_cash_positions`. Surface `is_invested` prominently — Vivek's #1 signal. |
| **Tasks** | `ExecutionTask[]` per project with embedded `DailyLog[]` | Universal `tasks` table (`entity_type + entity_id`), separate `daily_site_reports` with photo gates, corrections, 48h lock | Use DB model. Daily logs are a separate reporting concern with Tier 2 immutability. |
| **Quality checks** | Flat 25+ booleans | `qc_gate_inspections` (3 gates = payment gates) + `qc_non_conformance_reports` | Use 3-gate model: Gate 1 (Materials → 40%), Gate 2 (Mid-install), Gate 3 (Pre-commissioning → 20%). PM's checklist items are useful for the form UI within each gate. |
| **Liaison** | Boolean milestones per TNEB/CEIG step | `net_metering_applications` + `liaison_documents` + `liaison_objections` + CEIG-blocks-TNEB trigger | Use document-driven model. PM correctly identified the two parallel tracks. Add objection tracking and CEIG gate enforcement. |
| **Expenses** | `Expense[]` per project (Travel, Food, etc.) | No standalone expense table. Costs flow through `purchase_orders` → `vendor_payments` → `project_cash_positions` | PM's intent is valid. Field expenses should either route through POs/vendor payments or a new lightweight reimbursement table. Evaluate during build. |
| **AMC / O&M** | Simple `AMCRecord` | Full pipeline: `om_contracts` → `om_pricing_rules` → `om_visit_schedules` → `om_visit_reports` → checklist + corrections + profitability | Use DB model. PM's list view is fine for the table; detail must show full visit schedule and cost tracking. |
| **Service tickets** | `ServiceRecord` (description, status, amount) | `om_service_tickets` with SLA enforcement, priority escalation, auto-creation from IR < 0.5 megaohm | Use DB model. Add SLA countdown, escalation chain, and auto-creation context. |
| **% Complete** | `percentComplete` as a stored number | Calculated from milestone sub-components (weighted average, DB trigger enforces weights sum to 100%) | Never store manually — always computed from milestone completion. |

### Missing from PM's Prototype Entirely

| Missing | Why It Matters | Priority |
|---------|---------------|----------|
| Lead pipeline + lead detail | Sales team daily driver (build order #2) | Different module — not PM's scope |
| Proposal creation flow | BOM, margin logic, correction factors (build order #3) | Connects to PM's BOM/budget tabs |
| **Project cash position** | The most important financial screen (#5). `is_invested` flag, net position | **Critical — must be added to project detail** |
| **Procurement pipeline** | POs, vendor DCs, GRN, three-way match | **Critical — core PM daily workflow** |
| Photo gates | Mandatory site photo verification per milestone | High — part of daily report flow |
| Document numbering | `SHIROI/TYPE/FY/SEQ` on all outward docs | Required on every record display |
| Commissioning → handover | Handover pack generation, customer check-in scheduling | High — end of PM lifecycle |

---

## 9. Brand Guide Violations to Fix

| Issue | Correct Value |
|-------|---------------|
| `green-500` for completed stepper steps | Use `shiroi-green` (#00B050) for all completed states |
| `text-blue-500` for Google Maps link | Use `text-steel` (#4F81BD) or `text-shiroi-green` |
| Card titles use `font-brand` (Rajdhani) | Use `font-display` (Oswald) for card/section headers. Rajdhani is brand name only. |
| Solar Yellow as stat card icon background | Violates WCAG on white. Use as accent/border only. |
| `DollarSign` icon for currency | Use `IndianRupee` from Lucide or text `₹` |
| Status badges use opacity variants (`bg-shiroi-green/10`) | Use exact design system colours: Success `#D1FAE5`/`#065F46`, Pending `#FEF3C7`/`#7A5A00`, Error `#FEE2E2`/`#8A1A1A`, Info `#DBEAFE`/`#1A4A8A` |
| Card border-radius inconsistent (`xl` vs `2xl`) | Use `rounded-[10px]` (cards), `rounded-[14px]` (large containers) |
| Table row height not set | Set 44px standard density |
| No tooltip on truncated text | Required by design system |
| Delete buttons always visible | Hide by role — restricted actions are hidden, never disabled |
| No proper empty states | Use: 48px icon (60% opacity) + Oswald 18px title + Inter 13px desc (max 320px) + CTA |
| `any` TypeScript type on StatCard/OpStat | Type properly — never `any` |

---

## 10. What to Keep and What to Improve

### Keep from the PM's Design

1. **10-step stepper** — excellent lifecycle navigation. Adapt step names to DB stages.
2. **Inline edit per card section** — toggle view/edit per section, not per field or full page.
3. **Cross-project task view** — "all my tasks today" across projects. Wire to `tasks` table.
4. **Daily activity logging** — real operational need. Route through `daily_site_reports`.
5. **Delivery note with signatures** — maps to `vendor_delivery_challans` + `dc_signatures`.
6. **Side-by-side budget analysis** — BOQ vs actual with variance. Route through `project_cost_variances`.
7. **AMC schedule generation** — auto-create visits from commissioning date. Maps to `om_visit_schedules`.
8. **Dense-table-with-sidebar layout** — matches design system's ERP web principle.
9. **Dashboard grid:** 4-col stat cards + 2/3 chart + 1/3 operations + dark "today" widget.
10. **Donut chart** for status distribution, **progress bars** for ratios, **animated stepper transitions**.

### Improve When Building

1. **Cash position front and centre** — PM shows sales/profit but not cash flow. `is_invested` and net cash position must be the most prominent financial indicators.
2. **Alerts and action items** — "Today's Tasks" should show: overdue reports (no daily report by 7pm), cash-negative projects, SLA breaches, MSME payment deadlines — not just 3 random projects.
3. **Document numbering** — every project, invoice, PO, DC should display its `SHIROI/TYPE/FY/SEQ` reference.
4. **Procurement sub-workflow** — PO → DC → GRN → three-way match is critical and entirely absent.
5. **Correction model awareness** — daily reports and QC inspections should show lock status (editable / locked / correction-only) based on 48h rule.
6. **CEIG gate enforcement** — liaison step must visually block TNEB progress until CEIG approved (for >10kW commercial).
7. **Role-based visibility** — hide delete/admin actions for non-authorized roles.
8. **Typography hierarchy** — Oswald for headers, Inter for body, Rajdhani for brand name only.

---

## 11. Implementation Mapping — PM Screens to Build Order

| Master Ref Priority | PM's Equivalent | Build As |
|---------------------|-----------------|----------|
| #1 Founder morning dashboard | PM's Dashboard (adapted) | First screen. Add: cash-negative projects, pending proposals, overdue reports. Remove: PM-specific task metrics. |
| #4 Project detail + milestones | PM's Project Detail stepper | Adapt the 10-step stepper. Wire to DB tables. Add: cash position tab, procurement tab. |
| #5 Project cash position | Not in PM prototype | Dedicated tab in project detail AND standalone list view. `is_invested` prominent. |
| N/A | PM's Task List | Cross-project task view. Wire to `tasks WHERE entity_type = 'project'`. |
| N/A | PM's Expense List | Evaluate if `project_expenses` table needed. Otherwise wire to PO/vendor payment flow. |
| N/A | PM's AMC List | Wire to `om_contracts` + `om_visit_schedules`. Simple list view. |
| N/A | PM's Service List | Wire to `om_service_tickets`. Add SLA indicators. |

---

## 12. Reference Constants (for Dropdowns)

### BOM Categories (14)
Solar Panels, Inverter, MMS, DC & Accessories, AC & Accessories, Conduits, Miscellaneous, Safety & Accessories, Earth & Accessories, Generation Meter & Accessories, I&C, Statutory Approvals, Transport & Civil, Others

### BOM Statuses (6)
Yet to Finalize, Yet to Place, Order Placed, Received, Ready to Dispatch, Delivered

### Execution Milestones (10)
Site Visit, Design Approval, Material delivery, Structure installation, Civil Work, Panel installation, DC conduit & cable wiring work, AC Conduit & cable wiring work, Inverter DCDB & ACDB installation, Earth Pit installation & termination

### Expense Categories (6)
Travel & Allowance, Food & Accommodation, Local Expenses, Material Purchase, Transport, Others

### Enums
- **System Types:** On Grid, Off Grid, Hybrid
- **Mounting Types:** Low Raise, Elevated, Asbestos Shed, Metal Shed
- **Mounting Structures:** GI, MS, Mini Rails, Long Rails, Customized
- **Scope:** Shiroi, Client

---

*Derived from AI Studio prototype review, March 29, 2026.*
*Use alongside: `docs/SHIROI_MASTER_REFERENCE_2_6.md` and `docs/Shiroi_ERP_Design_System.md`*
*The prototype code in `docs/Ai studio/` is reference only — do not port into the ERP codebase.*
