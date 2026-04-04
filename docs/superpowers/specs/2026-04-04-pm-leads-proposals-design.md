# PM Screens + Leads/Proposals Usability Overhaul

> Date: 2026-04-04
> Author: Claude (with Vivek)
> Scope: PM dashboard corrections, leads/proposals pagination + bulk actions, project list improvements

---

## 1. Overview

Three workstreams:

1. **Leads page overhaul** — Pagination, bulk actions (assign, status, delete, merge), new filters, sort, record count
2. **Proposals page overhaul** — Pagination, additional filters, sort, record count
3. **PM Dashboard fix** — Correct 3 wrong KPI cards, add donut chart, operations widget, dark "today" panel

---

## 2. Shared Infrastructure: Pagination Component

### New component: `packages/ui/src/components/pagination.tsx`

A reusable server-side pagination component used by leads, proposals, projects, tasks, and all list pages.

**Props:**
```typescript
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  pageSize: number;
  basePath: string; // e.g. "/leads"
  searchParams: Record<string, string>; // preserve existing filters
}
```

**Behavior:**
- Shows: "Showing 1–50 of 1,115 leads"
- Page buttons: First, Prev, [page numbers], Next, Last
- Window of 5 page numbers centered on current page
- Uses URL search params (`?page=2&status=new`) — fully server-side, no client state
- Styled per design system: `--n150` top border, Inter 13px

### New component: `packages/ui/src/components/checkbox.tsx`

A Radix-based checkbox for table row selection.

**Props:**
```typescript
interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}
```

Uses `@radix-ui/react-checkbox` (new dependency).

---

## 3. Leads Page Overhaul

### 3.1 Pagination

- Default page size: **50**
- Server-side pagination via Supabase `.range(from, to)`
- URL params: `?page=1&status=new&source=referral&search=kumar`
- Query function signature changes:
  ```typescript
  interface LeadFilters {
    status?: LeadStatus;
    source?: LeadSource;
    search?: string;
    assignedTo?: string;
    segment?: CustomerSegment;
    includeConverted?: boolean;
    page?: number;
    pageSize?: number;
  }

  interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }
  ```
- `getLeads()` returns `PaginatedResult<Lead>` instead of `Lead[]`
- Uses Supabase `{ count: 'exact' }` option to get total without fetching all rows

### 3.2 New Filters

Add to existing filter bar:
- **Segment** dropdown: All / Residential / Commercial / Industrial
- **Assigned To** dropdown: All / [list of active employees]
- Fetch employees list with `getSalesEngineers()` (already exists)

### 3.3 Bulk Selection

The leads table becomes a **client component** (or a client component wrapper around the server-fetched data) to support:

- **Header checkbox** — select all on current page / deselect all
- **Row checkboxes** — individual row selection
- **Selection counter** — "3 selected" badge in toolbar
- **Bulk action bar** — slides in when 1+ rows selected

Architecture: The page remains a server component. A new `LeadsTable` client component receives the data as props and manages selection state.

### 3.4 Bulk Actions

When 1+ rows selected, a toolbar appears above the table:

```
┌─────────────────────────────────────────────────────────┐
│ 3 selected  │ Assign To ▼ │ Change Status ▼ │ Delete │ Merge │ Cancel │
└─────────────────────────────────────────────────────────┘
```

**Assign To:** Opens dropdown with employee list. Server action updates `assigned_to` for all selected leads.

**Change Status:** Opens dropdown with valid statuses. Server action updates `status` for all selected leads. Note: this bypasses the per-lead transition validation (intentional for bulk cleanup).

**Delete:** Soft-delete (`deleted_at = now()`). Confirmation dialog: "Delete 3 leads? This can be undone."

**Merge:** Enabled only when exactly 2 leads are selected. Opens a modal:
- Shows side-by-side comparison of both leads
- User picks the "primary" lead (the one to keep)
- Secondary lead's activities are transferred to primary
- Secondary lead is soft-deleted with `merged_into = primary.id`
- Server action:
  1. Transfer `lead_activities` from secondary → primary
  2. Transfer any `proposals` from secondary → primary (update `lead_id`)
  3. Update secondary: `deleted_at = now()`, add note "Merged into {primary.customer_name}"
  4. Optionally merge fields (e.g., if primary has no email but secondary does)

### 3.5 Column Sort

Sortable columns: Customer Name, City, Status, Created. Click column header to toggle asc/desc. URL param: `?sort=customer_name&dir=asc`.

### 3.6 Record Count

Show above table: "Showing 1–50 of 1,115 leads" (or "12 leads" if filtered).

### 3.7 Additional Columns

Add optional columns (hidden by default, togglable):
- **Estimated Size (kWp)** — from `estimated_size_kwp`
- **Next Follow-up** — from `next_followup_date`, highlight overdue in red

---

## 4. Proposals Page Overhaul

### 4.1 Pagination

Same pattern as leads: 50/page, server-side, URL params.

### 4.2 New Filters

- **Type** dropdown: All / Budgetary / Detailed (`is_budgetary` field)
- **System Type** dropdown: All / On Grid / Off Grid / Hybrid
- **Date Range**: Created after / Created before (date inputs)

### 4.3 Column Sort

Sortable columns: Size (kWp), Total, Margin %, Created, Valid Until.

### 4.4 Record Count

Same pattern as leads: "Showing 1–50 of 314 proposals".

---

## 5. PM Dashboard Corrections

### 5.1 KPI Cards — Fix to Match Spec

| Position | Current (Wrong) | Spec (Correct) | Data Source |
|----------|-----------------|-----------------|-------------|
| Card 1 | Active Projects | **Total System Size** (kWp) + trend | `SUM(system_size_kwp)` from PM's projects. Trend: compare to last month. |
| Card 2 | Total System Size | **Total Clients** (unique count) | `COUNT(DISTINCT customer_name)` from PM's projects. Trend: new this month. |
| Card 3 | Open Tasks | **Total Sales** (₹ in Lakhs) | `SUM(contracted_value)` from PM's projects. Format: shortINR. |
| Card 4 | Service Tickets | **Avg. Profit %** | `AVG((contracted_value - actual_cost) / contracted_value * 100)`. Uses `project_cash_positions` for actual cost. |

### 5.2 Donut Chart — Project Status Distribution

**New dependency:** `recharts` (lightweight, React-native, widely used)

- Shows project count by status as a donut/pie chart
- Uses brand color sequence from design system
- Legend below chart with status name + count
- Occupies left 2/3 of middle section

### 5.3 Operations Widget

Right 1/3, top card:
- **Open Tasks:** Progress bar showing `open / total` tasks for PM
- **Open Services:** Progress bar showing `open / total` service tickets
- **AMCs This Month:** Progress bar showing `completed / scheduled` visits this month

Each with: label, ratio text (e.g., "12 / 45"), thin progress bar.

### 5.4 Today's Priority Panel

Right 1/3, bottom card with dark background (`#001F0D`):
- Title: "Today's Priority" in white
- Top 3 projects needing attention (overdue reports, SLA breaches, cash-negative)
- Each shows: project name, location, status badge
- Clickable → navigates to project detail

### 5.5 Query Changes

Update `getPMDashboardData()` to return:
```typescript
interface PMDashboardData {
  // KPIs
  totalSystemSizeKwp: number;
  totalSystemSizeTrend: number; // % change from last month
  totalClients: number;
  newClientsThisMonth: number;
  totalSales: number; // sum of contracted_value
  salesGrowthPct: number;
  avgProfitPct: number;
  avgProfitPerProject: number;

  // Chart
  projectsByStatus: Array<{ status: string; count: number }>;

  // Operations
  openTaskCount: number;
  totalTaskCount: number;
  openServiceTicketCount: number;
  totalServiceTicketCount: number;
  amcCompletedThisMonth: number;
  amcScheduledThisMonth: number;

  // Today's priorities
  priorityProjects: Array<{
    id: string;
    project_number: string;
    customer_name: string;
    location: string;
    status: string;
    reason: string; // "Missing report", "SLA breach", "Cash negative"
  }>;

  employeeId: string | null;
}
```

---

## 6. Project List Improvements (Medium Priority)

Add pagination (50/page), location column, system size filter dropdown (`< 10 kWp / 10–50 kWp / > 50 kWp`), start/end date columns. Same pagination component as leads.

---

## 7. Task List Improvements (Medium Priority)

Add pagination (50/page). Add/edit task via modal dialog (using existing `Dialog` component). Expandable rows for daily logs is deferred — requires significant table refactoring.

---

## 8. Server Actions for Bulk Operations

New file: `apps/erp/src/lib/leads-actions.ts`

```typescript
'use server'

export async function bulkAssignLeads(leadIds: string[], assignedTo: string): Promise<void>
export async function bulkChangeLeadStatus(leadIds: string[], status: LeadStatus): Promise<void>
export async function bulkDeleteLeads(leadIds: string[]): Promise<void>
export async function mergeLeads(primaryId: string, secondaryId: string): Promise<void>
```

All actions:
- Validate inputs (non-empty arrays, valid UUIDs)
- Use Supabase server client (RLS enforced)
- Log operations with `[bulkAssignLeads]` op prefix
- Return void on success, throw on error
- `revalidatePath('/leads')` after mutation

---

## 9. New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `recharts` | Donut chart on PM dashboard | ~150KB gzipped |
| `@radix-ui/react-checkbox` | Checkbox for bulk selection | ~5KB |

---

## 10. Files to Create/Modify

### New Files:
- `packages/ui/src/components/pagination.tsx` — Reusable pagination
- `packages/ui/src/components/checkbox.tsx` — Checkbox component
- `apps/erp/src/components/leads/leads-table.tsx` — Client component with selection
- `apps/erp/src/components/leads/bulk-action-bar.tsx` — Bulk action toolbar
- `apps/erp/src/components/leads/merge-modal.tsx` — Side-by-side merge dialog
- `apps/erp/src/lib/leads-actions.ts` — Server actions for bulk ops
- `apps/erp/src/components/dashboard/donut-chart.tsx` — Recharts donut
- `apps/erp/src/components/dashboard/operations-widget.tsx` — Progress bars
- `apps/erp/src/components/dashboard/today-priorities.tsx` — Dark panel

### Modified Files:
- `apps/erp/src/app/(erp)/leads/page.tsx` — Add pagination, pass data to client table
- `apps/erp/src/lib/leads-queries.ts` — Add pagination support, return total count
- `apps/erp/src/app/(erp)/proposals/page.tsx` — Add pagination, new filters
- `apps/erp/src/lib/proposals-queries.ts` — Add pagination support
- `apps/erp/src/app/(dashboard)/dashboard/pm-dashboard.tsx` — New KPIs, chart, widgets
- `apps/erp/src/lib/pm-queries.ts` — Expanded data fetching
- `packages/ui/src/index.ts` — Export new components

---

## 11. Build Order

### Phase 1: Shared Infrastructure
1. Pagination component
2. Checkbox component
3. Install `@radix-ui/react-checkbox`

### Phase 2: Leads Page
4. Update `leads-queries.ts` with pagination
5. Create `leads-actions.ts` server actions
6. Build `LeadsTable` client component with selection
7. Build `BulkActionBar` component
8. Build `MergeModal` component
9. Update leads `page.tsx` — wire pagination, filters, bulk actions
10. Add segment + assigned-to filters

### Phase 3: Proposals Page
11. Update `proposals-queries.ts` with pagination
12. Update proposals `page.tsx` — wire pagination, new filters

### Phase 4: PM Dashboard
13. Install `recharts`
14. Update `pm-queries.ts` — expanded metrics
15. Build `DonutChart`, `OperationsWidget`, `TodayPriorities` components
16. Update `pm-dashboard.tsx` — correct KPIs, new layout

### Phase 5: Project/Task List (if time allows)
17. Add pagination to projects list
18. Add pagination to tasks list
19. Add location, dates columns to projects

---

*This spec covers the complete PM workflow screens analysis and leads/proposals usability overhaul. Implementation follows the build order above.*
