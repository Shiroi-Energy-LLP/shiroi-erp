# Shiroi ERP — Role-Specific Dashboards & Phase 2 Build Design

> **Spec version:** 1.1 | **Date:** 2026-03-30
> **For:** Master Reference v3 integration
> **Scope:** 8 role-specific dashboards, 2 new `app_role` values, complete handoff chain

---

## 1. New Roles & Updated Enum

### Two new `app_role` values

| Role | Person | Receives from | Produces | Hands off to |
|------|--------|--------------|----------|-------------|
| `designer` | System designer | Sales (qualified leads) | AutoCAD drawings, system design, automated proposal (approved) | Sales (for closure) |
| `purchase_officer` | Purchase team | PM (project BOM) | Vendor quotes comparison, POs, delivery tracking, DC, GRN | PM (materials on site) |

### Updated 10-role enum

```sql
ALTER TYPE app_role ADD VALUE 'designer';
ALTER TYPE app_role ADD VALUE 'purchase_officer';
```

Order: `founder`, `hr_manager`, `sales_engineer`, `designer`, `project_manager`, `purchase_officer`, `site_supervisor`, `om_technician`, `finance`, `customer`

### Complete Handoff Chain

```
Sales Engineer → Designer → Sales Engineer (closure) → PM (BOM) → Purchase Officer (quotes, PO, delivery, DC, GRN) → PM (execution) → Site Supervisor (daily) → PM (QC, commissioning) → O&M Technician
```

---

## 2. Dashboard Architecture

### 2.1 Role-adaptive dashboard

**Single adaptive route:** `/dashboard` renders different content based on `get_my_role()`.

```typescript
// apps/erp/src/app/(erp)/dashboard/page.tsx
const profile = await getUserProfile();
switch (profile.role) {
  case 'founder':        return <FounderDashboard />;
  case 'project_manager': return <PMDashboard />;
  case 'om_technician':  return <PMDashboard />; // same team
  case 'site_supervisor': return <SupervisorDashboard />;
  case 'sales_engineer': return <SalesDashboard />;
  case 'designer':       return <DesignerDashboard />;
  case 'purchase_officer': return <PurchaseDashboard />;
  case 'finance':        return <FinanceDashboard />;
  case 'hr_manager':     return <HRDashboard />;
}
```

### 2.2 Universal "My Tasks" widget on every dashboard

Every role sees a **"My Tasks" section** on their dashboard, showing tasks from the universal `tasks` table filtered by `assigned_to = get_my_employee_id()`. This is the first thing they see after KPI cards.

| Column | Content |
|--------|---------|
| Task | Description |
| Entity | Project name / Lead name / Ticket # (from `entity_type + entity_id`) |
| Due | Date with overdue highlighting |
| Priority | High / Medium / Low badge |
| Status | Open / In Progress — tap to update |

Tasks with `status = 'open'` and `due_date <= today` shown in red. Sorted: overdue first, then by due date ascending.

### 2.3 Founder Role Switcher

The **founder** gets a role switcher dropdown in the topbar (next to the sign-out button). This allows Vivek to view any role's dashboard without logging out.

```typescript
// Topbar component — only rendered for founder role
{profile.role === 'founder' && (
  <RoleSwitcher
    currentView={viewAsRole}
    onSwitch={(role) => router.push(`/dashboard?view_as=${role}`)}
  />
)}
```

When `?view_as=project_manager` is in the URL and the user is a founder, the dashboard renders the PM view. The topbar shows a banner: "Viewing as: Project Manager" with a "Back to Founder" button. **Data still respects founder's full access** — this only switches the dashboard layout, not the RLS permissions.

Available views: Founder (default), PM, Sales, Designer, Purchase, Finance, HR, Supervisor, O&M

### 2.4 Each role is a complete workspace

Every role has a **sidebar with multiple nav sections** — not just a dashboard. The sidebar groups related pages under section headings. This follows the PM's prototype pattern where Projects, Tasks, AMC, Service, Expenses were all separate sidebar items.

Sidebar sections are grouped by domain with uppercase section labels (per Design System: 9px, uppercase, letter-spacing .2em, `#668B6A`).

---

## 3. Dashboard #1 — Founder (EXISTING — enhance)

**Already built in Step 9.** Enhancements needed:

| Enhancement | Detail |
|-------------|--------|
| Donut chart | Project count by status (brand color sequence) |
| Revenue trend | 6-month bar chart from company_cashflow_snapshots |
| Team utilization | Active project count per PM |
| Quick nav | Clickable KPI cards navigate to detail pages |

**No structural changes needed — just add charts and polish.**

---

## 4. Dashboard #2 — Project Manager + O&M + Service

**The PM's primary workspace.** This is the biggest build — covers the PM's entire daily workflow.

### 4.1 PM Dashboard (landing page)

**Top KPI Cards (4 across):**

| Card | Source | Icon |
|------|--------|------|
| Active Projects | `projects WHERE status NOT IN (completed, cancelled)` count | HardHat |
| Total System Size | SUM of assigned project kWp | Sun |
| Open Tasks | `tasks WHERE entity_type='project' AND status='open'` count | CheckSquare |
| Open Service Tickets | `om_service_tickets WHERE status NOT IN (resolved, closed)` count | Wrench |

**Middle Section (2/3 + 1/3):**
- Left 2/3: Donut chart — assigned project count by status
- Right 1/3: Operations widget (progress bars: tasks completion %, reports submitted today/total, QC gates pending) + Today's priority panel (dark bg #001F0D): top 3 projects needing attention with location + status

**Bottom:** Overdue alerts table — no report by 7pm, uninvoiced milestones >48h, SLA breaches, DISCOM objections >14 days

### 4.2 PM Project Detail — 10-Step Stepper

**This replaces the current tab-based project detail.** Single page with a clickable horizontal stepper at the top. Each step loads content below the stepper. PM can jump to any step.

**Stepper visual:** Connected circles with labels. Completed = green fill + checkmark. Active = green ring with pulse. Pending = gray. Framer Motion slide transition between steps.

| Step | Name | Content | DB Tables |
|------|------|---------|-----------|
| 1 | **Project Details** | Client info card (inline edit), tech specs card (inline edit), financial overview card (contract value, margin %, actual cost, actual margin) | `projects`, `project_cash_positions`, `project_profitability` |
| 2 | **Site Survey** | Read-only display of lead site survey data. Link to lead detail if needed. 30+ fields from `lead_site_surveys` with photos. | `lead_site_surveys`, `site_photos` |
| 3 | **Bill of Materials** | Editable BOM table from proposal. Category, description, make, qty, unit, rate, GST%, vendor, status (6 stages). Add/delete rows. Auto-calc totals. | `proposal_bom_lines` (read), project-level BOM (if separate) |
| 4 | **BOQ Analysis** | Side-by-side: BOQ (planned from proposal) vs Actual (from POs + expenses). Variance per category. 3 summary cards: Total BOQ, Total Actual, Variance (red/green). | `project_cost_variances`, `proposal_bom_lines`, `purchase_order_items` |
| 5 | **Delivery Notes** | List of DCs per project. Create DC from BOM items. Per-item qty delivered. Signature fields (receiver, authorized, client, engineer). | `vendor_delivery_challans`, `vendor_delivery_challan_items`, `dc_signatures` |
| 6 | **Execution** | Task table: 10 milestones pre-populated + custom tasks. Daily activity logs per task (expandable rows). Status, assigned to, dates. Milestone completion % computed. | `tasks`, `project_milestones`, `daily_site_reports` |
| 7 | **Quality Check** | 25+ boolean checklist grouped by category (panels, structure, electrical, inverter, safety, battery, performance, compliance). Inspector name, date, photos per section. Pass/fail per gate. | `qc_gate_inspections` (JSONB checklist), `site_photos` |
| 8 | **Liaison** | Two parallel tracks: TNEB/DISCOM (5 milestones) + CEIG (7 milestones). Each: completed boolean, date, completed by, document upload. CEIG gate blocks TNEB net meter step for >10kW commercial. | `net_metering_applications`, `liaison_documents`, `liaison_objections` |
| 9 | **Commissioning** | System overview, installation details, pre-commissioning checks, test results (Voc, Isc, IR in MΩ — <0.5 triggers auto-ticket), inverter startup, performance readings, monitoring credentials, signatures. | `commissioning_reports` |
| 10 | **Free AMC** | 4 quarterly visits auto-created from commissioning date. Schedule table: visit #, date, status, engineer, report link. Generate schedule button. | `om_visit_schedules`, `om_visit_reports` |

### 4.3 Cross-Project Views (PM)

| View | Route | Content |
|------|-------|---------|
| All Tasks | `/tasks` | Flattened tasks across all assigned projects. Filter: search, status, project, engineer. Expandable daily logs. |
| Service Tickets | `/om/tickets` | All tickets for PM's projects. SLA countdown, priority, status. |
| AMC Schedule | `/om/schedule` | All O&M visits for PM's projects. Status, next visit date. |

### 4.4 Nav Items for `project_manager`

Dashboard, Projects, Tasks, Procurement, O&M

### 4.5 Nav Items for `om_technician`

Dashboard (same PM dashboard), O&M (visits, tickets, plants)

---

## 5. Dashboard #3 — Site Supervisor

**Mobile-first design even on desktop.** Large touch targets. Minimal navigation. Pre-populated fields.

### 5.1 Supervisor Dashboard

**Primary focus: today's work on the active project. But can access old projects too.**

| Section | Content |
|---------|---------|
| My Tasks | Open tasks assigned to this supervisor (overdue first, then by due date). |
| Active Project Card | Project name, location, current milestone, days since start. Tap → project detail. |
| Today's Report | Status: Submitted / Not yet. If submitted: summary. If not: big "Submit Report" button. |
| Recent Reports | Last 5 reports with lock status (padlock icon if >48h). |
| All Projects | Link to full project list (read-only). Allows looking up any old project if a previous client calls. Search by customer name, phone, project number. |

### 5.2 Daily Report Form

**90-second target. Pre-populated from yesterday + project context.**

| Field | Pre-populated? | Input Type |
|-------|---------------|------------|
| Date | Today | Read-only |
| Project | Active assignment | Read-only |
| Current milestone | From project_milestones | Dropdown |
| Workers on site | Yesterday's count | Number stepper |
| Supervisors | Yesterday's count | Number stepper |
| Weather | Default: sunny | Quick-tap presets |
| Panels installed today | 0 | Number |
| Structure progress | — | Quick-tap: Not started / In progress / Complete |
| Electrical progress | — | Quick-tap: Not started / In progress / Complete |
| Materials received? | No | Toggle |
| Issues? | No | Toggle → text area if yes |
| Photos | — | Camera button (Supabase Storage) |

### 5.3 Nav Items for `site_supervisor`

Dashboard, My Reports (list + new)

---

## 6. Dashboard #4 — Sales Engineer + Marketing + Liaison

**CRM-centric. The sales funnel is the primary view.**

### 6.1 Sales Dashboard

**Top KPI Cards (4 across):**

| Card | Source |
|------|--------|
| New Leads This Month | `leads WHERE created_at >= month_start AND status = 'new'` |
| Pipeline Value | SUM of `proposals.total_after_discount` for active proposals |
| Won This Month | `leads WHERE status = 'won' AND converted_at >= month_start` count |
| Conversion Rate | Won / Total qualified this month (%) |

**Middle Section:**
- Left 2/3: Lead funnel chart (new → contacted → survey → proposal → negotiation → won) with counts at each stage
- Right 1/3: My follow-ups today (leads with `next_followup_date = today`)

**Bottom:** Recent activity feed across all leads

### 6.2 Lead Pipeline (EXISTING — already built)

Enhance with:
- **Kanban view option** (toggle between table and kanban by status)
- **Lead handoff to designer:** When lead status moves to `site_survey_done`, show "Send to Design" button
- **Lead return from designer:** When designer completes proposal, lead shows "Proposal Ready — Follow Up" badge

### 6.3 Marketing Tab

| Section | Content |
|---------|---------|
| Active Drip Campaigns | `drip_sequences` with enrollment counts, open/click rates |
| Channel Partners | List from `channel_partners` with lead counts, conversion rates |
| Campaign Performance | `marketing_campaigns` with delivery stats from `marketing_campaign_deliveries` |

### 6.4 Liaison Tracking (for sales-managed liaison)

If sales engineers handle liaison in some cases:
- View `net_metering_applications` for their won leads
- Track TNEB/CEIG milestone progress
- Upload liaison documents

### 6.5 Nav Items for `sales_engineer`

Dashboard, Leads, Proposals, Marketing, Liaison

---

## 7. Dashboard #5 — Designer

**Design-centric workflow. Receives qualified leads, produces system designs and proposals.**

### 7.1 Designer Dashboard

**Top KPI Cards (4 across):**

| Card | Source |
|------|--------|
| Pending Designs | Leads with `status = 'site_survey_done'` not yet assigned a proposal |
| In Progress | Proposals in `draft` status created by this designer |
| Completed This Month | Proposals sent/approved this month by this designer |
| Avg Design Time | Average days from lead assignment to proposal completion |

**Main Section: Design Queue**

Table of leads awaiting design:

| Column | Content |
|--------|---------|
| Lead | Customer name, phone |
| Location | City, site address |
| System Size | Estimated kWp from site survey |
| Survey Date | When site survey was completed |
| Assigned | When lead was assigned to designer |
| Days Waiting | Since assignment |
| Action | "Start Design" button |

### 7.2 Design Workspace (per lead)

When designer clicks "Start Design" or opens a lead:

**Left panel (lead context):**
- Customer info (name, phone, email, address)
- Site survey data (roof type, mounting, shadow analysis, electrical details)
- Site survey photos
- Google Maps link

**Right panel (design tools):**

| Section | Content |
|---------|---------|
| System Configuration | System type, size (kWp), panel make/model/count, inverter make/model, battery (if hybrid), structure type, mounting type |
| Design Files | Upload zone for AutoCAD (.dwg), PDF layouts, SLD diagrams. Stored in Supabase Storage: `designs/{leadId}/` |
| Simulation | Trigger PVWatts/PVLib simulation with configured system params. Show monthly/annual kWh estimates. |
| Auto-Quote Generation | Button: "Generate Proposal" → auto-creates proposal from system config + price book + correction factors. Shows: subtotals (supply/works), GST split, discount, total, margin %. |
| Quote Review | Designer reviews auto-generated amounts, can adjust. Must approve before sending to sales. Financial data visible (margin %, cost, revenue). |
| Status Actions | "Approve & Send to Sales" → moves lead to `proposal_sent`, notifies sales engineer |

### 7.3 Design Files Storage Pattern

```
Supabase Storage: designs/
  {leadId}/
    panel-layout.dwg
    panel-layout.pdf
    sld.pdf
    string-diagram.pdf
    shadow-analysis.pdf
```

Path stored in `lead_documents` table.

### 7.4 Nav Items for `designer`

Dashboard, Design Queue, Leads (read-only detail view)

---

## 8. Dashboard #6 — Purchase Officer

**Procurement-centric. Manages the full PO lifecycle after PM creates BOM.**

### 8.1 Purchase Dashboard

**Top KPI Cards (4 across):**

| Card | Source |
|------|--------|
| Pending POs | Projects with BOM but no PO placed yet |
| Active POs | `purchase_orders WHERE status IN ('placed', 'partially_delivered')` |
| Pending Deliveries | POs with `expected_delivery_date` approaching |
| MSME Alerts | Vendor payments approaching 45-day limit |

**Main Section:**
- MSME Alert Banner (red/amber for any vendor at Day 40+)
- PO pipeline table: project, vendor, PO amount, status, delivery date, days since order

### 8.2 Purchase Workflow (per project)

When PM marks BOM ready, Purchase Officer sees it in their queue:

**Step 1 — Get Quotes:**
- View project BOM line items
- For each item/category: create `rfq_requests` to multiple vendors
- Receive `rfq_responses` with quoted prices
- Comparison table: item × vendor matrix with prices, delivery time, terms

**Step 2 — Place PO:**
- Select winning vendor per item/category
- Generate PO from selected quotes
- PO approval workflow (auto if within budget, PM approval if over)
- Soft block: no PO before advance received (override with confirmation)

**Step 3 — Track Delivery:**
- Expected delivery dates
- Create DC when materials arrive (`vendor_delivery_challans`)
- DC items: quantity per BOM line received
- Signature capture (receiver, authorized)

**Step 4 — GRN (Goods Receipt):**
- Inspect received materials against DC
- Accept/reject quantities
- `goods_receipt_notes` + `grn_items`
- Three-way match visual: PO qty vs DC qty vs GRN qty (mismatch highlighted)

**Step 5 — Hand back to PM:**
- When all materials received and GRN complete → project status moves to installation phase
- PM notified: "Materials ready for {project_number}"

### 8.3 Vendor Management

| Section | Content |
|---------|---------|
| Vendor List | `vendors` table. Name, contact, MSME status, GSTIN, rating |
| Vendor Performance | Average delivery time, rejection rate, price accuracy vs price book |

### 8.4 Master Price Book (Purchase Officer is the owner)

The Purchase Officer is the **primary maintainer** of the `price_book` table. This is critical because the price book feeds directly into quote automation for the Designer.

| Feature | Detail |
|---------|--------|
| Price List | Full editable table: item category, description, vendor, unit rate, GST %, last updated, source |
| Bulk Update | Import from vendor quotation CSV → update matching items |
| Staleness Flag | `update_recommended = true` auto-set by DB trigger when actual purchase price diverges >5% on 3+ purchases |
| History | Every price change logged with date, old price, new price, changed by |
| Vendor Comparison | Same item across multiple vendors: price, lead time, quality rating |
| Export | CSV export of current price book for sharing with PM/Designer |

**Flow:** Purchase Officer updates price book from real vendor quotes → Designer's auto-quote engine uses these prices → Proposals reflect actual market rates → No more margin erosion from stale pricing.

### 8.4 Nav Items for `purchase_officer`

Dashboard, Purchase Orders, Vendors, Price Book

---

## 9. Dashboard #7 — Finance

**Cash and compliance focused. The most numbers-dense dashboard.**

### 9.1 Finance Dashboard

**Top KPI Cards (4 across):**

| Card | Source |
|------|--------|
| Total Invested Capital | SUM of negative `net_cash_position` across all projects |
| Total Receivables | SUM of `total_outstanding` from `project_cash_positions` |
| MSME Due This Week | Count of vendor payments due within 7 days |
| Overdue Invoices | Count of invoices past due date |

**Middle Section:**
- Left 2/3: 6-month cashflow bar chart (received vs paid per month)
- Right 1/3: Invoice escalation summary (Day 1/5/10/30 counts)

**Bottom:** Cash-negative projects table (same as founder dashboard but with more detail: net position, days invested, last payment date)

### 9.2 Finance-Specific Views (EXISTING — enhance)

| View | Status | Enhancement |
|------|--------|-------------|
| Company Cash Flow | Built (Step 14) | Add monthly trend chart, export to CSV |
| Per-Project Cash | Built (Step 14) | Add invoice creation action, payment recording |
| Invoices | Not built | Full invoice list, create, send, escalation tracking |
| Payments | Not built | Customer payment recording, vendor payment recording, bank reconciliation view |
| Profitability | Not built | `project_profitability` + `project_cost_variances` per project |

### 9.3 Nav Items for `finance`

Dashboard, Cash Flow, Invoices, Payments, Projects (read-only cash tab), Profitability

---

## 10. Dashboard #8 — HR Manager

**People and compliance focused.**

### 10.1 HR Dashboard

**Top KPI Cards (4 across):**

| Card | Source |
|------|--------|
| Active Employees | `employees WHERE is_active = true` count |
| Pending Leave Requests | `leave_requests WHERE status = 'pending'` count |
| Certifications Expiring | `employee_certifications WHERE expiry_date < now() + 30 days AND blocks_deployment` count |
| Days to Payroll | Days until 25th of current month |

**Middle Section:**
- Left 2/3: Department headcount breakdown (bar chart)
- Right 1/3: Alerts — cert expiring (red), insurance pending >25 days (amber), exit checklists incomplete

**Bottom:** Recent leave requests table (pending first, then recent approved/rejected)

### 10.2 HR-Specific Views (EXISTING — enhance)

| View | Status | Enhancement |
|------|--------|-------------|
| Employee List | Built (Step 15) | Add department filter, cert status column, active/inactive toggle |
| Employee Detail | Built (Step 15) | Add training progress, onboarding status |
| Payroll Export | Built (Step 15) | Add monthly input form for variables before CSV generation |
| Leave Management | Partially built | Add approval workflow, balance tracking, ledger view |
| Certifications | Display exists | Add creation form, renewal reminders, deployment block warnings |
| Training | Not built | Microlearning question delivery status, assessment results, onboarding track progress |

### 10.3 Nav Items for `hr_manager`

Dashboard, Employees, Leave, Payroll, Training, Certifications

---

## 11. Updated Nav Configuration — Full Workspace Per Role

The sidebar uses **section headings** to group related pages. Each role sees a curated workspace. The `founder` sees ALL sections (every nav item across all roles).

### Founder (sees everything — all sections below)

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **Sales** | Leads, Proposals, Marketing, Liaison |
| **Design** | Design Queue |
| **Projects** | Projects, Tasks |
| **Procurement** | Purchase Orders, Vendors, Price Book |
| **O&M** | O&M Visits, Service Tickets |
| **Finance** | Cash Flow, Invoices, Payments, Profitability |
| **HR** | Employees, Leave, Payroll, Training, Certifications |

### Project Manager + O&M Technician

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **Projects** | All Projects, My Projects, Tasks |
| **Execution** | Daily Reports, QC Gates |
| **Procurement** | Purchase Orders (read for PM, hidden for O&M) |
| **O&M** | Visits, Service Tickets, AMC Contracts |
| **Liaison** | Net Metering, CEIG Tracking |

### Site Supervisor

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **My Work** | My Reports, My Tasks |
| **Projects** | Active Project, All Projects (read-only, for old client lookups) |

### Sales Engineer

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **Sales** | Leads, My Follow-ups, Proposals |
| **Marketing** | Campaigns, Channel Partners, Drip Sequences |
| **Liaison** | Net Metering Status |

### Designer

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **Design** | Design Queue, In Progress, Completed |
| **Reference** | Leads (read-only detail), Price Book, Correction Factors |

### Purchase Officer

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **Procurement** | Purchase Orders, RFQ Tracker, Deliveries, GRN |
| **Vendor Management** | Vendors, Price Book (master maintainer), Vendor Performance |

### Finance

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **Cash** | Cash Flow, Project Positions |
| **Billing** | Invoices, Credit Notes, Customer Payments |
| **Vendor** | Vendor Payments, MSME Compliance |
| **Analysis** | Profitability, Cost Variances |

### HR Manager

| Section | Items |
|---------|-------|
| **Overview** | Dashboard |
| **People** | Employees, Onboarding |
| **Leave & Attendance** | Leave Requests, Leave Balances, Attendance |
| **Payroll** | Monthly Inputs, Export, Salary History |
| **Development** | Training, Certifications, Skills |

### Implementation

```typescript
export interface NavSection {
  label: string;
  items: NavItem[];
}

export function navSectionsForRole(role: AppRole): NavSection[] {
  // Returns grouped sections for sidebar rendering
  // Founder gets ALL sections from ALL roles
}
```

---

## 12. Database Migration Required

### 12.1 New app_role values

```sql
-- Migration 009a: Add designer and purchase_officer roles
ALTER TYPE app_role ADD VALUE 'designer';
ALTER TYPE app_role ADD VALUE 'purchase_officer';
```

### 12.2 New RLS policies for new roles

Designer policies: read access to leads (qualified+), proposals (own), lead_documents, lead_site_surveys, price_book, bom_correction_factors. Write access to proposals (own draft), lead_documents (design files).

Purchase Officer policies: read access to purchase_orders, vendors, price_book, rfq_requests, rfq_responses, vendor_delivery_challans, goods_receipt_notes. Write access to purchase_orders, rfq_requests, vendor_delivery_challans, goods_receipt_notes.

### 12.3 Fix RLS policies for new roles

All existing policies using `get_my_role()` checks need to include new roles where appropriate. Specifically:
- `proposals_read` → add `designer`
- `leads_read` → add `designer`
- `po_read` → add `purchase_officer`
- `vendor_dc_read` → add `purchase_officer`
- `grn_read` → add `purchase_officer`
- `price_book_read` → add `designer`, `purchase_officer`

---

## 13. Build Order

| Phase | Step | Dashboard/Feature | Depends On |
|-------|------|-------------------|------------|
| 2A | 19 | DB migration: new roles + RLS | — |
| 2A | 20 | Role-adaptive dashboard router | Step 19 |
| 2A | 21 | PM Dashboard + 10-Step Project Detail | Step 20 |
| 2A | 22 | Designer Dashboard + Design Queue + Workspace | Step 20 |
| 2A | 23 | Purchase Officer Dashboard + Workflow | Step 20 |
| 2A | 24 | Site Supervisor Dashboard + Report Form | Step 20 |
| 2A | 25 | Sales Dashboard + Marketing + Liaison tabs | Step 20 |
| 2A | 26 | Finance Dashboard + Invoice/Payment views | Step 20 |
| 2A | 27 | HR Dashboard + Training + Certifications | Step 20 |
| 2A | 28 | Founder Dashboard enhancements (charts) | Step 20 |
| 2A | 29 | Cross-role testing + nav verification | Steps 21-28 |

---

## 14. Key Design Rules

1. **Role-adaptive `/dashboard`** — one route, content switches by role
2. **PM uses 10-step stepper** — not tabs, clickable, Framer Motion transitions
3. **Inline edit per card section** — toggle view/edit per section, not per field
4. **Completion % is NEVER an input** — always computed from milestone sub-components
5. **48h lock applies everywhere** — daily reports, O&M reports, QC inspections
6. **CEIG gate blocks TNEB** — visual enforcement in Liaison step
7. **IR < 0.5 MΩ → auto-ticket** — shown prominently in commissioning step
8. **Financial data visibility** — Designer sees margins (needed for quote approval). Supervisor and O&M tech see ZERO financial data. PM sees budget vs actual but not margins.
9. **Empty states** — every section has a descriptive empty state per Design System spec
10. **Dense tables** for lists, **card sections** for detail views
11. **All SQL changes documented in migrations** — always

---

*Spec prepared: 2026-03-30*
*For integration into: SHIROI_MASTER_REFERENCE v3.0*
*Approved by: [Pending Vivek review]*
