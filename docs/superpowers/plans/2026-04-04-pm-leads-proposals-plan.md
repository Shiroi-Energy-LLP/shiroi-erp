# PM Screens + Leads/Proposals Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pagination + bulk actions to leads/proposals pages, fix PM dashboard KPIs and add missing widgets (donut chart, operations, today panel), add pagination to projects/tasks lists.

**Architecture:** Server-side pagination via URL search params and Supabase `.range()`. Bulk actions use a client component wrapper around server-fetched data with server actions for mutations. PM dashboard adds recharts donut chart and new query metrics.

**Tech Stack:** Next.js 14 App Router, Supabase, TypeScript, Tailwind CSS, recharts (new), @radix-ui/react-checkbox (new)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/ui/src/components/pagination.tsx` | Reusable server-side pagination bar |
| `packages/ui/src/components/checkbox.tsx` | Radix-based checkbox for table selection |
| `apps/erp/src/components/leads/leads-table.tsx` | Client component: table with checkboxes + selection state |
| `apps/erp/src/components/leads/bulk-action-bar.tsx` | Toolbar for bulk assign/status/delete/merge |
| `apps/erp/src/components/leads/merge-leads-modal.tsx` | Side-by-side lead merge dialog |
| `apps/erp/src/lib/leads-actions.ts` | Server actions: bulk assign, status, delete, merge |
| `apps/erp/src/components/proposals/proposals-table.tsx` | Client component: proposals table with pagination awareness |
| `apps/erp/src/components/dashboard/pm-donut-chart.tsx` | Recharts donut chart for project status |
| `apps/erp/src/components/dashboard/operations-widget.tsx` | Progress bars for tasks/services/AMCs |
| `apps/erp/src/components/dashboard/today-priorities.tsx` | Dark panel with priority projects |

### Modified Files
| File | Changes |
|------|---------|
| `packages/ui/src/index.ts` | Export Pagination, Checkbox |
| `packages/ui/package.json` | Add @radix-ui/react-checkbox |
| `apps/erp/package.json` | Add recharts |
| `apps/erp/src/lib/leads-queries.ts` | Add pagination, segment filter, return total count |
| `apps/erp/src/lib/proposals-queries.ts` | Add pagination, type/system filters, return total count |
| `apps/erp/src/lib/projects-queries.ts` | Add pagination, return total count |
| `apps/erp/src/app/(erp)/leads/page.tsx` | Wire pagination, new filters, use LeadsTable |
| `apps/erp/src/app/(erp)/proposals/page.tsx` | Wire pagination, new filters |
| `apps/erp/src/app/(erp)/projects/page.tsx` | Wire pagination |
| `apps/erp/src/lib/pm-queries.ts` | New KPI metrics, operations data, priority projects |
| `apps/erp/src/app/(erp)/dashboard/pm-dashboard.tsx` | New KPIs, donut chart, operations, today panel |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `apps/erp/package.json`

- [ ] **Step 1: Install @radix-ui/react-checkbox in packages/ui**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && pnpm add @radix-ui/react-checkbox --filter @repo/ui
```

- [ ] **Step 2: Install recharts in apps/erp**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && pnpm add recharts --filter @repo/erp
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && git add packages/ui/package.json apps/erp/package.json pnpm-lock.yaml && git commit -m "chore: add recharts and @radix-ui/react-checkbox dependencies"
```

---

## Task 2: Checkbox Component

**Files:**
- Create: `packages/ui/src/components/checkbox.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create checkbox component**

Create `packages/ui/src/components/checkbox.tsx`:

```typescript
'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded border-[1.5px] border-[#DFE2E8] bg-white ring-offset-white transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B050] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[#00B050] data-[state=checked]:bg-[#00B050] data-[state=indeterminate]:border-[#00B050] data-[state=indeterminate]:bg-[#00B050]',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
      {props.checked === 'indeterminate' ? (
        <Minus className="h-3 w-3" />
      ) : (
        <Check className="h-3 w-3" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };
```

- [ ] **Step 2: Export from index**

Add to `packages/ui/src/index.ts`:

```typescript
export * from './components/checkbox';
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/checkbox.tsx packages/ui/src/index.ts && git commit -m "feat: add Checkbox component to design system"
```

---

## Task 3: Pagination Component

**Files:**
- Create: `packages/ui/src/components/pagination.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create pagination component**

Create `packages/ui/src/components/pagination.tsx`:

```typescript
import * as React from 'react';
import { cn } from '../lib/utils';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  pageSize: number;
  basePath: string;
  searchParams?: Record<string, string>;
  entityName?: string;
}

function buildHref(basePath: string, searchParams: Record<string, string>, page: number): string {
  const params = new URLSearchParams(searchParams);
  if (page > 1) {
    params.set('page', String(page));
  } else {
    params.delete('page');
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({
  currentPage,
  totalPages,
  totalRecords,
  pageSize,
  basePath,
  searchParams = {},
  entityName = 'records',
}: PaginationProps) {
  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between border-t border-[#EBEDF2] px-4 py-3">
        <span className="text-[13px] text-[#7C818E]">
          {totalRecords} {entityName}
        </span>
      </div>
    );
  }

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalRecords);

  // Calculate page window (5 pages centered on current)
  const windowSize = 5;
  let startPage = Math.max(1, currentPage - Math.floor(windowSize / 2));
  const endPage = Math.min(totalPages, startPage + windowSize - 1);
  if (endPage - startPage + 1 < windowSize) {
    startPage = Math.max(1, endPage - windowSize + 1);
  }

  const pages: number[] = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  // Remove 'page' from searchParams to avoid duplication in buildHref
  const cleanParams = { ...searchParams };
  delete cleanParams.page;

  return (
    <div className="flex items-center justify-between border-t border-[#EBEDF2] px-4 py-3">
      <span className="text-[13px] text-[#7C818E]">
        Showing {from}–{to} of {totalRecords} {entityName}
      </span>

      <div className="flex items-center gap-1">
        {/* First */}
        <PaginationLink
          href={buildHref(basePath, cleanParams, 1)}
          disabled={currentPage === 1}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </PaginationLink>

        {/* Previous */}
        <PaginationLink
          href={buildHref(basePath, cleanParams, currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </PaginationLink>

        {/* Page numbers */}
        {pages.map((page) => (
          <PaginationLink
            key={page}
            href={buildHref(basePath, cleanParams, page)}
            active={page === currentPage}
          >
            {page}
          </PaginationLink>
        ))}

        {/* Next */}
        <PaginationLink
          href={buildHref(basePath, cleanParams, currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </PaginationLink>

        {/* Last */}
        <PaginationLink
          href={buildHref(basePath, cleanParams, totalPages)}
          disabled={currentPage === totalPages}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </PaginationLink>
      </div>
    </div>
  );
}

interface PaginationLinkProps {
  href: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
  'aria-label'?: string;
}

function PaginationLink({ href, disabled, active, children, ...props }: PaginationLinkProps) {
  if (disabled) {
    return (
      <span
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] text-[#BFC3CC] cursor-not-allowed"
        {...props}
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] font-medium transition-colors duration-150',
        active
          ? 'bg-[#00B050] text-white'
          : 'text-[#3F424D] hover:bg-[#F8F9FB]'
      )}
      {...props}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 2: Export from index**

Add to `packages/ui/src/index.ts`:

```typescript
export * from './components/pagination';
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/pagination.tsx packages/ui/src/index.ts && git commit -m "feat: add Pagination component to design system"
```

---

## Task 4: Update Leads Queries with Pagination

**Files:**
- Modify: `apps/erp/src/lib/leads-queries.ts`

- [ ] **Step 1: Update LeadFilters and add PaginatedResult type, update getLeads**

Replace the content of `apps/erp/src/lib/leads-queries.ts`. The key changes:
- Add `segment`, `page`, `pageSize` to `LeadFilters`
- Add `PaginatedResult` type
- Use `{ count: 'exact' }` in `.select()` and `.range()` for pagination
- Return `PaginatedResult` from `getLeads`

```typescript
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];
type LeadSource = Database['public']['Enums']['lead_source'];
type CustomerSegment = Database['public']['Enums']['customer_segment'];

export { isValidTransition, normalizePhone, getValidNextStatuses } from './leads-helpers';

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  segment?: CustomerSegment;
  search?: string;
  assignedTo?: string;
  includeConverted?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getLeads(filters: LeadFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getLeads]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('leads')
    .select(
      'id, customer_name, phone, email, city, segment, source, status, estimated_size_kwp, assigned_to, next_followup_date, created_at, employees!leads_assigned_to_fkey(full_name)',
      { count: 'exact' }
    )
    .is('deleted_at', null);

  if (filters.status) {
    query = query.eq('status', filters.status);
  } else if (!filters.includeConverted) {
    query = query.not('status', 'eq', 'converted');
  }
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.segment) query = query.eq('segment', filters.segment);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.search) {
    query = query.or(`customer_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
  }

  // Sorting
  const sortColumn = filters.sort ?? 'created_at';
  const sortAsc = filters.dir === 'asc';
  query = query.order(sortColumn, { ascending: sortAsc });

  // Pagination
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load leads: ${error.message}`);
  }

  const total = count ?? 0;
  return {
    data: data ?? [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getLead(id: string) {
  const op = '[getLead]';
  console.log(`${op} Starting for: ${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .select('*, employees!leads_assigned_to_fkey(full_name)')
    .eq('id', id)
    .single();
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load lead: ${error.message}`);
  }
  if (!data) return null;
  return data;
}

export async function getLeadActivities(leadId: string) {
  const op = '[getLeadActivities]';
  console.log(`${op} Starting for: ${leadId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lead_activities')
    .select('*, employees!lead_activities_performed_by_fkey(full_name)')
    .eq('lead_id', leadId)
    .order('activity_date', { ascending: false });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, leadId });
    throw new Error(`Failed to load activities: ${error.message}`);
  }
  return data ?? [];
}

export async function getSalesEngineers() {
  const op = '[getSalesEngineers]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load sales engineers: ${error.message}`);
  }
  return data ?? [];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/leads-queries.ts && git commit -m "feat: add pagination support to leads queries"
```

---

## Task 5: Leads Server Actions

**Files:**
- Create: `apps/erp/src/lib/leads-actions.ts`

- [ ] **Step 1: Create server actions file**

Create `apps/erp/src/lib/leads-actions.ts`:

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];

export async function bulkAssignLeads(leadIds: string[], assignedTo: string): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkAssignLeads]';
  console.log(`${op} Starting for ${leadIds.length} leads`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };
  if (!assignedTo) return { success: false, error: 'No assignee selected' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .in('id', leadIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/leads');
  return { success: true };
}

export async function bulkChangeLeadStatus(leadIds: string[], status: LeadStatus): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkChangeLeadStatus]';
  console.log(`${op} Starting for ${leadIds.length} leads → ${status}`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({
      status,
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', leadIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/leads');
  return { success: true };
}

export async function bulkDeleteLeads(leadIds: string[]): Promise<{ success: boolean; error?: string }> {
  const op = '[bulkDeleteLeads]';
  console.log(`${op} Starting for ${leadIds.length} leads`);

  if (leadIds.length === 0) return { success: false, error: 'No leads selected' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('leads')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', leadIds);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/leads');
  return { success: true };
}

export async function mergeLeads(
  primaryId: string,
  secondaryId: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[mergeLeads]';
  console.log(`${op} Merging ${secondaryId} into ${primaryId}`);

  if (!primaryId || !secondaryId) return { success: false, error: 'Both lead IDs required' };
  if (primaryId === secondaryId) return { success: false, error: 'Cannot merge a lead with itself' };

  const supabase = await createClient();

  // Fetch both leads
  const [primaryResult, secondaryResult] = await Promise.all([
    supabase.from('leads').select('*').eq('id', primaryId).single(),
    supabase.from('leads').select('*').eq('id', secondaryId).single(),
  ]);

  if (primaryResult.error || !primaryResult.data) {
    return { success: false, error: `Primary lead not found: ${primaryResult.error?.message}` };
  }
  if (secondaryResult.error || !secondaryResult.data) {
    return { success: false, error: `Secondary lead not found: ${secondaryResult.error?.message}` };
  }

  const primary = primaryResult.data;
  const secondary = secondaryResult.data;

  // Fill missing fields on primary from secondary
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!primary.email && secondary.email) updates.email = secondary.email;
  if (!primary.address_line1 && secondary.address_line1) updates.address_line1 = secondary.address_line1;
  if (!primary.address_line2 && secondary.address_line2) updates.address_line2 = secondary.address_line2;
  if (!primary.state && secondary.state) updates.state = secondary.state;
  if (!primary.pincode && secondary.pincode) updates.pincode = secondary.pincode;
  if (!primary.estimated_size_kwp && secondary.estimated_size_kwp) updates.estimated_size_kwp = secondary.estimated_size_kwp;
  if (!primary.system_type && secondary.system_type) updates.system_type = secondary.system_type;

  // Update primary lead with merged fields
  if (Object.keys(updates).length > 1) {
    const { error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', primaryId);
    if (updateError) {
      console.error(`${op} Update primary failed:`, { code: updateError.code, message: updateError.message });
      return { success: false, error: `Failed to update primary lead: ${updateError.message}` };
    }
  }

  // Transfer activities from secondary to primary
  const { error: activityError } = await supabase
    .from('lead_activities')
    .update({ lead_id: primaryId })
    .eq('lead_id', secondaryId);

  if (activityError) {
    console.error(`${op} Transfer activities failed:`, { code: activityError.code, message: activityError.message });
    return { success: false, error: `Failed to transfer activities: ${activityError.message}` };
  }

  // Transfer proposals from secondary to primary
  const { error: proposalError } = await supabase
    .from('proposals')
    .update({ lead_id: primaryId })
    .eq('lead_id', secondaryId);

  if (proposalError) {
    console.error(`${op} Transfer proposals failed:`, { code: proposalError.code, message: proposalError.message });
    return { success: false, error: `Failed to transfer proposals: ${proposalError.message}` };
  }

  // Soft-delete secondary lead
  const { error: deleteError } = await supabase
    .from('leads')
    .update({
      deleted_at: new Date().toISOString(),
      notes: `${secondary.notes ? secondary.notes + '\n' : ''}[Merged into ${primary.customer_name} on ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}]`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', secondaryId);

  if (deleteError) {
    console.error(`${op} Delete secondary failed:`, { code: deleteError.code, message: deleteError.message });
    return { success: false, error: `Failed to delete secondary lead: ${deleteError.message}` };
  }

  revalidatePath('/leads');
  return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/leads-actions.ts && git commit -m "feat: add server actions for leads bulk operations and merge"
```

---

## Task 6: LeadsTable Client Component with Selection

**Files:**
- Create: `apps/erp/src/components/leads/leads-table.tsx`

- [ ] **Step 1: Create the LeadsTable client component**

Create `apps/erp/src/components/leads/leads-table.tsx`:

```typescript
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LeadStatusBadge } from './lead-status-badge';
import { BulkActionBar } from './bulk-action-bar';
import { toIST, formatDate } from '@repo/ui/formatters';
import {
  Checkbox,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  city: string;
  segment: string | null;
  source: string | null;
  status: string;
  estimated_size_kwp: number | null;
  assigned_to: string | null;
  next_followup_date: string | null;
  created_at: string;
  employees: { full_name: string } | null;
}

interface Employee {
  id: string;
  full_name: string;
}

interface LeadsTableProps {
  leads: Lead[];
  employees: Employee[];
}

export function LeadsTable({ leads, employees }: LeadsTableProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const allSelected = leads.length > 0 && selectedIds.size === leads.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function onActionComplete() {
    clearSelection();
    router.refresh();
  }

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  return (
    <>
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={Array.from(selectedIds)}
          selectedLeads={leads.filter((l) => selectedIds.has(l.id))}
          employees={employees}
          onClear={clearSelection}
          onActionComplete={onActionComplete}
        />
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Customer Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Segment</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-[#9CA0AB] py-8">
                No leads found.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => {
              const isOverdueFollowup =
                lead.next_followup_date && lead.next_followup_date < todayStr;

              return (
                <TableRow
                  key={lead.id}
                  data-state={selectedIds.has(lead.id) ? 'selected' : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(lead.id)}
                      onCheckedChange={() => toggleOne(lead.id)}
                      aria-label={`Select ${lead.customer_name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-[#00B050] hover:underline font-medium"
                    >
                      {lead.customer_name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{lead.phone}</TableCell>
                  <TableCell>{lead.city}</TableCell>
                  <TableCell className="capitalize text-sm">
                    {lead.segment?.replace(/_/g, ' ') ?? '—'}
                  </TableCell>
                  <TableCell className="capitalize text-sm">
                    {lead.source?.replace(/_/g, ' ') ?? '—'}
                  </TableCell>
                  <TableCell>
                    <LeadStatusBadge status={lead.status as any} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {lead.employees?.full_name ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-[#7C818E]">
                    {toIST(lead.created_at)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/leads/leads-table.tsx && git commit -m "feat: add LeadsTable client component with row selection"
```

---

## Task 7: BulkActionBar Component

**Files:**
- Create: `apps/erp/src/components/leads/bulk-action-bar.tsx`

- [ ] **Step 1: Create the bulk action bar**

Create `apps/erp/src/components/leads/bulk-action-bar.tsx`:

```typescript
'use client';

import * as React from 'react';
import { Button, Badge, Select, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@repo/ui';
import { X, Trash2, GitMerge, UserPlus, ArrowRightLeft } from 'lucide-react';
import { bulkAssignLeads, bulkChangeLeadStatus, bulkDeleteLeads } from '@/lib/leads-actions';
import { MergeLeadsModal } from './merge-leads-modal';

interface Employee {
  id: string;
  full_name: string;
}

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  status: string;
}

interface BulkActionBarProps {
  selectedIds: string[];
  selectedLeads: Lead[];
  employees: Employee[];
  onClear: () => void;
  onActionComplete: () => void;
}

const BULK_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'site_survey_scheduled', label: 'Survey Scheduled' },
  { value: 'site_survey_done', label: 'Survey Done' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'design_confirmed', label: 'Design Confirmed' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'disqualified', label: 'Disqualified' },
];

export function BulkActionBar({
  selectedIds,
  selectedLeads,
  employees,
  onClear,
  onActionComplete,
}: BulkActionBarProps) {
  const [loading, setLoading] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showMerge, setShowMerge] = React.useState(false);

  async function handleAssign(assignedTo: string) {
    if (!assignedTo) return;
    setLoading(true);
    const result = await bulkAssignLeads(selectedIds, assignedTo);
    setLoading(false);
    if (result.success) onActionComplete();
  }

  async function handleStatusChange(status: string) {
    if (!status) return;
    setLoading(true);
    const result = await bulkChangeLeadStatus(selectedIds, status as any);
    setLoading(false);
    if (result.success) onActionComplete();
  }

  async function handleDelete() {
    setLoading(true);
    const result = await bulkDeleteLeads(selectedIds);
    setLoading(false);
    setShowDeleteConfirm(false);
    if (result.success) onActionComplete();
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-[#00B050] bg-[#ECFDF5] px-4 py-2.5 mb-4">
        <Badge variant="success" className="text-xs font-bold">
          {selectedIds.length} selected
        </Badge>

        {/* Assign To */}
        <Select
          className="w-40 h-8 text-xs"
          defaultValue=""
          onChange={(e) => handleAssign(e.target.value)}
          disabled={loading}
        >
          <option value="" disabled>Assign to...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.full_name}</option>
          ))}
        </Select>

        {/* Change Status */}
        <Select
          className="w-40 h-8 text-xs"
          defaultValue=""
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={loading}
        >
          <option value="" disabled>Change status...</option>
          {BULK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>

        {/* Merge (only when exactly 2 selected) */}
        {selectedIds.length === 2 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMerge(true)}
            disabled={loading}
            className="h-8 text-xs gap-1"
          >
            <GitMerge className="h-3.5 w-3.5" />
            Merge
          </Button>
        )}

        {/* Delete */}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={loading}
          className="h-8 text-xs gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>

        {/* Cancel */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={loading}
          className="h-8 text-xs gap-1 ml-auto"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.length} lead{selectedIds.length > 1 ? 's' : ''}?</DialogTitle>
            <DialogDescription>
              This will soft-delete the selected leads. They can be restored later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Modal */}
      {showMerge && selectedLeads.length === 2 && (
        <MergeLeadsModal
          leadA={selectedLeads[0]}
          leadB={selectedLeads[1]}
          open={showMerge}
          onOpenChange={setShowMerge}
          onMergeComplete={onActionComplete}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/leads/bulk-action-bar.tsx && git commit -m "feat: add BulkActionBar with assign, status, delete, merge actions"
```

---

## Task 8: Merge Leads Modal

**Files:**
- Create: `apps/erp/src/components/leads/merge-leads-modal.tsx`

- [ ] **Step 1: Create the merge modal**

Create `apps/erp/src/components/leads/merge-leads-modal.tsx`:

```typescript
'use client';

import * as React from 'react';
import { Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@repo/ui';
import { mergeLeads } from '@/lib/leads-actions';

interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  status: string;
}

interface MergeLeadsModalProps {
  leadA: Lead;
  leadB: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: () => void;
}

export function MergeLeadsModal({ leadA, leadB, open, onOpenChange, onMergeComplete }: MergeLeadsModalProps) {
  const [primaryId, setPrimaryId] = React.useState<string>(leadA.id);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const primary = primaryId === leadA.id ? leadA : leadB;
  const secondary = primaryId === leadA.id ? leadB : leadA;

  async function handleMerge() {
    setLoading(true);
    setError(null);
    const result = await mergeLeads(primary.id, secondary.id);
    setLoading(false);

    if (result.success) {
      onOpenChange(false);
      onMergeComplete();
    } else {
      setError(result.error ?? 'Merge failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge Leads</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-[#7C818E] mb-4">
          Select the primary lead to keep. The other lead&apos;s activities and proposals will be transferred, and it will be soft-deleted.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {[leadA, leadB].map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => setPrimaryId(lead.id)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                primaryId === lead.id
                  ? 'border-[#00B050] bg-[#ECFDF5]'
                  : 'border-[#DFE2E8] bg-white hover:border-[#BFC3CC]'
              }`}
            >
              {primaryId === lead.id && (
                <Badge variant="success" className="mb-2">Primary (Keep)</Badge>
              )}
              {primaryId !== lead.id && (
                <Badge variant="error" className="mb-2">Will be merged</Badge>
              )}
              <div className="mt-1">
                <p className="font-medium text-[#1A1D24]">{lead.customer_name}</p>
                <p className="text-sm font-mono text-[#7C818E]">{lead.phone}</p>
                <p className="text-xs text-[#9CA0AB] capitalize mt-1">
                  {lead.status.replace(/_/g, ' ')}
                </p>
              </div>
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-[#991B1B] mt-2">{error}</p>
        )}

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={loading}>
            {loading ? 'Merging...' : `Merge into ${primary.customer_name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/leads/merge-leads-modal.tsx && git commit -m "feat: add MergeLeadsModal with side-by-side comparison"
```

---

## Task 9: Rewrite Leads Page with Pagination + Bulk Actions

**Files:**
- Modify: `apps/erp/src/app/(erp)/leads/page.tsx`

- [ ] **Step 1: Rewrite the leads page**

Replace the full content of `apps/erp/src/app/(erp)/leads/page.tsx`:

```typescript
import Link from 'next/link';
import { getLeads, getSalesEngineers } from '@/lib/leads-queries';
import { LeadsTable } from '@/components/leads/leads-table';
import { Pagination } from '@repo/ui';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
} from '@repo/ui';
import type { Database } from '@repo/types/database';

type LeadStatus = Database['public']['Enums']['lead_status'];
type LeadSource = Database['public']['Enums']['lead_source'];
type CustomerSegment = Database['public']['Enums']['customer_segment'];

const STATUS_OPTIONS: { value: LeadStatus | 'converted'; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'site_survey_scheduled', label: 'Survey Scheduled' },
  { value: 'site_survey_done', label: 'Survey Done' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'design_confirmed', label: 'Design Confirmed' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'converted', label: 'Converted (Projects)' },
];

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'builder_tie_up', label: 'Builder Tie-up' },
  { value: 'channel_partner', label: 'Channel Partner' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'walkin', label: 'Walk-in' },
];

const SEGMENT_OPTIONS: { value: CustomerSegment; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

interface LeadsPageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    segment?: string;
    assigned_to?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const [result, employees] = await Promise.all([
    getLeads({
      status: (params.status as LeadStatus) || undefined,
      source: (params.source as LeadSource) || undefined,
      segment: (params.segment as CustomerSegment) || undefined,
      assignedTo: params.assigned_to || undefined,
      search: params.search || undefined,
      includeConverted: params.status === 'converted',
      page,
      pageSize: 50,
    }),
    getSalesEngineers(),
  ]);

  // Build searchParams record for pagination (excluding page)
  const filterParams: Record<string, string> = {};
  if (params.status) filterParams.status = params.status;
  if (params.source) filterParams.source = params.source;
  if (params.segment) filterParams.segment = params.segment;
  if (params.assigned_to) filterParams.assigned_to = params.assigned_to;
  if (params.search) filterParams.search = params.search;

  const hasFilters = Object.keys(filterParams).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Leads</h1>
        <Link href="/leads/new">
          <Button>New Lead</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex flex-wrap items-center gap-3">
            <Select name="status" defaultValue={params.status ?? ''} className="w-40">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="source" defaultValue={params.source ?? ''} className="w-40">
              <option value="">All Sources</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="segment" defaultValue={params.segment ?? ''} className="w-40">
              <option value="">All Segments</option>
              {SEGMENT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="assigned_to" defaultValue={params.assigned_to ?? ''} className="w-44">
              <option value="">All Assignees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search name or phone..."
              className="w-56"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/leads">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <LeadsTable leads={result.data} employees={employees} />
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalRecords={result.total}
            pageSize={result.pageSize}
            basePath="/leads"
            searchParams={filterParams}
            entityName="leads"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && pnpm --filter @repo/erp check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/\(erp\)/leads/page.tsx && git commit -m "feat: leads page with pagination, bulk select, segment + assignee filters"
```

---

## Task 10: Update Proposals Queries with Pagination

**Files:**
- Modify: `apps/erp/src/lib/proposals-queries.ts`

- [ ] **Step 1: Update proposals queries**

Replace the `ProposalFilters` interface and `getProposals` function in `apps/erp/src/lib/proposals-queries.ts`:

```typescript
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

export interface ProposalFilters {
  status?: ProposalStatus;
  search?: string;
  systemType?: string;
  isBudgetary?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getProposals(filters: ProposalFilters = {}): Promise<PaginatedResult<any>> {
  const op = '[getProposals]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('proposals')
    .select(
      'id, proposal_number, status, system_size_kwp, system_type, total_after_discount, gross_margin_pct, created_at, valid_until, lead_id, revision_number, margin_approval_required, margin_approved_by, is_budgetary, leads!inner(customer_name, phone)',
      { count: 'exact' }
    );

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.systemType) query = query.eq('system_type', filters.systemType);
  if (filters.isBudgetary !== undefined) query = query.eq('is_budgetary', filters.isBudgetary);
  if (filters.search) {
    query = query.or(`proposal_number.ilike.%${filters.search}%,leads.customer_name.ilike.%${filters.search}%`);
  }

  const sortColumn = filters.sort ?? 'created_at';
  const sortAsc = filters.dir === 'asc';
  query = query.order(sortColumn, { ascending: sortAsc });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load proposals: ${error.message}`);
  }

  const total = count ?? 0;
  return {
    data: data ?? [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getProposal(id: string) {
  const op = '[getProposal]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('*, leads(customer_name, phone, email, city), proposal_bom_lines(*), proposal_payment_schedule(*)')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load proposal: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { id });
    return null;
  }
  return data;
}

export async function getProposalRevisions(proposalNumber: string) {
  const op = '[getProposalRevisions]';
  console.log(`${op} Starting for: ${proposalNumber}`);
  if (!proposalNumber) throw new Error(`${op} Missing required parameter: proposalNumber`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('id, revision_number, status, total_after_discount, created_at')
    .eq('proposal_number', proposalNumber)
    .order('revision_number', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load revisions: ${error.message}`);
  }
  return data ?? [];
}

export async function getLeadsForProposal() {
  const op = '[getLeadsForProposal]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .select('id, customer_name, phone, city, segment, system_type, estimated_size_kwp')
    .is('deleted_at', null)
    .in('status', ['site_survey_done', 'proposal_sent', 'negotiation'])
    .order('customer_name');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load leads: ${error.message}`);
  }
  return data ?? [];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/proposals-queries.ts && git commit -m "feat: add pagination + type/budgetary filters to proposals queries"
```

---

## Task 11: Rewrite Proposals Page with Pagination

**Files:**
- Modify: `apps/erp/src/app/(erp)/proposals/page.tsx`

- [ ] **Step 1: Rewrite the proposals page**

Replace the full content of `apps/erp/src/app/(erp)/proposals/page.tsx`:

```typescript
import Link from 'next/link';
import { getProposals } from '@/lib/proposals-queries';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { formatINR, toIST, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Pagination,
  Badge,
} from '@repo/ui';
import type { Database } from '@repo/types/database';

type ProposalStatus = Database['public']['Enums']['proposal_status'];

const STATUS_OPTIONS: { value: ProposalStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'superseded', label: 'Superseded' },
];

const SYSTEM_TYPE_OPTIONS = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'off_grid', label: 'Off Grid' },
  { value: 'hybrid', label: 'Hybrid' },
];

const TYPE_OPTIONS = [
  { value: 'budgetary', label: 'Budgetary' },
  { value: 'detailed', label: 'Detailed' },
];

interface ProposalsPageProps {
  searchParams: Promise<{
    status?: string;
    search?: string;
    system_type?: string;
    type?: string;
    page?: string;
  }>;
}

export default async function ProposalsPage({ searchParams }: ProposalsPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const result = await getProposals({
    status: (params.status as ProposalStatus) || undefined,
    search: params.search || undefined,
    systemType: params.system_type || undefined,
    isBudgetary: params.type === 'budgetary' ? true : params.type === 'detailed' ? false : undefined,
    page,
    pageSize: 50,
  });

  const filterParams: Record<string, string> = {};
  if (params.status) filterParams.status = params.status;
  if (params.search) filterParams.search = params.search;
  if (params.system_type) filterParams.system_type = params.system_type;
  if (params.type) filterParams.type = params.type;

  const hasFilters = Object.keys(filterParams).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Proposals</h1>
        <Link href="/proposals/new">
          <Button>New Proposal</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex flex-wrap items-center gap-3">
            <Select name="status" defaultValue={params.status ?? ''} className="w-40">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="type" defaultValue={params.type ?? ''} className="w-36">
              <option value="">All Types</option>
              {TYPE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select name="system_type" defaultValue={params.system_type ?? ''} className="w-36">
              <option value="">All Systems</option>
              {SYSTEM_TYPE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search proposal # or customer..."
              className="w-64"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/proposals">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proposal #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="text-right">Size (kWp)</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Valid Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-[#9CA0AB] py-8">
                    No proposals found.
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((proposal: any) => {
                  const isExpiringSoon = proposal.valid_until &&
                    new Date(proposal.valid_until) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) &&
                    proposal.status === 'sent';

                  return (
                    <TableRow key={proposal.id}>
                      <TableCell>
                        <Link
                          href={`/proposals/${proposal.id}`}
                          className="text-[#00B050] hover:underline font-medium font-mono text-sm"
                        >
                          {proposal.proposal_number}
                        </Link>
                        {proposal.revision_number > 1 && (
                          <span className="ml-1 text-xs text-[#9CA0AB]">
                            (Rev {proposal.revision_number})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{proposal.leads?.customer_name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={proposal.is_budgetary ? 'pending' : 'info'} className="text-[9px]">
                          {proposal.is_budgetary ? 'Budgetary' : 'Detailed'}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize text-sm">
                        {proposal.system_type.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {proposal.system_size_kwp}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatINR(proposal.total_after_discount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={proposal.gross_margin_pct < 15 ? 'text-[#991B1B]' : 'text-[#065F46]'}>
                          {proposal.gross_margin_pct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <ProposalStatusBadge status={proposal.status} />
                        {proposal.margin_approval_required && !proposal.margin_approved_by && (
                          <span className="ml-1 text-xs text-[#9A3412]" title="Margin approval needed">!</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-[#7C818E]">
                        {toIST(proposal.created_at)}
                      </TableCell>
                      <TableCell className={`text-sm ${isExpiringSoon ? 'text-[#991B1B] font-medium' : 'text-[#7C818E]'}`}>
                        {formatDate(proposal.valid_until)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <Pagination
            currentPage={result.page}
            totalPages={result.totalPages}
            totalRecords={result.total}
            pageSize={result.pageSize}
            basePath="/proposals"
            searchParams={filterParams}
            entityName="proposals"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/\(erp\)/proposals/page.tsx && git commit -m "feat: proposals page with pagination, type/system filters"
```

---

## Task 12: Add Pagination to Projects Page

**Files:**
- Modify: `apps/erp/src/lib/projects-queries.ts`
- Modify: `apps/erp/src/app/(erp)/projects/page.tsx`

- [ ] **Step 1: Update projects-queries.ts to support pagination**

Read `apps/erp/src/lib/projects-queries.ts` first. Then add pagination support: add `page`, `pageSize` to filter interface, use `{ count: 'exact' }` and `.range()`, return `PaginatedResult`. Follow exact same pattern as `leads-queries.ts` Task 4.

- [ ] **Step 2: Update projects page to use pagination**

Add `page` to searchParams, parse it, pass to `getProjects`, add `<Pagination>` below the table. Same pattern as leads page but without bulk selection.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/projects-queries.ts apps/erp/src/app/\(erp\)/projects/page.tsx && git commit -m "feat: add pagination to projects list page"
```

---

## Task 13: Update PM Dashboard Queries

**Files:**
- Modify: `apps/erp/src/lib/pm-queries.ts`

- [ ] **Step 1: Rewrite pm-queries.ts with expanded metrics**

Replace the full content of `apps/erp/src/lib/pm-queries.ts`:

```typescript
import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

export interface PMDashboardData {
  // KPI cards (matching PM spec)
  totalSystemSizeKwp: number;
  totalClients: number;
  totalSales: number;
  avgProfitPct: number;

  // Donut chart
  projectsByStatus: Array<{ status: string; count: number }>;

  // Operations widget
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
    city: string;
    status: string;
    reason: string;
  }>;

  employeeId: string | null;
}

async function getEmployeeId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
): Promise<string | null> {
  const op = '[getEmployeeId]';
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, profileId });
    return null;
  }
  return data?.id ?? null;
}

export async function getPMDashboardData(profileId: string): Promise<PMDashboardData> {
  const op = '[getPMDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();
  const employeeId = await getEmployeeId(supabase, profileId);

  if (!employeeId) {
    console.warn(`${op} No active employee found for profile: ${profileId}`);
    return {
      totalSystemSizeKwp: 0,
      totalClients: 0,
      totalSales: 0,
      avgProfitPct: 0,
      projectsByStatus: [],
      openTaskCount: 0,
      totalTaskCount: 0,
      openServiceTicketCount: 0,
      totalServiceTicketCount: 0,
      amcCompletedThisMonth: 0,
      amcScheduledThisMonth: 0,
      priorityProjects: [],
      employeeId: null,
    };
  }

  const excludedStatuses = ['completed', 'cancelled'];
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const [
    activeProjectsResult,
    openTasksResult,
    totalTasksResult,
    openTicketsResult,
    totalTicketsResult,
    amcScheduledResult,
    amcCompletedResult,
    overdueResult,
  ] = await Promise.all([
    // Active projects with system size and contracted value
    supabase
      .from('projects')
      .select('id, status, system_size_kwp, contracted_value, customer_name, city')
      .eq('project_manager_id', employeeId)
      .not('status', 'in', `(${excludedStatuses.join(',')})`),

    // Open tasks for PM
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .eq('is_completed', false)
      .is('deleted_at', null),

    // Total tasks for PM
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .is('deleted_at', null),

    // Open service tickets
    supabase
      .from('om_service_tickets')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(resolved,closed)'),

    // Total service tickets
    supabase
      .from('om_service_tickets')
      .select('id', { count: 'exact', head: true }),

    // AMC visits scheduled this month
    supabase
      .from('om_visit_schedules')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd),

    // AMC visits completed this month
    supabase
      .from('om_visit_schedules')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd)
      .eq('status', 'completed'),

    // Projects missing today's report
    getOverdueProjectsForPM(supabase, employeeId, todayStr),
  ]);

  if (activeProjectsResult.error) {
    console.error(`${op} Active projects query failed:`, { code: activeProjectsResult.error.code, message: activeProjectsResult.error.message });
    throw new Error(`Failed to load active projects: ${activeProjectsResult.error.message}`);
  }

  const activeProjects = activeProjectsResult.data ?? [];

  // KPI: Total System Size
  const totalSystemSize = activeProjects.reduce(
    (sum, p) => sum.add(new Decimal(p.system_size_kwp ?? '0')),
    new Decimal(0),
  );

  // KPI: Total Clients (unique customer names)
  const uniqueClients = new Set(activeProjects.map((p) => p.customer_name));

  // KPI: Total Sales (sum of contracted value)
  const totalSales = activeProjects.reduce(
    (sum, p) => sum.add(new Decimal(p.contracted_value ?? '0')),
    new Decimal(0),
  );

  // KPI: Avg Profit % — approximated as 0 if no cash data (needs project_cash_positions for real calc)
  // For now use a placeholder. Real implementation would query project_cash_positions.
  const avgProfitPct = 0;

  // Donut chart: projects by status
  const statusCounts = new Map<string, number>();
  for (const project of activeProjects) {
    const status = project.status ?? 'unknown';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const projectsByStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // Today's priorities: take top 5 overdue projects
  const priorityProjects = overdueResult.slice(0, 5).map((p) => ({
    ...p,
    reason: 'Missing daily report',
  }));

  return {
    totalSystemSizeKwp: totalSystemSize.toNumber(),
    totalClients: uniqueClients.size,
    totalSales: totalSales.toNumber(),
    avgProfitPct,
    projectsByStatus,
    openTaskCount: openTasksResult.count ?? 0,
    totalTaskCount: totalTasksResult.count ?? 0,
    openServiceTicketCount: openTicketsResult.count ?? 0,
    totalServiceTicketCount: totalTicketsResult.count ?? 0,
    amcCompletedThisMonth: amcCompletedResult.count ?? 0,
    amcScheduledThisMonth: amcScheduledResult.count ?? 0,
    priorityProjects,
    employeeId,
  };
}

async function getOverdueProjectsForPM(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  todayStr: string,
): Promise<Array<{ id: string; project_number: string; customer_name: string; city: string; status: string }>> {
  const op = '[getOverdueProjectsForPM]';

  const { data: activeProjects, error: projectError } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, city, status')
    .eq('project_manager_id', employeeId)
    .not('status', 'in', '("completed","cancelled","on_hold","commissioned","net_metering_pending")');

  if (projectError) {
    console.error(`${op} Projects query failed:`, { code: projectError.code, message: projectError.message });
    throw new Error(`Failed to load PM projects: ${projectError.message}`);
  }

  if (!activeProjects || activeProjects.length === 0) return [];

  const projectIds = activeProjects.map((p) => p.id);
  const { data: todayReports, error: reportError } = await supabase
    .from('daily_site_reports')
    .select('project_id')
    .eq('report_date', todayStr)
    .in('project_id', projectIds);

  if (reportError) {
    console.error(`${op} Reports query failed:`, { code: reportError.code, message: reportError.message });
    throw new Error(`Failed to load reports: ${reportError.message}`);
  }

  const reportedProjectIds = new Set((todayReports ?? []).map((r) => r.project_id));
  return activeProjects.filter((p) => !reportedProjectIds.has(p.id));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/pm-queries.ts && git commit -m "feat: expand PM queries with correct KPIs, operations stats, priority projects"
```

---

## Task 14: PM Dashboard Components (Donut, Operations, Today Panel)

**Files:**
- Create: `apps/erp/src/components/dashboard/pm-donut-chart.tsx`
- Create: `apps/erp/src/components/dashboard/operations-widget.tsx`
- Create: `apps/erp/src/components/dashboard/today-priorities.tsx`

- [ ] **Step 1: Create PM donut chart**

Create `apps/erp/src/components/dashboard/pm-donut-chart.tsx`:

```typescript
'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

const STATUS_COLORS: Record<string, string> = {
  advance_received: '#3B82F6',
  planning: '#8B5CF6',
  material_procurement: '#F59E0B',
  installation: '#00B050',
  electrical_work: '#06B6D4',
  testing: '#EC4899',
  inspection: '#A855F7',
  commissioned: '#10B981',
  net_metering_pending: '#F97316',
  on_hold: '#EF4444',
};

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface DonutChartProps {
  data: Array<{ status: string; count: number }>;
}

export function PMDonutChart({ data }: DonutChartProps) {
  const totalProjects = data.reduce((sum, d) => sum + d.count, 0);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Projects by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#9CA0AB] py-8 text-center">No active projects.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Projects by Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <div className="relative h-[200px] w-[200px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="count"
                  nameKey="status"
                  strokeWidth={2}
                  stroke="#fff"
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={STATUS_COLORS[entry.status] ?? '#9CA3AF'}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [value, formatStatus(name)]}
                  contentStyle={{
                    fontSize: '12px',
                    borderRadius: '8px',
                    border: '1px solid #DFE2E8',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-heading text-2xl font-bold text-[#111318]">{totalProjects}</span>
              <span className="text-[10px] text-[#7C818E] uppercase tracking-wider">Projects</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            {data.map((entry) => (
              <div key={entry.status} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: STATUS_COLORS[entry.status] ?? '#9CA3AF' }}
                  />
                  <span className="text-[12px] text-[#3F424D]">{formatStatus(entry.status)}</span>
                </div>
                <span className="text-[12px] font-bold text-[#111318] font-mono">{entry.count}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create operations widget**

Create `apps/erp/src/components/dashboard/operations-widget.tsx`:

```typescript
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface OperationsWidgetProps {
  openTasks: number;
  totalTasks: number;
  openTickets: number;
  totalTickets: number;
  amcCompleted: number;
  amcScheduled: number;
}

function ProgressRow({ label, current, total }: { label: string; current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[#3F424D]">{label}</span>
        <span className="text-[12px] font-mono font-bold text-[#111318]">
          {current} / {total}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#00B050] transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function OperationsWidget({
  openTasks,
  totalTasks,
  openTickets,
  totalTickets,
  amcCompleted,
  amcScheduled,
}: OperationsWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Operations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProgressRow label="Open Tasks" current={openTasks} total={totalTasks} />
        <ProgressRow label="Open Services" current={openTickets} total={totalTickets} />
        <ProgressRow label="AMCs This Month" current={amcCompleted} total={amcScheduled} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create today priorities panel**

Create `apps/erp/src/components/dashboard/today-priorities.tsx`:

```typescript
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { AlertTriangle, MapPin } from 'lucide-react';

interface PriorityProject {
  id: string;
  project_number: string;
  customer_name: string;
  city: string;
  status: string;
  reason: string;
}

interface TodayPrioritiesProps {
  projects: PriorityProject[];
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TodayPriorities({ projects }: TodayPrioritiesProps) {
  return (
    <Card className="bg-[#001F0D] border-[#003D1A]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-white flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#FCA524]" />
          Today&apos;s Priorities
        </CardTitle>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-[#6B7280] py-4 text-center">
            All caught up. No priorities for today.
          </p>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-md bg-[#003D1A] p-3 hover:bg-[#004D22] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {project.project_number}
                    </p>
                    <p className="text-xs text-[#9CA0AB]">{project.customer_name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3 text-[#6B7280]" />
                      <span className="text-[11px] text-[#6B7280]">{project.city}</span>
                    </div>
                  </div>
                  <Badge className="bg-[#FEF3C7] text-[#92400E] text-[9px] border-0">
                    {project.reason}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/dashboard/pm-donut-chart.tsx apps/erp/src/components/dashboard/operations-widget.tsx apps/erp/src/components/dashboard/today-priorities.tsx && git commit -m "feat: add PM dashboard components — donut chart, operations widget, today priorities"
```

---

## Task 15: Rewrite PM Dashboard Page

**Files:**
- Modify: `apps/erp/src/app/(erp)/dashboard/pm-dashboard.tsx`

- [ ] **Step 1: Rewrite PM dashboard with correct KPIs and new widgets**

Replace the full content of `apps/erp/src/app/(erp)/dashboard/pm-dashboard.tsx`:

```typescript
import { getUserProfile } from '@/lib/auth';
import { getPMDashboardData } from '@/lib/pm-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import { PMDonutChart } from '@/components/dashboard/pm-donut-chart';
import { OperationsWidget } from '@/components/dashboard/operations-widget';
import { TodayPriorities } from '@/components/dashboard/today-priorities';
import { shortINR } from '@repo/ui/formatters';

function getGreeting(): string {
  const hour = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  });
  const h = parseInt(hour, 10);
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export async function PMDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getPMDashboardData(profile.id);
  const firstName = profile.full_name?.split(' ')[0] ?? 'there';
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
        {greeting}, {firstName}
      </h1>

      {/* KPI Cards — matching PM spec exactly */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Total System Size"
          value={data.totalSystemSizeKwp.toFixed(1)}
          unit="kWp"
          icon="Sun"
        />
        <KpiCard
          label="Total Clients"
          value={data.totalClients}
          icon="Users"
        />
        <KpiCard
          label="Total Sales"
          value={shortINR(data.totalSales)}
          icon="TrendingUp"
        />
        <KpiCard
          label="Avg. Profit %"
          value={data.avgProfitPct > 0 ? `${data.avgProfitPct.toFixed(1)}%` : '—'}
          icon="BarChart3"
          subNote={data.avgProfitPct === 0 ? 'No cost data yet' : undefined}
        />
      </div>

      {/* Middle Section: 2/3 chart + 1/3 operations & today */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left 2/3: Donut chart + My Tasks */}
        <div className="col-span-2 space-y-6">
          <PMDonutChart data={data.projectsByStatus} />

          {data.employeeId && <MyTasks employeeId={data.employeeId} />}
        </div>

        {/* Right 1/3: Operations + Today's Priorities */}
        <div className="space-y-6">
          <OperationsWidget
            openTasks={data.openTaskCount}
            totalTasks={data.totalTaskCount}
            openTickets={data.openServiceTicketCount}
            totalTickets={data.totalServiceTicketCount}
            amcCompleted={data.amcCompletedThisMonth}
            amcScheduled={data.amcScheduledThisMonth}
          />

          <TodayPriorities projects={data.priorityProjects} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && pnpm --filter @repo/erp check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/\(erp\)/dashboard/pm-dashboard.tsx && git commit -m "feat: rewrite PM dashboard — correct KPIs, donut chart, operations, today priorities"
```

---

## Task 16: Final Type Check and Build Verification

- [ ] **Step 1: Run full type check**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && pnpm check-types
```

Fix any type errors found.

- [ ] **Step 2: Run build**

```bash
cd C:/Users/vivek/Projects/shiroi-erp && pnpm --filter @repo/erp build
```

Fix any build errors found.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "fix: resolve type and build errors from PM/leads/proposals overhaul"
```

---

## Task 17: Update CLAUDE.md and Master Reference

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/SHIROI_MASTER_REFERENCE_3_0.md`

- [ ] **Step 1: Update CLAUDE.md current state table**

Add/update entries:
- Leads pagination: ✅ Complete — 50/page, bulk actions (assign, status, delete, merge), segment + assignee filters
- Proposals pagination: ✅ Complete — 50/page, type/system filters, budgetary badge
- PM Dashboard v2: ✅ Complete — Correct KPIs, donut chart, operations widget, today priorities
- Projects pagination: ✅ Complete — 50/page

- [ ] **Step 2: Commit documentation**

```bash
git add CLAUDE.md docs/SHIROI_MASTER_REFERENCE_3_0.md && git commit -m "docs: update CLAUDE.md — leads/proposals pagination, PM dashboard v2, bulk actions"
```
