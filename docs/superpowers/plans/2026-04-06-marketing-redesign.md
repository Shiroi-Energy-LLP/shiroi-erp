# Marketing Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire marketing/leads/proposals flow to be task-centric and stage-navigable, mirroring the project module's tab-based UX pattern.

**Architecture:** Replace the current flat DataTable leads list with a stage-based navigation layout (like projects). Leads become call tasks. The lead detail page gets tab-based navigation (like project detail) with tabs for Details, Activities, Proposal, Files, and Payments. Add `expected_close_date` and `close_probability` columns for weighted pipeline. Enforce mandatory follow-up on every status change (unless Lost/Disqualified). Add a quick-add task flow and a payments follow-up tab post-conversion.

**Tech Stack:** Next.js 14 App Router, Supabase PostgreSQL, Server Actions, existing DataTable + column-config infrastructure, existing `tasks` table (entity_type=`lead`), existing `lead_activities` table.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/020_marketing_redesign.sql` | DB: add `expected_close_date`, `close_probability` to leads; add `is_archived` flag |
| `apps/erp/src/app/(erp)/leads/[id]/layout.tsx` | Lead detail layout with header + tab navigation (mirrors project layout) |
| `apps/erp/src/app/(erp)/leads/[id]/page.tsx` | **Rewrite** Details tab content (was full detail page) |
| `apps/erp/src/app/(erp)/leads/[id]/activities/page.tsx` | Activities tab: activity feed + add-activity form |
| `apps/erp/src/app/(erp)/leads/[id]/proposal/page.tsx` | Proposal tab: linked proposal summary + files |
| `apps/erp/src/app/(erp)/leads/[id]/files/page.tsx` | Files tab: all files for this lead/proposal |
| `apps/erp/src/app/(erp)/leads/[id]/tasks/page.tsx` | Tasks tab: tasks linked to this lead |
| `apps/erp/src/app/(erp)/leads/[id]/payments/page.tsx` | Payments tab: visible after conversion, payment milestones + collection status |
| `apps/erp/src/components/leads/lead-tabs.tsx` | Tab navigation component (mirrors `ProjectTabs`) |
| `apps/erp/src/components/leads/lead-stage-nav.tsx` | Horizontal stage pills/bar on leads list page |
| `apps/erp/src/components/leads/quick-add-task.tsx` | Quick task creation dialog (assign to self/others) |
| `apps/erp/src/components/leads/call-outcome-form.tsx` | Streamlined call log form with mandatory next follow-up |
| `apps/erp/src/components/leads/pipeline-summary.tsx` | Weighted pipeline summary cards |
| `apps/erp/src/lib/leads-pipeline-queries.ts` | Pipeline stats queries (grouped by stage, weighted totals) |
| `apps/erp/src/lib/leads-task-actions.ts` | Server actions for quick task creation on leads |

### Modified files

| File | Change |
|------|--------|
| `apps/erp/src/app/(erp)/leads/page.tsx` | Add stage nav bar, pipeline summary, archived toggle |
| `apps/erp/src/components/data-table/column-config.ts` | Add `expected_close_date`, `close_probability`, `weighted_value` columns to `LEAD_COLUMNS` |
| `apps/erp/src/lib/leads-queries.ts` | Add `isArchived` filter, stage counts query, include new fields in select |
| `apps/erp/src/lib/leads-actions.ts` | Add `archiveLead`, `unarchiveLead`, `quickCreateTask` actions |
| `apps/erp/src/lib/leads-helpers.ts` | Add follow-up enforcement logic |
| `apps/erp/src/components/leads/status-change.tsx` | Enforce mandatory `next_followup_date` on status change (except Lost/Disqualified) |
| `apps/erp/src/components/leads/add-activity-form.tsx` | Add mandatory next follow-up field, streamline for call logging |
| `apps/erp/src/components/leads/leads-table-wrapper.tsx` | Pass stage filter from URL |
| `apps/erp/src/lib/roles.ts` | Update sales_engineer sidebar to include Tasks link |

### Deleted files

| File | Reason |
|------|--------|
| `apps/erp/src/app/(erp)/marketing/page.tsx` | Replaced by leads stage-based flow |
| `apps/erp/src/app/(erp)/marketing/campaigns/page.tsx` | Campaigns merged into leads list as a filter/view |

---

## Implementation Tasks

### Task 1: Database Migration - Add Pipeline Fields

**Files:**
- Create: `supabase/migrations/020_marketing_redesign.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 020: Marketing redesign — pipeline fields + archived flag
-- Adds expected_close_date, close_probability, is_archived to leads table.

-- Add expected close date (when do we expect to close this deal?)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS expected_close_date date;

-- Add close probability (0-100, for weighted pipeline)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS close_probability smallint DEFAULT 0
  CHECK (close_probability >= 0 AND close_probability <= 100);

-- Add archived flag (for "to check" leads that are parked)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- Add index for stage-based queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_leads_status_archived
  ON leads (status, is_archived)
  WHERE deleted_at IS NULL;

-- Add index for pipeline date-based views
CREATE INDEX IF NOT EXISTS idx_leads_expected_close
  ON leads (expected_close_date)
  WHERE deleted_at IS NULL AND status NOT IN ('won', 'lost', 'disqualified', 'converted');

-- Comment for documentation
COMMENT ON COLUMN leads.expected_close_date IS 'Expected close date for weighted pipeline forecasting';
COMMENT ON COLUMN leads.close_probability IS 'Close probability 0-100% for weighted pipeline value';
COMMENT ON COLUMN leads.is_archived IS 'Archived/parked leads — hidden from main list, visible via filter';
```

Save this to `supabase/migrations/020_marketing_redesign.sql`.

- [ ] **Step 2: Apply migration to dev via Supabase MCP**

Use `apply_migration` or `execute_sql` MCP tool to apply the SQL to the dev database.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/020_marketing_redesign.sql packages/types/database.ts
git commit -m "feat: add pipeline fields to leads (expected_close_date, close_probability, is_archived)"
```

---

### Task 2: Pipeline Queries + Stage Counts

**Files:**
- Create: `apps/erp/src/lib/leads-pipeline-queries.ts`
- Modify: `apps/erp/src/lib/leads-queries.ts`

- [ ] **Step 1: Create pipeline queries file**

Create `apps/erp/src/lib/leads-pipeline-queries.ts`:

```typescript
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import Decimal from 'decimal.js';

type LeadStatus = Database['public']['Enums']['lead_status'];

export interface StageCounts {
  status: LeadStatus;
  count: number;
  total_value: number;
  weighted_value: number;
}

/**
 * Get lead counts + weighted pipeline value grouped by status.
 * Excludes deleted and converted leads.
 */
export async function getLeadStageCounts(includeArchived = false): Promise<StageCounts[]> {
  const op = '[getLeadStageCounts]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  let query = supabase
    .from('leads')
    .select('status, estimated_size_kwp, close_probability')
    .is('deleted_at', null)
    .not('status', 'eq', 'converted');

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load stage counts: ${error.message}`);
  }

  // Group by status and compute weighted values
  const grouped = new Map<LeadStatus, { count: number; total_value: Decimal; weighted_value: Decimal }>();

  for (const lead of data ?? []) {
    const existing = grouped.get(lead.status) ?? {
      count: 0,
      total_value: new Decimal(0),
      weighted_value: new Decimal(0),
    };
    existing.count++;
    // Rough value estimate: kWp * 60000 (avg ₹60K/kWp for solar)
    const estimatedValue = new Decimal(lead.estimated_size_kwp ?? 0).mul(60000);
    existing.total_value = existing.total_value.add(estimatedValue);
    const prob = new Decimal(lead.close_probability ?? 0).div(100);
    existing.weighted_value = existing.weighted_value.add(estimatedValue.mul(prob));
    grouped.set(lead.status, existing);
  }

  return Array.from(grouped.entries()).map(([status, vals]) => ({
    status,
    count: vals.count,
    total_value: vals.total_value.toNumber(),
    weighted_value: vals.weighted_value.toNumber(),
  }));
}

/**
 * Get leads expected to close within a date range (for "closing this week" view).
 */
export async function getLeadsClosingBetween(startDate: string, endDate: string) {
  const op = '[getLeadsClosingBetween]';
  console.log(`${op} Starting: ${startDate} to ${endDate}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('leads')
    .select('id, customer_name, phone, status, expected_close_date, close_probability, estimated_size_kwp, assigned_to, employees!leads_assigned_to_fkey(full_name)')
    .is('deleted_at', null)
    .eq('is_archived', false)
    .not('status', 'in', '(won,lost,disqualified,converted)')
    .gte('expected_close_date', startDate)
    .lte('expected_close_date', endDate)
    .order('expected_close_date', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load closing leads: ${error.message}`);
  }
  return data ?? [];
}
```

- [ ] **Step 2: Update `leads-queries.ts` to support new filters**

In `apps/erp/src/lib/leads-queries.ts`, update the `LeadFilters` interface and `getLeads` function:

Add to `LeadFilters`:
```typescript
export interface LeadFilters {
  status?: LeadStatus;
  source?: Database['public']['Enums']['lead_source'];
  segment?: string;
  search?: string;
  assignedTo?: string;
  includeConverted?: boolean;
  includeArchived?: boolean;   // NEW
  archivedOnly?: boolean;      // NEW
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}
```

Add the new columns to the select string in `getLeads`:
```
'id, customer_name, phone, email, city, state, segment, source, status, estimated_size_kwp, address_line1, pincode, is_qualified, next_followup_date, expected_close_date, close_probability, is_archived, assigned_to, created_at, employees!leads_assigned_to_fkey(full_name)'
```

Add filter logic after the existing filters:
```typescript
if (filters.archivedOnly) {
  query = query.eq('is_archived', true);
} else if (!filters.includeArchived) {
  query = query.eq('is_archived', false);
}
```

Add `weighted_value` to the row mapping:
```typescript
const rows = (data ?? []).map((lead: any) => ({
  ...lead,
  assigned_to_name: lead.employees?.full_name ?? '—',
  weighted_value: (lead.estimated_size_kwp ?? 0) * 60000 * (lead.close_probability ?? 0) / 100,
}));
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/leads-pipeline-queries.ts apps/erp/src/lib/leads-queries.ts
git commit -m "feat: add pipeline queries with stage counts and weighted pipeline values"
```

---

### Task 3: Update Column Config + Lead Helpers

**Files:**
- Modify: `apps/erp/src/components/data-table/column-config.ts`
- Modify: `apps/erp/src/lib/leads-helpers.ts`

- [ ] **Step 1: Add new columns to LEAD_COLUMNS**

In `apps/erp/src/components/data-table/column-config.ts`, add these columns to `LEAD_COLUMNS` array (insert before the `next_followup_date` entry at the end):

```typescript
{ key: 'expected_close_date', label: 'Expected Close', sortKey: 'expected_close_date', defaultVisible: true, sortable: true, editable: true, fieldType: 'date', format: 'date' },
{ key: 'close_probability', label: 'Probability %', sortKey: 'close_probability', defaultVisible: true, sortable: true, editable: true, fieldType: 'number', format: 'percentage' },
{ key: 'weighted_value', label: 'Weighted Value', defaultVisible: false, sortable: false, editable: false, fieldType: 'currency', format: 'currency' },
```

Also update the `next_followup_date` column to be `defaultVisible: true` (it was `false`).

- [ ] **Step 2: Add follow-up enforcement helper**

In `apps/erp/src/lib/leads-helpers.ts`, add:

```typescript
/** Statuses that DON'T require a next follow-up date */
const TERMINAL_STATUSES: LeadStatus[] = ['won', 'lost', 'disqualified', 'converted'];

/**
 * Returns true if the given status requires a mandatory next follow-up date.
 */
export function requiresFollowUp(status: LeadStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

/** Default close probabilities by stage (can be overridden by user) */
export const DEFAULT_PROBABILITY: Partial<Record<LeadStatus, number>> = {
  new: 5,
  contacted: 10,
  site_survey_scheduled: 20,
  site_survey_done: 30,
  proposal_sent: 40,
  design_confirmed: 60,
  negotiation: 75,
  won: 100,
  lost: 0,
  on_hold: 10,
  disqualified: 0,
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/data-table/column-config.ts apps/erp/src/lib/leads-helpers.ts
git commit -m "feat: add pipeline columns and follow-up enforcement helpers"
```

---

### Task 4: Stage Navigation Bar Component

**Files:**
- Create: `apps/erp/src/components/leads/lead-stage-nav.tsx`

- [ ] **Step 1: Create stage navigation component**

Create `apps/erp/src/components/leads/lead-stage-nav.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

interface StageCount {
  status: LeadStatus;
  count: number;
}

/** The marketing-relevant stages in display order */
const STAGE_ORDER: { status: LeadStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'contacted', label: 'Contacted' },
  { status: 'site_survey_scheduled', label: 'Survey Scheduled' },
  { status: 'site_survey_done', label: 'Survey Done' },
  { status: 'proposal_sent', label: 'Proposal Sent' },
  { status: 'design_confirmed', label: 'Design Confirmed' },
  { status: 'negotiation', label: 'Negotiation' },
  { status: 'won', label: 'Won' },
  { status: 'lost', label: 'Lost' },
  { status: 'on_hold', label: 'On Hold' },
];

interface LeadStageNavProps {
  stageCounts: StageCount[];
}

export function LeadStageNav({ stageCounts }: LeadStageNavProps) {
  const searchParams = useSearchParams();
  const activeStatus = searchParams.get('status');

  const countsMap = new Map(stageCounts.map(sc => [sc.status, sc.count]));

  return (
    <div className="border-b border-n-200">
      <nav className="flex items-center gap-0 -mb-px overflow-x-auto">
        {/* All leads tab */}
        <Link
          href="/leads"
          className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            !activeStatus
              ? 'border-shiroi-green text-shiroi-green'
              : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
          }`}
        >
          All
        </Link>

        {STAGE_ORDER.map(({ status, label }) => {
          const count = countsMap.get(status) ?? 0;
          const isActive = activeStatus === status;
          return (
            <Link
              key={status}
              href={`/leads?status=${status}`}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-shiroi-green text-shiroi-green'
                  : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-shiroi-green/10 text-shiroi-green' : 'bg-n-100 text-n-500'
                }`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Archived tab */}
        <Link
          href="/leads?archived=true"
          className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            searchParams.get('archived') === 'true'
              ? 'border-shiroi-green text-shiroi-green'
              : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
          }`}
        >
          Archived
        </Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/leads/lead-stage-nav.tsx
git commit -m "feat: add stage navigation bar for leads pipeline"
```

---

### Task 5: Pipeline Summary Cards

**Files:**
- Create: `apps/erp/src/components/leads/pipeline-summary.tsx`

- [ ] **Step 1: Create pipeline summary component**

Create `apps/erp/src/components/leads/pipeline-summary.tsx`:

```typescript
import { Card, CardContent } from '@repo/ui';
import { formatINR, shortINR } from '@repo/ui/formatters';
import type { StageCounts } from '@/lib/leads-pipeline-queries';

interface PipelineSummaryProps {
  stageCounts: StageCounts[];
  closingThisWeekCount: number;
}

export function PipelineSummary({ stageCounts, closingThisWeekCount }: PipelineSummaryProps) {
  const activeLeads = stageCounts
    .filter(s => !['won', 'lost', 'disqualified'].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);

  const totalWeighted = stageCounts
    .filter(s => !['won', 'lost', 'disqualified'].includes(s.status))
    .reduce((sum, s) => sum + s.weighted_value, 0);

  const wonCount = stageCounts.find(s => s.status === 'won')?.count ?? 0;
  const wonValue = stageCounts.find(s => s.status === 'won')?.total_value ?? 0;

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Active Leads</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{activeLeads}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Weighted Pipeline</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{shortINR(totalWeighted)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Closing This Week</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{closingThisWeekCount}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Won</div>
          <div className="text-2xl font-bold text-shiroi-green mt-1">{wonCount}</div>
          <div className="text-xs text-n-500">{shortINR(wonValue)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/leads/pipeline-summary.tsx
git commit -m "feat: add pipeline summary KPI cards"
```

---

### Task 6: Redesign Leads List Page

**Files:**
- Modify: `apps/erp/src/app/(erp)/leads/page.tsx`

- [ ] **Step 1: Rewrite leads page with stage nav + pipeline summary**

Rewrite `apps/erp/src/app/(erp)/leads/page.tsx`:

```typescript
import Link from 'next/link';
import { getLeads, getSalesEngineers } from '@/lib/leads-queries';
import { getLeadStageCounts, getLeadsClosingBetween } from '@/lib/leads-pipeline-queries';
import { getMyViews } from '@/lib/views-actions';
import { LeadsTableWrapper } from '@/components/leads/leads-table-wrapper';
import { LeadStageNav } from '@/components/leads/lead-stage-nav';
import { PipelineSummary } from '@/components/leads/pipeline-summary';
import { LEAD_COLUMNS, getDefaultColumns } from '@/components/data-table/column-config';
import { Button, Card, CardContent, Input, Select, Eyebrow } from '@repo/ui';

interface LeadsPageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    segment?: string;
    search?: string;
    assignedTo?: string;
    page?: string;
    sort?: string;
    dir?: string;
    view?: string;
    archived?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const isArchived = params.archived === 'true';

  // Get the start/end of this week (Monday to Sunday) in IST
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().split('T')[0];
  const weekEnd = sunday.toISOString().split('T')[0];

  const [result, views, stageCounts, closingThisWeek] = await Promise.all([
    getLeads({
      status: params.status as any || undefined,
      source: params.source as any || undefined,
      segment: params.segment || undefined,
      search: params.search || undefined,
      assignedTo: params.assignedTo || undefined,
      archivedOnly: isArchived,
      page,
      pageSize: 50,
      sort: params.sort || undefined,
      dir: (params.dir as 'asc' | 'desc') || undefined,
    }),
    getMyViews('leads'),
    getLeadStageCounts(),
    getLeadsClosingBetween(weekStart, weekEnd),
  ]);

  const currentFilters: Record<string, string> = {};
  if (params.status) currentFilters.status = params.status;
  if (params.source) currentFilters.source = params.source;
  if (params.segment) currentFilters.segment = params.segment;
  if (params.search) currentFilters.search = params.search;
  if (params.assignedTo) currentFilters.assignedTo = params.assignedTo;

  const activeView = params.view ? views.find((v: any) => v.id === params.view) : null;
  const viewCols = activeView?.columns as string[] | undefined;
  const visibleColumns = viewCols && viewCols.length > 0
    ? viewCols
    : getDefaultColumns('leads');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">MARKETING PIPELINE</Eyebrow>
          <h1 className="text-2xl font-bold text-n-900">Leads</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/leads/new">
            <Button>New Lead</Button>
          </Link>
        </div>
      </div>

      {/* Pipeline Summary Cards */}
      <PipelineSummary
        stageCounts={stageCounts}
        closingThisWeekCount={closingThisWeek.length}
      />

      {/* Stage Navigation (like project tabs) */}
      <LeadStageNav
        stageCounts={stageCounts.map(sc => ({ status: sc.status, count: sc.count }))}
      />

      {/* Quick Filters */}
      <Card>
        <CardContent className="py-3">
          <form className="flex items-center gap-3 flex-wrap">
            <Select name="source" defaultValue={params.source ?? ''} className="w-36 h-9 text-sm">
              <option value="">All Sources</option>
              <option value="referral">Referral</option>
              <option value="website">Website</option>
              <option value="builder_tie_up">Builder Tie-up</option>
              <option value="channel_partner">Channel Partner</option>
              <option value="cold_call">Cold Call</option>
              <option value="exhibition">Exhibition</option>
              <option value="social_media">Social Media</option>
              <option value="walkin">Walk-in</option>
            </Select>
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-36 h-9 text-sm">
              <option value="">All Segments</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search name or phone..."
              className="w-56 h-9 text-sm"
            />
            <Button type="submit" variant="outline" size="sm" className="h-9">Filter</Button>
            {Object.keys(currentFilters).length > 0 && (
              <Link href="/leads">
                <Button type="button" variant="ghost" size="sm" className="h-9">Clear</Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* DataTable */}
      <LeadsTableWrapper
        data={result.data}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        sortColumn={params.sort}
        sortDirection={params.dir}
        currentFilters={currentFilters}
        views={views}
        activeViewId={params.view ?? null}
        visibleColumns={visibleColumns}
      />
    </div>
  );
}
```

Note: The status dropdown is removed from the filter card since stage navigation handles it now.

- [ ] **Step 2: Verify the page loads**

```bash
cd apps/erp && npx next dev
```

Navigate to http://localhost:3000/leads and verify stage nav bar, pipeline cards, and table render.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/(erp)/leads/page.tsx
git commit -m "feat: redesign leads page with stage nav and pipeline summary"
```

---

### Task 7: Lead Detail Layout with Tab Navigation

**Files:**
- Create: `apps/erp/src/app/(erp)/leads/[id]/layout.tsx`
- Create: `apps/erp/src/components/leads/lead-tabs.tsx`

- [ ] **Step 1: Create lead tabs component**

Create `apps/erp/src/components/leads/lead-tabs.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  label: string;
  href: string;
}

export function LeadTabs({ leadId, showPayments }: { leadId: string; showPayments: boolean }) {
  const pathname = usePathname();
  const base = `/leads/${leadId}`;

  const tabs: Tab[] = [
    { label: 'Details', href: base },
    { label: 'Activities', href: `${base}/activities` },
    { label: 'Tasks', href: `${base}/tasks` },
    { label: 'Proposal', href: `${base}/proposal` },
    { label: 'Files', href: `${base}/files` },
  ];

  if (showPayments) {
    tabs.push({ label: 'Payments', href: `${base}/payments` });
  }

  return (
    <div className="border-b border-n-200">
      <nav className="flex items-center gap-0 -mb-px overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-shiroi-green text-shiroi-green'
                  : 'border-transparent text-n-500 hover:text-n-900 hover:border-n-300'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: Create lead detail layout**

Create `apps/erp/src/app/(erp)/leads/[id]/layout.tsx`:

```typescript
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadTabs } from '@/components/leads/lead-tabs';
import { StatusChange } from '@/components/leads/status-change';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { Breadcrumb } from '@repo/ui';

interface LeadDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export default async function LeadDetailLayout({ params, children }: LeadDetailLayoutProps) {
  const { id } = await params;
  const lead = await getLead(id);

  if (!lead) {
    notFound();
  }

  const showPayments = lead.status === 'won' || lead.status === 'converted';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        className="mb-2"
        items={[
          { label: 'Leads', href: '/leads' },
          { label: lead.customer_name },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-n-900">{lead.customer_name}</h1>
          <div className="flex items-center gap-3">
            <LeadStatusBadge status={lead.status} />
            {lead.employees?.full_name && (
              <span className="text-sm text-n-500">
                Assigned to {lead.employees.full_name}
              </span>
            )}
            {lead.expected_close_date && (
              <span className="text-sm text-n-500">
                Expected close: {new Date(lead.expected_close_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            )}
            {lead.close_probability != null && lead.close_probability > 0 && (
              <span className="text-sm font-medium text-n-600">
                {lead.close_probability}% probability
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <QuickQuoteButton
            leadId={lead.id}
            systemType={lead.system_type}
            sizeKwp={lead.estimated_size_kwp}
            segment={lead.segment}
          />
          <StatusChange leadId={lead.id} currentStatus={lead.status} />
        </div>
      </div>

      {/* Tabs */}
      <LeadTabs leadId={id} showPayments={showPayments} />

      {/* Tab content */}
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/leads/lead-tabs.tsx apps/erp/src/app/(erp)/leads/[id]/layout.tsx
git commit -m "feat: add lead detail layout with tab navigation (mirrors project layout)"
```

---

### Task 8: Refactor Lead Detail Page into Details Tab

**Files:**
- Modify: `apps/erp/src/app/(erp)/leads/[id]/page.tsx`

- [ ] **Step 1: Rewrite the details page**

The current page.tsx has header + breadcrumb + activity feed + sidebar info. Since header and breadcrumb are now in `layout.tsx`, rewrite `page.tsx` to be just the Details tab content (contact info + lead details + notes):

```typescript
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { getEntityContacts } from '@/lib/contacts-queries';
import { EntityContactsCard } from '@/components/contacts/entity-contacts-card';
import { formatDate, toIST } from '@repo/ui/formatters';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailsTab({ params }: LeadDetailPageProps) {
  const { id } = await params;
  const [lead, entityContacts] = await Promise.all([
    getLead(id),
    getEntityContacts('lead', id),
  ]);

  if (!lead) {
    notFound();
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Main content: Editable lead details */}
      <div className="col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Segment" value={lead.segment} capitalize />
            <InfoRow label="Source" value={lead.source?.replace(/_/g, ' ')} capitalize />
            {lead.system_type && (
              <InfoRow label="System Type" value={lead.system_type.replace(/_/g, ' ')} capitalize />
            )}
            {lead.estimated_size_kwp && (
              <InfoRow label="Est. Size" value={`${lead.estimated_size_kwp} kWp`} />
            )}
            <InfoRow label="Expected Close" value={lead.expected_close_date ? formatDate(lead.expected_close_date) : null} />
            <InfoRow label="Probability" value={lead.close_probability != null ? `${lead.close_probability}%` : null} />
            {lead.next_followup_date && (
              <InfoRow label="Next Follow-up" value={formatDate(lead.next_followup_date)} />
            )}
            {lead.last_contacted_at && (
              <InfoRow label="Last Contacted" value={toIST(lead.last_contacted_at)} />
            )}
          </CardContent>
        </Card>

        {lead.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-n-700 whitespace-pre-wrap">{lead.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sidebar: Contact info */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Phone" value={lead.phone} mono />
            <InfoRow label="Email" value={lead.email} />
            <InfoRow label="City" value={lead.city} />
            <InfoRow label="State" value={lead.state} />
            {lead.pincode && <InfoRow label="Pincode" value={lead.pincode} />}
            {lead.address_line1 && <InfoRow label="Address" value={lead.address_line1} />}
          </CardContent>
        </Card>

        <EntityContactsCard entityType="lead" entityId={id} contacts={entityContacts} />
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  capitalize: cap,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  capitalize?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-n-500">{label}</span>
      <span className={`text-n-900 ${mono ? 'font-mono' : ''} ${cap ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/leads/[id]/page.tsx
git commit -m "refactor: convert lead detail page to Details tab content"
```

---

### Task 9: Activities Tab Page

**Files:**
- Create: `apps/erp/src/app/(erp)/leads/[id]/activities/page.tsx`

- [ ] **Step 1: Create activities tab page**

Create `apps/erp/src/app/(erp)/leads/[id]/activities/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { getLead, getLeadActivities } from '@/lib/leads-queries';
import { ActivityFeed } from '@/components/leads/activity-feed';
import { AddActivityForm } from '@/components/leads/add-activity-form';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface ActivitiesTabProps {
  params: Promise<{ id: string }>;
}

export default async function ActivitiesTab({ params }: ActivitiesTabProps) {
  const { id } = await params;
  const [lead, activities] = await Promise.all([
    getLead(id),
    getLeadActivities(id),
  ]);

  if (!lead) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Quick call log form at the top (most common action) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <AddActivityForm leadId={id} />
        </CardContent>
      </Card>

      {/* Activity timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity History</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityFeed activities={activities} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/leads/[id]/activities/page.tsx
git commit -m "feat: add activities tab page for lead detail"
```

---

### Task 10: Tasks Tab + Quick Add Task

**Files:**
- Create: `apps/erp/src/app/(erp)/leads/[id]/tasks/page.tsx`
- Create: `apps/erp/src/components/leads/quick-add-task.tsx`
- Create: `apps/erp/src/lib/leads-task-actions.ts`

- [ ] **Step 1: Create task server actions**

Create `apps/erp/src/lib/leads-task-actions.ts`:

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

interface CreateLeadTaskInput {
  leadId: string;
  title: string;
  description?: string;
  assignedTo: string;
  dueDate: string;
  priority?: string;
}

export async function createLeadTask(input: CreateLeadTaskInput): Promise<{ success: boolean; error?: string }> {
  const op = '[createLeadTask]';
  console.log(`${op} Starting for lead: ${input.leadId}`);

  if (!input.title.trim()) return { success: false, error: 'Title is required' };
  if (!input.assignedTo) return { success: false, error: 'Assignee is required' };
  if (!input.dueDate) return { success: false, error: 'Due date is required' };

  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Look up employee record
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return { success: false, error: 'Employee record not found' };

  const { error } = await supabase.from('tasks').insert({
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description || null,
    entity_type: 'lead',
    entity_id: input.leadId,
    assigned_to: input.assignedTo,
    created_by: employee.id,
    due_date: input.dueDate,
    priority: input.priority ?? 'medium',
    is_completed: false,
  });

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads/${input.leadId}/tasks`);
  revalidatePath('/my-tasks');
  return { success: true };
}

export async function completeLeadTask(taskId: string, leadId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[completeLeadTask]';
  console.log(`${op} Starting for task: ${taskId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return { success: false, error: 'Employee record not found' };

  const { error } = await supabase
    .from('tasks')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      completed_by: employee.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads/${leadId}/tasks`);
  revalidatePath('/my-tasks');
  return { success: true };
}

export async function getLeadTasks(leadId: string) {
  const op = '[getLeadTasks]';
  console.log(`${op} Starting for lead: ${leadId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('*, assigned:employees!project_tasks_assigned_to_fkey(full_name), creator:employees!project_tasks_created_by_fkey(full_name)')
    .eq('entity_type', 'lead')
    .eq('entity_id', leadId)
    .is('deleted_at', null)
    .order('due_date', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load lead tasks: ${error.message}`);
  }
  return data ?? [];
}
```

- [ ] **Step 2: Create quick-add-task dialog component**

Create `apps/erp/src/components/leads/quick-add-task.tsx`:

```typescript
'use client';

import { useState, useTransition } from 'react';
import { createLeadTask } from '@/lib/leads-task-actions';
import { Button, Input, Select } from '@repo/ui';

interface QuickAddTaskProps {
  leadId: string;
  employees: { id: string; full_name: string }[];
  currentUserId: string;
}

export function QuickAddTask({ leadId, employees, currentUserId }: QuickAddTaskProps) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState(currentUserId);
  const [dueDate, setDueDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [priority, setPriority] = useState('medium');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    startTransition(async () => {
      const result = await createLeadTask({
        leadId,
        title: title.trim(),
        assignedTo,
        dueDate,
        priority,
      });
      if (result.success) {
        setTitle('');
        setMessage({ type: 'success', text: 'Task created' });
        setTimeout(() => setMessage(null), 2000);
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Failed' });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <label className="text-xs font-medium text-n-500 mb-1 block">Task</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Call back about site survey"
          className="h-9 text-sm"
          required
        />
      </div>
      <div className="w-44">
        <label className="text-xs font-medium text-n-500 mb-1 block">Assign To</label>
        <Select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className="h-9 text-sm"
        >
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name} {emp.id === currentUserId ? '(Me)' : ''}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-36">
        <label className="text-xs font-medium text-n-500 mb-1 block">Due Date</label>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-9 text-sm"
          required
        />
      </div>
      <div className="w-28">
        <label className="text-xs font-medium text-n-500 mb-1 block">Priority</label>
        <Select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="h-9 text-sm"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
      </div>
      <Button type="submit" size="sm" className="h-9" disabled={isPending}>
        {isPending ? 'Adding...' : 'Add Task'}
      </Button>
      {message && (
        <span className={`text-xs ${message.type === 'success' ? 'text-shiroi-green' : 'text-red-600'}`}>
          {message.text}
        </span>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Create tasks tab page**

Create `apps/erp/src/app/(erp)/leads/[id]/tasks/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { getSalesEngineers } from '@/lib/leads-queries';
import { getLeadTasks } from '@/lib/leads-task-actions';
import { QuickAddTask } from '@/components/leads/quick-add-task';
import { TaskList } from '@/components/leads/task-list';
import { createClient } from '@repo/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface TasksTabProps {
  params: Promise<{ id: string }>;
}

export default async function TasksTab({ params }: TasksTabProps) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: currentEmployee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user!.id)
    .single();

  const [lead, tasks, employees] = await Promise.all([
    getLead(id),
    getLeadTasks(id),
    getSalesEngineers(),
  ]);

  if (!lead) {
    notFound();
  }

  const pendingTasks = tasks.filter(t => !t.is_completed);
  const completedTasks = tasks.filter(t => t.is_completed);

  return (
    <div className="space-y-6">
      {/* Quick add task - inline form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Task</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickAddTask
            leadId={id}
            employees={employees}
            currentUserId={currentEmployee?.id ?? ''}
          />
        </CardContent>
      </Card>

      {/* Pending tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pending Tasks ({pendingTasks.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingTasks.length === 0 ? (
            <p className="text-sm text-n-500">No pending tasks</p>
          ) : (
            <div className="divide-y divide-n-100">
              {pendingTasks.map((task) => (
                <TaskRow key={task.id} task={task} leadId={id} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-n-500">
              Completed ({completedTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-n-100">
              {completedTasks.map((task) => (
                <TaskRow key={task.id} task={task} leadId={id} completed />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TaskRow({ task, leadId, completed }: { task: any; leadId: string; completed?: boolean }) {
  const isOverdue = !completed && task.due_date && new Date(task.due_date) < new Date();
  return (
    <div className={`py-3 flex items-center justify-between ${completed ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${
          completed ? 'bg-n-300' :
          task.priority === 'urgent' ? 'bg-red-500' :
          task.priority === 'high' ? 'bg-orange-500' :
          'bg-n-300'
        }`} />
        <div>
          <div className={`text-sm font-medium ${completed ? 'line-through text-n-500' : 'text-n-900'}`}>
            {task.title}
          </div>
          <div className="text-xs text-n-500">
            {task.assigned?.full_name ?? 'Unassigned'}
            {task.due_date && (
              <span className={isOverdue ? 'text-red-600 font-medium ml-2' : ' ml-2'}>
                Due: {new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </span>
            )}
          </div>
        </div>
      </div>
      {!completed && (
        <form action={async () => {
          'use server';
          const { completeLeadTask } = await import('@/lib/leads-task-actions');
          await completeLeadTask(task.id, leadId);
        }}>
          <button
            type="submit"
            className="text-xs text-n-500 hover:text-shiroi-green border border-n-200 rounded px-2 py-1"
          >
            Done
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/lib/leads-task-actions.ts apps/erp/src/components/leads/quick-add-task.tsx apps/erp/src/app/(erp)/leads/[id]/tasks/page.tsx
git commit -m "feat: add tasks tab with quick-add for leads"
```

---

### Task 11: Proposal Tab Page

**Files:**
- Create: `apps/erp/src/app/(erp)/leads/[id]/proposal/page.tsx`

- [ ] **Step 1: Create proposal tab page**

Create `apps/erp/src/app/(erp)/leads/[id]/proposal/page.tsx`:

```typescript
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { Card, CardHeader, CardTitle, CardContent, Button, EmptyState } from '@repo/ui';

interface ProposalTabProps {
  params: Promise<{ id: string }>;
}

export default async function ProposalTab({ params }: ProposalTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  // Fetch proposals linked to this lead
  const supabase = await createClient();
  const { data: proposals, error } = await supabase
    .from('proposals')
    .select('id, proposal_number, revision_number, status, system_type, system_size_kwp, total_price, margin_pct, created_at, is_budgetary')
    .eq('lead_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ProposalTab] Query failed:', { code: error.code, message: error.message });
  }

  const proposalList = proposals ?? [];

  if (proposalList.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          title="No proposals yet"
          description="Create a proposal for this lead to get started."
          action={
            <QuickQuoteButton
              leadId={lead.id}
              systemType={lead.system_type}
              sizeKwp={lead.estimated_size_kwp}
              segment={lead.segment}
            />
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick action to create another proposal */}
      <div className="flex justify-end">
        <QuickQuoteButton
          leadId={lead.id}
          systemType={lead.system_type}
          sizeKwp={lead.estimated_size_kwp}
          segment={lead.segment}
        />
      </div>

      {/* Proposal cards */}
      {proposalList.map((proposal) => (
        <Card key={proposal.id}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/proposals/${proposal.id}`}
                    className="text-sm font-mono font-medium text-n-900 hover:text-shiroi-green"
                  >
                    {proposal.proposal_number}
                  </Link>
                  <ProposalStatusBadge status={proposal.status} />
                  {proposal.is_budgetary && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">Budgetary</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-n-500">
                  <span>Rev {proposal.revision_number}</span>
                  <span>{proposal.system_size_kwp} kWp {proposal.system_type?.replace(/_/g, ' ')}</span>
                  <span>{formatDate(proposal.created_at)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold font-mono text-n-900">
                  {formatINR(proposal.total_price)}
                </div>
                <div className="text-xs text-n-500">
                  {proposal.margin_pct?.toFixed(1)}% margin
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/leads/[id]/proposal/page.tsx
git commit -m "feat: add proposal tab on lead detail"
```

---

### Task 12: Files Tab Page

**Files:**
- Create: `apps/erp/src/app/(erp)/leads/[id]/files/page.tsx`

- [ ] **Step 1: Create files tab page**

Create `apps/erp/src/app/(erp)/leads/[id]/files/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { ProposalFiles } from '@/components/proposals/proposal-files';
import { Card, CardHeader, CardTitle, CardContent, EmptyState } from '@repo/ui';

interface FilesTabProps {
  params: Promise<{ id: string }>;
}

export default async function FilesTab({ params }: FilesTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const supabase = await createClient();

  // Files from proposal-files bucket (keyed by lead_id)
  const { data: proposalFiles } = await supabase.storage
    .from('proposal-files')
    .list(id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

  const files = (proposalFiles ?? []).map(f => ({
    name: f.name,
    id: f.id ?? f.name,
    created_at: f.created_at ?? '',
    metadata: {
      size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
      mimetype: (f.metadata as Record<string, unknown>)?.mimetype as string | undefined,
    },
  }));

  if (files.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          title="No files yet"
          description="Upload proposal documents, site photos, or other files related to this lead."
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Files ({files.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ProposalFiles leadId={id} files={files} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/leads/[id]/files/page.tsx
git commit -m "feat: add files tab on lead detail"
```

---

### Task 13: Payments Tab (Post-Conversion)

**Files:**
- Create: `apps/erp/src/app/(erp)/leads/[id]/payments/page.tsx`

- [ ] **Step 1: Create payments follow-up tab**

Create `apps/erp/src/app/(erp)/leads/[id]/payments/page.tsx`:

```typescript
import { notFound, redirect } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { Card, CardHeader, CardTitle, CardContent, Badge, EmptyState } from '@repo/ui';
import Link from 'next/link';

interface PaymentsTabProps {
  params: Promise<{ id: string }>;
}

export default async function PaymentsTab({ params }: PaymentsTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  // This tab only shows for won/converted leads
  if (lead.status !== 'won' && lead.status !== 'converted') {
    return (
      <div className="py-12">
        <EmptyState
          title="Not yet awarded"
          description="Payment tracking becomes available once the project is won."
        />
      </div>
    );
  }

  const supabase = await createClient();

  // Find linked project
  const { data: project } = await supabase
    .from('projects')
    .select('id, project_number, status, contracted_value, completion_pct')
    .eq('lead_id', id)
    .single();

  if (!project) {
    return (
      <div className="py-12">
        <EmptyState
          title="Project not yet created"
          description="A project needs to be created from this lead to track payments."
        />
      </div>
    );
  }

  // Get payment milestones from the proposal
  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, proposal_number, total_price, proposal_payment_schedule(*)')
    .eq('lead_id', id)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Get actual payments received
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, payment_date, payment_mode, receipt_number, notes')
    .eq('project_id', project.id)
    .order('payment_date', { ascending: true });

  const milestones = proposal?.proposal_payment_schedule ?? [];
  const totalReceived = (payments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const totalExpected = proposal?.total_price ?? project.contracted_value;
  const outstanding = totalExpected - totalReceived;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Project Value</div>
            <div className="text-xl font-bold font-mono text-n-900 mt-1">{formatINR(totalExpected)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Received</div>
            <div className="text-xl font-bold font-mono text-shiroi-green mt-1">{formatINR(totalReceived)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Outstanding</div>
            <div className="text-xl font-bold font-mono text-red-600 mt-1">{formatINR(outstanding)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Project Progress</div>
            <div className="text-xl font-bold text-n-900 mt-1">{project.completion_pct}%</div>
            <Link href={`/projects/${project.id}`} className="text-xs text-shiroi-green hover:underline">
              {project.project_number}
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Payment milestones vs actuals */}
      {milestones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment Milestones</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-100 text-left text-xs text-n-500 uppercase">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Milestone</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {milestones
                  .sort((a: any, b: any) => a.milestone_order - b.milestone_order)
                  .map((m: any) => (
                    <tr key={m.id} className="border-b border-n-50">
                      <td className="py-2 pr-4 text-n-500">{m.milestone_order}</td>
                      <td className="py-2 pr-4 font-medium">{m.milestone_name}</td>
                      <td className="py-2 pr-4 text-n-500 capitalize">{m.due_trigger.replace(/_/g, ' ')}</td>
                      <td className="py-2 pr-4 text-right font-mono">{formatINR(m.amount)}</td>
                      <td className="py-2 pr-4 text-right">{m.percentage}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Actual payments received */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments Received ({(payments ?? []).length})</CardTitle>
        </CardHeader>
        <CardContent>
          {(payments ?? []).length === 0 ? (
            <p className="text-sm text-n-500">No payments received yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-100 text-left text-xs text-n-500 uppercase">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Receipt #</th>
                  <th className="py-2 pr-4">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(payments ?? []).map((p: any) => (
                  <tr key={p.id} className="border-b border-n-50">
                    <td className="py-2 pr-4">{formatDate(p.payment_date)}</td>
                    <td className="py-2 pr-4 text-right font-mono font-medium">{formatINR(p.amount)}</td>
                    <td className="py-2 pr-4 capitalize">{p.payment_mode?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-n-500">{p.receipt_number ?? '—'}</td>
                    <td className="py-2 pr-4 text-n-500 truncate max-w-[200px]">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/leads/[id]/payments/page.tsx
git commit -m "feat: add payments follow-up tab on lead detail"
```

---

### Task 14: Enforce Mandatory Follow-up on Status Change

**Files:**
- Modify: `apps/erp/src/components/leads/status-change.tsx`
- Modify: `apps/erp/src/components/leads/add-activity-form.tsx`

- [ ] **Step 1: Read current status-change.tsx**

Read `apps/erp/src/components/leads/status-change.tsx` fully before modifying.

- [ ] **Step 2: Update status change to require follow-up date**

In `apps/erp/src/components/leads/status-change.tsx`, add a mandatory `next_followup_date` field that shows when the selected status requires follow-up (anything except lost/disqualified/won/converted):

Import the helper:
```typescript
import { requiresFollowUp, DEFAULT_PROBABILITY } from '@/lib/leads-helpers';
```

Before the status update call, add validation:
```typescript
if (requiresFollowUp(newStatus) && !nextFollowupDate) {
  setError('Next follow-up date is required');
  return;
}
```

Add the date input after the status selector:
```typescript
{requiresFollowUp(selectedStatus) && (
  <div className="mt-2">
    <label className="text-xs font-medium text-n-500">Next Follow-up *</label>
    <input
      type="date"
      value={nextFollowupDate}
      onChange={(e) => setNextFollowupDate(e.target.value)}
      min={new Date().toISOString().split('T')[0]}
      className="mt-1 block w-full h-9 rounded-md border border-n-200 px-3 text-sm"
      required
    />
  </div>
)}
```

Update the Supabase update call to also set:
```typescript
next_followup_date: nextFollowupDate || null,
close_probability: DEFAULT_PROBABILITY[newStatus] ?? lead.close_probability,
```

- [ ] **Step 3: Update add-activity-form.tsx to require next follow-up**

In `apps/erp/src/components/leads/add-activity-form.tsx`:

Add a required `next_action_date` field that pre-fills with tomorrow's date. The field should be required for all call/meeting activities. Show a validation error if left empty.

After the existing fields, add:
```typescript
<div>
  <label className="text-sm font-medium text-n-700">Next Follow-up Date *</label>
  <input
    type="date"
    name="next_action_date"
    defaultValue={tomorrow}
    min={new Date().toISOString().split('T')[0]}
    className="mt-1 block w-full h-9 rounded-md border border-n-200 px-3 text-sm"
    required
  />
</div>
```

Also update the server action to propagate the next_action_date to `leads.next_followup_date`:
```typescript
// After inserting the activity, update the lead's next follow-up date
await supabase
  .from('leads')
  .update({
    next_followup_date: formData.get('next_action_date') as string,
    last_contacted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  .eq('id', leadId);
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/leads/status-change.tsx apps/erp/src/components/leads/add-activity-form.tsx
git commit -m "feat: enforce mandatory follow-up date on status change and activity logging"
```

---

### Task 15: Archive/Unarchive Actions

**Files:**
- Modify: `apps/erp/src/lib/leads-actions.ts`

- [ ] **Step 1: Add archive actions**

In `apps/erp/src/lib/leads-actions.ts`, add:

```typescript
export async function archiveLead(leadId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[archiveLead]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }
  revalidatePath('/leads');
  return { success: true };
}

export async function unarchiveLead(leadId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[unarchiveLead]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ is_archived: false, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }
  revalidatePath('/leads');
  return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/leads-actions.ts
git commit -m "feat: add archive/unarchive lead actions"
```

---

### Task 16: Update Sidebar Navigation

**Files:**
- Modify: `apps/erp/src/lib/roles.ts`

- [ ] **Step 1: Update sales_engineer nav**

In `apps/erp/src/lib/roles.ts`, update the `sales_engineer` section:

```typescript
sales_engineer: [
  { label: 'Overview',     items: [ITEMS.dashboard, ITEMS.myTasks] },
  { label: 'Sales',        items: [ITEMS.leads, ITEMS.proposals] },
  { label: 'Liaison',      items: [ITEMS.netMetering] },
  { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
],
```

Key change: `myTasks` added to Overview (tasks are primary for marketing). Removed Campaigns (merged into leads). Removed Marketing label.

Also update the `founder` sidebar to similarly have `myTasks` prominent and remove the separate Marketing item:

```typescript
founder: [
  { label: 'Overview',     items: [ITEMS.dashboard, ITEMS.myTasks] },
  { label: 'Sales',        items: [ITEMS.leads, ITEMS.proposals, ITEMS.liaison] },
  { label: 'Design',       items: [ITEMS.designQueue] },
  { label: 'Projects',     items: [ITEMS.projects, ITEMS.tasks] },
  { label: 'Procurement',  items: [ITEMS.purchaseOrders, ITEMS.vendors, ITEMS.priceBook, ITEMS.inventory] },
  { label: 'O&M',          items: [ITEMS.omVisits, ITEMS.serviceTickets] },
  { label: 'Finance',      items: [ITEMS.cashFlow, ITEMS.invoices, ITEMS.payments, ITEMS.profitability] },
  { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
  { label: 'HR',           items: [ITEMS.employees, ITEMS.leave, ITEMS.payroll, ITEMS.training, ITEMS.certifications] },
],
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/roles.ts
git commit -m "feat: update sidebar nav — tasks primary for sales, remove separate marketing"
```

---

### Task 17: Clean Up Old Marketing Pages

**Files:**
- Delete: `apps/erp/src/app/(erp)/marketing/page.tsx`
- Delete: `apps/erp/src/app/(erp)/marketing/campaigns/page.tsx`

- [ ] **Step 1: Delete old marketing placeholder pages**

Delete `apps/erp/src/app/(erp)/marketing/page.tsx` and `apps/erp/src/app/(erp)/marketing/campaigns/page.tsx`. These are replaced by the integrated stage-based leads flow.

```bash
rm apps/erp/src/app/\(erp\)/marketing/page.tsx
rm apps/erp/src/app/\(erp\)/marketing/campaigns/page.tsx
rmdir apps/erp/src/app/\(erp\)/marketing/campaigns
rmdir apps/erp/src/app/\(erp\)/marketing
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove old marketing placeholder pages (merged into leads)"
```

---

### Task 18: Default Saved Views for Pipeline

**Files:**
- Create: (no file — SQL migration via Supabase MCP)

- [ ] **Step 1: Create useful default views via SQL**

Use `execute_sql` MCP to insert system-level saved views:

```sql
-- Create useful default views for leads pipeline
-- These are system views visible to all users

-- View: "Closing This Week"
INSERT INTO table_views (id, entity_type, name, columns, filters, sort_column, sort_direction, is_default, user_id)
SELECT
  gen_random_uuid(),
  'leads',
  'Closing This Week',
  ARRAY['customer_name', 'phone', 'status', 'expected_close_date', 'close_probability', 'estimated_size_kwp', 'assigned_to_name'],
  '{}',
  'expected_close_date',
  'asc',
  false,
  p.id
FROM profiles p
WHERE p.role IN ('founder', 'sales_engineer')
LIMIT 1;

-- View: "High Probability (>50%)"
INSERT INTO table_views (id, entity_type, name, columns, filters, sort_column, sort_direction, is_default, user_id)
SELECT
  gen_random_uuid(),
  'leads',
  'High Probability',
  ARRAY['customer_name', 'phone', 'status', 'close_probability', 'expected_close_date', 'estimated_size_kwp', 'assigned_to_name'],
  '{}',
  'close_probability',
  'desc',
  false,
  p.id
FROM profiles p
WHERE p.role IN ('founder', 'sales_engineer')
LIMIT 1;

-- View: "Needs Follow-up"
INSERT INTO table_views (id, entity_type, name, columns, filters, sort_column, sort_direction, is_default, user_id)
SELECT
  gen_random_uuid(),
  'leads',
  'Needs Follow-up',
  ARRAY['customer_name', 'phone', 'status', 'next_followup_date', 'assigned_to_name', 'expected_close_date'],
  '{}',
  'next_followup_date',
  'asc',
  false,
  p.id
FROM profiles p
WHERE p.role IN ('founder', 'sales_engineer')
LIMIT 1;
```

Note: These views are per-user. In a future iteration, add a `is_system` boolean to `table_views` for shared views. For now, create them for the founder profile.

- [ ] **Step 2: Commit migration note**

No file commit needed — this is a data-only change applied via MCP.

---

### Task 19: Automated Payment Follow-up Tasks

**Files:**
- Create: `supabase/migrations/021_payment_followup_trigger.sql`

- [ ] **Step 1: Write the trigger migration**

Create `supabase/migrations/021_payment_followup_trigger.sql`:

```sql
-- Migration 021: Auto-create payment follow-up tasks when project reaches milestones
-- When project status advances to certain stages, create tasks for payment collection.

CREATE OR REPLACE FUNCTION create_payment_followup_tasks()
RETURNS trigger AS $$
DECLARE
  v_project_record RECORD;
  v_schedule RECORD;
  v_task_exists boolean;
BEGIN
  -- Only fire on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map project status to payment milestone triggers
  -- advance_received: already paid
  -- material_procurement: typically 2nd payment due
  -- installation: mid-project payment
  -- commissioned: final payment

  IF NEW.status IN ('material_procurement', 'installation', 'testing', 'commissioned', 'completed') THEN
    -- Find any payment milestones that match this stage
    FOR v_schedule IN
      SELECT pps.milestone_name, pps.amount, pps.percentage, pps.due_trigger
      FROM proposals p
      JOIN proposal_payment_schedule pps ON pps.proposal_id = p.id
      WHERE p.lead_id = NEW.lead_id
        AND p.status = 'approved'
        AND pps.due_trigger = NEW.status
      ORDER BY pps.milestone_order
    LOOP
      -- Check if a task already exists for this milestone
      SELECT EXISTS (
        SELECT 1 FROM tasks
        WHERE entity_type = 'lead'
          AND entity_id = NEW.lead_id::text
          AND title LIKE '%' || v_schedule.milestone_name || '%'
          AND deleted_at IS NULL
      ) INTO v_task_exists;

      IF NOT v_task_exists THEN
        INSERT INTO tasks (id, title, description, entity_type, entity_id, project_id, assigned_to, created_by, due_date, priority)
        VALUES (
          gen_random_uuid(),
          'Payment follow-up: ' || v_schedule.milestone_name || ' (' || v_schedule.percentage || '% = Rs.' || ROUND(v_schedule.amount) || ')',
          'Project ' || NEW.project_number || ' has reached ' || REPLACE(NEW.status, '_', ' ') || ' stage. Payment milestone "' || v_schedule.milestone_name || '" is now due.',
          'lead',
          NEW.lead_id::text,
          NEW.id,
          NEW.assigned_pm,
          NEW.assigned_pm,
          (CURRENT_DATE + INTERVAL '3 days')::date,
          'high'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS trg_payment_followup ON projects;

CREATE TRIGGER trg_payment_followup
  AFTER UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION create_payment_followup_tasks();

COMMENT ON FUNCTION create_payment_followup_tasks IS 'Auto-creates payment follow-up tasks when project reaches payment milestone stages';
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `apply_migration` or `execute_sql` MCP tool.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/021_payment_followup_trigger.sql
git commit -m "feat: auto-create payment follow-up tasks on project status advance"
```

---

### Task 20: Update CLAUDE.md and Master Reference

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/SHIROI_MASTER_REFERENCE_3_0.md`

- [ ] **Step 1: Update CLAUDE.md status table**

Add row:
```
| Marketing redesign | ✅ Complete | Stage-based leads, pipeline KPIs, tab-based lead detail, task-centric workflow, payment follow-up |
```

Update the "Current phase" line and any relevant sections.

- [ ] **Step 2: Update master reference**

Add a new section documenting the marketing flow redesign decisions: stage navigation, mandatory follow-up enforcement, weighted pipeline, archived leads, payment follow-up automation.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/SHIROI_MASTER_REFERENCE_3_0.md
git commit -m "docs: update CLAUDE.md and master reference for marketing redesign"
```

---

## Deferred Items (Future Tasks, Not in This Plan)

1. **Voice note recording**: Browser MediaRecorder API to capture audio → Supabase Storage → Claude API transcription → auto-fill activity summary. Requires mobile-first testing and microphone permissions. Complex enough for its own plan.

2. **Campaign management**: The old `/marketing/campaigns` page was a placeholder. If Vivek needs campaign tracking (bulk emails, social media campaigns, event tracking), this should be a separate plan.

3. **Shared/system saved views**: Currently views are per-user. Adding `is_system` boolean to `table_views` for org-wide default views.

4. **Bulk lead assignment as daily tasks**: A "Today's Call List" view where the marketing manager can drag-drop leads to assign as daily call tasks to specific salespeople. Requires a dedicated UI.

5. **WhatsApp integration (WATI.io)**: Send follow-up reminders via WhatsApp. Depends on WATI registration completing.

---

## Prem's Account Setup

**Cannot be done via SQL/MCP** — requires Supabase Auth admin API.

**Vivek**: Navigate to `https://erp.shiroienergy.com/hr/employees/new` and create:
- Email: `prem@shiroienergy.com`
- Role: `sales_engineer`
- Department: Marketing / Sales
- The page will generate a temporary password — share it with Prem

---

## Summary of Changes

| Area | Before | After |
|------|--------|-------|
| Leads list | Flat DataTable with status dropdown filter | Stage-based tab navigation (like projects), pipeline KPI cards, archived toggle |
| Lead detail | Single page with activity feed + sidebar | Tab-based layout: Details, Activities, Tasks, Proposal, Files, Payments |
| Task creation | Only via /tasks page | Quick-add inline on lead detail Tasks tab |
| Follow-up | Optional | Mandatory on every status change (except Lost/Disqualified) |
| Pipeline visibility | None | Expected close date + probability % = weighted pipeline value |
| Payment tracking | Only on project detail | Also on lead Payments tab, linked to project milestones |
| Payment automation | Manual | Auto-created tasks when project hits milestone stages |
| Marketing pages | Placeholder campaigns page | Removed — merged into leads flow |
| Sidebar | Sales: Leads, Proposals, Campaigns | Sales: Tasks, Leads, Proposals |
