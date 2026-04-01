# Phase 2A: Role-Specific Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 8 role-adaptive dashboards, 2 new DB roles, sectioned sidebar navigation, founder role switcher, universal My Tasks widget, and PM 10-step project stepper.

**Architecture:** Single `/dashboard` route renders role-specific content via switch on `profile.role`. Sidebar restructured from flat list to grouped sections per role. Founder gets `?view_as=` URL param to preview any role's dashboard. All queries in dedicated `*-queries.ts` files, all dashboards are async Server Components.

**Tech Stack:** Next.js 14 App Router, Supabase (RLS), TypeScript, Tailwind CSS, @repo/ui components, Vitest, decimal.js for money.

**Spec:** `docs/superpowers/specs/2026-03-30-role-dashboards-design.md`

---

## Task 1: SQL Migration — New Roles + RLS (Step 19)

**Files:**
- Create: `supabase/migrations/009_new_roles.sql`

- [ ] **Step 1: Write migration SQL**

Add `designer` and `purchase_officer` to `app_role` enum. Update key RLS policies to include new roles. Use `get_my_role()` helper (from migration 008a) — never raw subqueries.

- [ ] **Step 2: Verify migration is syntactically correct**

Read it through, ensure no references to non-existent tables or functions.

---

## Task 2: Update TypeScript Role Config + Nav Sections (Step 20a)

**Files:**
- Modify: `apps/erp/src/lib/roles.ts`
- Modify: `apps/erp/src/lib/roles.test.ts`
- Modify: `apps/erp/src/components/sidebar.tsx`

- [ ] **Step 1: Update roles.ts**

Add `designer` and `purchase_officer` to `ROLE_LABELS`. Replace flat `NAV_ITEMS` with sectioned `NAV_SECTIONS` structure using `NavSection { label: string; items: NavItem[] }`. Export `navSectionsForRole(role)` that returns grouped sections. Founder gets ALL sections. Each role gets curated sections per spec Section 11.

New nav items needed: `/tasks`, `/marketing`, `/liaison`, `/design`, `/vendors`, `/price-book`, `/invoices`, `/payments`, `/profitability`, `/leave`, `/training`, `/certifications`. Many will point to placeholder pages initially.

- [ ] **Step 2: Update sidebar.tsx**

Render sections with uppercase section labels (DM Sans 9px/700, `rgba(255,255,255,.25)`) and grouped items under each. Keep existing active/hover styles.

- [ ] **Step 3: Update roles.test.ts**

Add tests for new roles: designer sees Design + Reference sections, purchase_officer sees Procurement + Vendor Management, founder sees all sections, customer has none.

- [ ] **Step 4: Run tests**

Run: `npx turbo run test`
Expected: All tests pass including new role tests.

---

## Task 3: Dashboard Router + Founder Role Switcher (Step 20b)

**Files:**
- Modify: `apps/erp/src/app/(erp)/dashboard/page.tsx`
- Create: `apps/erp/src/components/role-switcher.tsx`
- Modify: `apps/erp/src/components/topbar.tsx`
- Create: `apps/erp/src/app/(erp)/dashboard/founder-dashboard.tsx` (extract existing)
- Create: `apps/erp/src/app/(erp)/dashboard/pm-dashboard.tsx` (placeholder)
- Create: `apps/erp/src/app/(erp)/dashboard/sales-dashboard.tsx` (placeholder)
- Create: `apps/erp/src/app/(erp)/dashboard/designer-dashboard.tsx` (placeholder)
- Create: `apps/erp/src/app/(erp)/dashboard/purchase-dashboard.tsx` (placeholder)
- Create: `apps/erp/src/app/(erp)/dashboard/supervisor-dashboard.tsx` (placeholder)
- Create: `apps/erp/src/app/(erp)/dashboard/finance-dashboard.tsx` (placeholder)
- Create: `apps/erp/src/app/(erp)/dashboard/hr-dashboard.tsx` (placeholder)

- [ ] **Step 1: Extract founder dashboard**

Move current dashboard content to `founder-dashboard.tsx` as `<FounderDashboard />` component. Keep all existing imports and data fetching.

- [ ] **Step 2: Create placeholder dashboards**

Each placeholder shows the role name heading + "Dashboard coming soon" with proper empty state styling per V2 design system.

- [ ] **Step 3: Update dashboard/page.tsx as router**

Read `profile.role` and `searchParams.view_as`. If founder and `view_as` is set, render that role's dashboard. Otherwise render based on actual role. Switch statement per spec Section 2.1.

- [ ] **Step 4: Create role-switcher.tsx**

Dropdown in topbar (founder only). Shows current view with "Viewing as: {role}" banner. "Back to Founder" button. Uses `router.push(/dashboard?view_as=...)`.

- [ ] **Step 5: Update topbar.tsx**

Add RoleSwitcher component (only for founder). Show "Viewing as" banner when `view_as` is active.

---

## Task 4: Shared Components — KPI Card + My Tasks Widget

**Files:**
- Create: `apps/erp/src/components/kpi-card.tsx`
- Create: `apps/erp/src/components/my-tasks.tsx`
- Create: `apps/erp/src/lib/tasks-queries.ts`
- Create: `apps/erp/src/lib/tasks-queries.test.ts`

- [ ] **Step 1: Create KPI card component**

Reusable card matching V2 spec Component 04: label (11px/600 uppercase --n500), value (28px DM Sans 700 --n950), optional unit, optional trend arrow (green up / red down), optional sub-note. Props: `label, value, unit?, trend?, trendLabel?, subNote?, icon?`. Uses Lucide icon.

- [ ] **Step 2: Create tasks queries**

`getMyTasks(employeeId)` — queries `tasks` table for `assigned_to = employeeId`, `status IN ('open', 'in_progress')`, ordered by overdue first then due_date ascending. Returns task with entity_type and entity_id for linking.

- [ ] **Step 3: Write tasks query tests**

Test the pure helper `isTaskOverdue(dueDate)` and `formatTaskEntity(entityType, entityId)`.

- [ ] **Step 4: Create My Tasks widget**

Server component. Shows table: Task description, Entity (project/lead/ticket), Due date (red if overdue), Priority badge, Status badge. Empty state: "No open tasks assigned to you."

- [ ] **Step 5: Run tests**

---

## Task 5: PM Dashboard (Step 21a)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/pm-dashboard.tsx`
- Create: `apps/erp/src/lib/pm-queries.ts`

- [ ] **Step 1: Create PM queries**

`getPMDashboardData(employeeId)` — parallel fetch:
- Active projects count (assigned to this PM, status not completed/cancelled)
- Total system size (SUM kWp)
- Open tasks count
- Open service tickets count
- Projects by status (for donut data)
- Overdue alerts (no report today, uninvoiced milestones)

- [ ] **Step 2: Build PM dashboard**

4 KPI cards (Active Projects, System Size, Open Tasks, Service Tickets) using KpiCard component. My Tasks widget. Projects by status summary. Overdue alerts table.

---

## Task 6: PM 10-Step Project Stepper (Step 21b)

**Files:**
- Create: `apps/erp/src/components/projects/project-stepper.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-details.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-survey.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-bom.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-delivery.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-qc.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-commissioning.tsx`
- Create: `apps/erp/src/components/projects/stepper-steps/step-amc.tsx`
- Create: `apps/erp/src/lib/project-stepper-queries.ts`
- Create: `apps/erp/src/app/(erp)/projects/[id]/stepper/page.tsx`

- [ ] **Step 1: Create stepper component**

Horizontal connected-circle stepper. 10 steps with labels. States: completed (green fill + check), active (green ring), upcoming (gray). Uses URL search param `?step=1` to track active step. Client component for step navigation.

- [ ] **Step 2: Create step content components**

Each step is a server-renderable component that takes `projectId` and fetches its own data. Steps show real data from existing tables where available, empty states where not.

Step 1 (Details): Client info, tech specs, financial overview from `projects` + `project_cash_positions`.
Step 2 (Survey): Read-only `lead_site_surveys` data.
Step 3 (BOM): `proposal_bom_lines` table display.
Step 4 (BOQ): Planned vs actual cost comparison from `project_cost_variances`.
Step 5 (Delivery): `vendor_delivery_challans` list.
Step 6 (Execution): `tasks` + `project_milestones` + `daily_site_reports` summary.
Step 7 (QC): `qc_gate_inspections` checklist display.
Step 8 (Liaison): `net_metering_applications` milestones.
Step 9 (Commissioning): `commissioning_reports` data.
Step 10 (AMC): `om_visit_schedules` + `om_visit_reports`.

- [ ] **Step 3: Create stepper queries**

One query file with functions for each step's data needs. Each function follows the established pattern: named op, error logging, typed return.

- [ ] **Step 4: Create stepper page**

Route `/projects/[id]/stepper` — loads project, determines which steps are complete based on data presence, renders stepper + active step content.

---

## Task 7: Designer Dashboard (Step 22)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/designer-dashboard.tsx`
- Create: `apps/erp/src/lib/designer-queries.ts`
- Create: `apps/erp/src/app/(erp)/design/page.tsx` (design queue)
- Create: `apps/erp/src/app/(erp)/design/[leadId]/page.tsx` (design workspace)

- [ ] **Step 1: Create designer queries**

`getDesignerDashboardData()` — pending designs (leads with site_survey_done, no proposal), in-progress count, completed this month, design queue list.

- [ ] **Step 2: Build designer dashboard**

4 KPI cards. Design queue table (customer, location, system size, survey date, days waiting). My Tasks widget.

- [ ] **Step 3: Create design queue page**

Full table view of leads awaiting design with filters.

- [ ] **Step 4: Create design workspace page**

Two-panel layout. Left: lead context (customer info, survey data). Right: design actions (system config display, file upload placeholder, simulation placeholder). This is a read-heavy view for now — full edit capabilities come in Phase 2B.

---

## Task 8: Purchase Officer Dashboard (Step 23)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/purchase-dashboard.tsx`
- Create: `apps/erp/src/lib/purchase-queries.ts`
- Create: `apps/erp/src/app/(erp)/vendors/page.tsx`
- Create: `apps/erp/src/app/(erp)/price-book/page.tsx`

- [ ] **Step 1: Create purchase queries**

`getPurchaseDashboardData()` — pending POs, active POs, pending deliveries, MSME alerts (vendors at Day 40+). Reuse existing `procurement-queries.ts` where possible.

- [ ] **Step 2: Build purchase dashboard**

4 KPI cards. MSME alert banner (red/amber). PO pipeline table. My Tasks widget.

- [ ] **Step 3: Create vendors page**

List of vendors from `vendors` table. Name, contact, MSME status, GSTIN. Filter by MSME status.

- [ ] **Step 4: Create price book page**

Read-only view of `price_book` table. Item, category, vendor, unit rate, GST%, last updated. Filter by category. Staleness flag indicator.

---

## Task 9: Site Supervisor Dashboard (Step 24)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/supervisor-dashboard.tsx`
- Create: `apps/erp/src/lib/supervisor-queries.ts`

- [ ] **Step 1: Create supervisor queries**

`getSupervisorDashboardData(employeeId)` — active project (assigned), today's report status, recent 5 reports with lock status, open tasks.

- [ ] **Step 2: Build supervisor dashboard**

Active project card (name, location, milestone, days since start). Today's report status (submitted or "Submit Report" button). My Tasks (overdue first). Recent reports with lock icon.

---

## Task 10: Sales Dashboard (Step 25)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/sales-dashboard.tsx`
- Create: `apps/erp/src/lib/sales-queries.ts`
- Create: `apps/erp/src/app/(erp)/marketing/page.tsx`
- Create: `apps/erp/src/app/(erp)/liaison/page.tsx`

- [ ] **Step 1: Create sales queries**

`getSalesDashboardData()` — new leads this month, pipeline value (reuse), won this month, conversion rate, follow-ups today, lead funnel counts by status.

- [ ] **Step 2: Build sales dashboard**

4 KPI cards. Lead funnel summary (counts per status stage). Follow-ups today list. My Tasks widget.

- [ ] **Step 3: Create marketing page**

Placeholder with proper empty state: "Marketing campaigns, channel partners, and drip sequences will appear here."

- [ ] **Step 4: Create liaison page**

Placeholder with proper empty state: "Net metering application tracking will appear here."

---

## Task 11: Finance Dashboard (Step 26)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/finance-dashboard.tsx`
- Create: `apps/erp/src/lib/finance-queries.ts`
- Create: `apps/erp/src/app/(erp)/invoices/page.tsx`
- Create: `apps/erp/src/app/(erp)/payments/page.tsx`
- Create: `apps/erp/src/app/(erp)/profitability/page.tsx`

- [ ] **Step 1: Create finance queries**

`getFinanceDashboardData()` — total invested capital, total receivables, MSME due this week, overdue invoices count. Reuse `cash-queries.ts` heavily.

- [ ] **Step 2: Build finance dashboard**

4 KPI cards. Cash-negative projects table (reuse CashAlertTable). Invoice escalation summary. My Tasks widget.

- [ ] **Step 3: Create placeholder pages**

Invoices, Payments, Profitability — each with proper empty state per V2 design system.

---

## Task 12: HR Dashboard (Step 27)

**Files:**
- Replace: `apps/erp/src/app/(erp)/dashboard/hr-dashboard.tsx`
- Create: `apps/erp/src/lib/hr-dashboard-queries.ts`
- Create: `apps/erp/src/app/(erp)/leave/page.tsx`
- Create: `apps/erp/src/app/(erp)/training/page.tsx`
- Create: `apps/erp/src/app/(erp)/certifications/page.tsx`

- [ ] **Step 1: Create HR dashboard queries**

`getHRDashboardData()` — active employee count, pending leave requests, expiring certifications (30 days), days to payroll. Reuse existing `hr-queries.ts`.

- [ ] **Step 2: Build HR dashboard**

4 KPI cards. Alerts section (cert expiry, insurance pending). Recent leave requests table. My Tasks widget.

- [ ] **Step 3: Create placeholder pages**

Leave management, Training, Certifications — each with proper empty states.

---

## Task 13: Founder Dashboard Enhancements (Step 28)

**Files:**
- Modify: `apps/erp/src/app/(erp)/dashboard/founder-dashboard.tsx`
- Modify: `apps/erp/src/lib/dashboard-queries.ts`

- [ ] **Step 1: Add KPI cards to founder dashboard**

Replace plain text heading with 4 KPI cards using KpiCard component: Cash Invested, Pipeline Value, Active Projects, Overdue Reports.

- [ ] **Step 2: Add project status summary**

Projects grouped by status with counts — simple table or summary cards. Revenue trend placeholder (chart library deferred).

---

## Task 14: Placeholder Pages for New Nav Items

**Files:**
- Create: `apps/erp/src/app/(erp)/tasks/page.tsx`
- Create: `apps/erp/src/app/(erp)/reports/page.tsx` (supervisor reports list)

- [ ] **Step 1: Create tasks page**

Cross-project tasks view. Query `tasks` table for current user. Table: task, entity, due date, priority, status. Filter by status and entity_type.

- [ ] **Step 2: Create any remaining placeholder pages**

Any nav items that don't have pages yet get proper placeholder pages with empty states.

---

## Task 15: Cross-Role Testing + Final Verification (Step 29)

**Files:**
- Modify: `apps/erp/src/lib/roles.test.ts` (comprehensive)
- Create: `apps/erp/src/lib/tasks-queries.test.ts` (if not done in Task 4)

- [ ] **Step 1: Comprehensive role nav tests**

Test every role gets correct sections and items. Test founder sees all items. Test customer sees nothing. Test new roles (designer, purchase_officer) get correct workspace.

- [ ] **Step 2: Type check entire project**

Run: `npx tsc --noEmit --project apps/erp/tsconfig.json`
Expected: 0 errors.

- [ ] **Step 3: Run all tests**

Run: `npx turbo run test`
Expected: All tests pass.

- [ ] **Step 4: Verify no hardcoded values**

Grep for any remaining V1 colors, hardcoded Supabase URLs, or `any` types.

---

## Implementation Notes

1. **No chart library in this phase** — KPI cards and tables only. Charts deferred to when a chart library is chosen.
2. **Placeholder pages** are NOT empty files — they have proper layout, heading, and V2 empty state with descriptive text and icon.
3. **All queries** follow the established pattern: `const op = '[fnName]'`, try/catch, console.error with code/message.
4. **All money** uses `decimal.js` — never native floats.
5. **Financial visibility rules**: Designer sees margins. Supervisor/O&M see ZERO financial data. PM sees budget vs actual.
6. **The stepper** uses URL search params (`?step=N`) not client state, so it's bookmarkable and shareable.
