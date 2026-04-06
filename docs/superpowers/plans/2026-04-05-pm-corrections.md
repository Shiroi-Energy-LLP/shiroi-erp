# PM Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all corrections from PM Manivel Muthu's feedback document — fix the projects table default columns, add missing sidebar items (liaison, daily reports links), add creation forms for tasks/service tickets/AMC, and add Remarks + Year columns to the projects DataTable.

**Architecture:** All changes are incremental to the existing Next.js + Supabase + DataTable architecture. No new database tables needed — all tables already exist. Changes are UI-layer: column config, default visibility, sidebar items, and lightweight creation forms using existing server actions patterns.

**Tech Stack:** Next.js 14 App Router, Supabase RLS, shadcn/ui, DataTable component, server actions

---

## Summary of Changes (6 Tasks)

| Task | Description | Impact |
|------|-------------|--------|
| 1 | Fix Projects DataTable default columns per PM spec | Projects page |
| 2 | Add Remarks + Year columns to projects | DB + column config |
| 3 | Add Liaison to PM sidebar | Sidebar nav |
| 4 | Add "Create Task" form on /tasks page | Tasks page |
| 5 | Add "Create Service Ticket" form on /om/tickets | Service tickets page |
| 6 | Add "Create AMC Schedule" flow post-commissioning | AMC page |

---

### Task 1: Fix Projects DataTable Default Column Visibility

PM wants the main projects table to show: Project #, Customer Name, Location (City), System Size, Status, Year, Remarks. He explicitly does NOT want Contracted Value or PM Name in the default view.

**Files:**
- Modify: `apps/erp/src/components/data-table/column-config.ts` (PROJECT_COLUMNS)

- [ ] **Step 1: Update PROJECT_COLUMNS default visibility**

In `column-config.ts`, change the PROJECT_COLUMNS array:
- `contracted_value`: set `defaultVisible: false`
- `project_manager_name`: set `defaultVisible: false`
- `site_city`: keep `defaultVisible: true` (already is)
- `system_type`: set `defaultVisible: false` (PM didn't list it)
- `created_at`: set `defaultVisible: true` (PM wants "Year" — this is the closest; we'll add a dedicated year column in Task 2)

- [ ] **Step 2: Verify build passes**

Run: `pnpm --filter @repo/erp build`

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/data-table/column-config.ts
git commit -m "fix: update projects default columns per PM feedback"
```

---

### Task 2: Add Remarks + Year Columns to Projects

PM wants "Year" and "Remarks" visible in the main projects table. The `projects` table doesn't have a `remarks` column — it has `notes`. We'll map `notes` as "Remarks" in the column config. For Year, we'll derive it from `created_at` in the query.

**Files:**
- Modify: `apps/erp/src/components/data-table/column-config.ts` (add remarks + year to PROJECT_COLUMNS)
- Modify: `apps/erp/src/lib/projects-queries.ts` (add `notes` to SELECT, derive year)
- Modify: `apps/erp/src/app/(erp)/projects/page.tsx` (map notes → remarks, derive year in flatData)

- [ ] **Step 1: Add `notes` to projects query SELECT**

In `projects-queries.ts`, add `notes` to the select string.

- [ ] **Step 2: Add remarks + year columns to PROJECT_COLUMNS**

In `column-config.ts`, add after `customer_phone`:
```typescript
{ key: 'year', label: 'Year', defaultVisible: true, sortable: true, sortKey: 'created_at', editable: false, fieldType: 'text' },
{ key: 'remarks', label: 'Remarks', defaultVisible: true, sortable: false, editable: true, fieldType: 'text' },
```

- [ ] **Step 3: Derive year + remarks in projects page flatData**

In `projects/page.tsx`, add to the flatData map:
```typescript
year: new Date(p.created_at).getFullYear().toString(),
remarks: p.notes ?? '',
```

- [ ] **Step 4: Verify build, commit**

---

### Task 3: Add Liaison + Net Metering to PM Sidebar

PM requests liaisoning access. Currently only sales_engineer has it. Add to PM nav.

**Files:**
- Modify: `apps/erp/src/lib/roles.ts` (add liaison items to project_manager nav)

- [ ] **Step 1: Add liaison section to PM nav**

In `roles.ts`, add to the `project_manager` sections array:
```typescript
{ label: 'Liaison', items: [ITEMS.netMetering] },
```

Also add `ITEMS.myReports` and `ITEMS.myTasks` to the PM nav if not already there (PM should see "My Reports" and "My Tasks" like site supervisor does).

- [ ] **Step 2: Verify build, commit**

---

### Task 4: Add "Create Task" Button + Dialog on /tasks

PM says task creation is "currently missing." The tasks page is read-only. Add a creation dialog.

**Files:**
- Create: `apps/erp/src/components/tasks/create-task-dialog.tsx`
- Create: `apps/erp/src/lib/tasks-actions.ts` (server action)
- Modify: `apps/erp/src/app/(erp)/tasks/page.tsx` (add button + dialog)

- [ ] **Step 1: Create server action for task creation**

Create `tasks-actions.ts` with a `createTask` server action that inserts into the `tasks` table (entity_type + entity_id pattern).

- [ ] **Step 2: Create task dialog component**

Create `create-task-dialog.tsx` — a Dialog with form fields: title, description, entity_type (select: project/lead/om_ticket), entity_id (text), priority (select), due_date, assigned_to (employee dropdown).

- [ ] **Step 3: Add "New Task" button to tasks page**

Wrap the page header with a client component that shows the button and dialog.

- [ ] **Step 4: Verify build, commit**

---

### Task 5: Add "Create Service Ticket" on /om/tickets

Similar to tasks — the page is read-only. Add creation flow.

**Files:**
- Create: `apps/erp/src/components/om/create-ticket-dialog.tsx`
- Create: `apps/erp/src/lib/service-ticket-actions.ts` (server action)
- Modify: `apps/erp/src/app/(erp)/om/tickets/page.tsx` (add button)

- [ ] **Step 1: Create server action for ticket creation**

Insert into `om_service_tickets` table with required fields: project_id, title, description, issue_type, severity, assigned_to.

- [ ] **Step 2: Create ticket dialog component**

Dialog with: project (dropdown), title, description, issue_type (select from enum), severity (select), assigned_to (employee dropdown).

- [ ] **Step 3: Add "New Ticket" button to tickets page**

- [ ] **Step 4: Verify build, commit**

---

### Task 6: Add "Create AMC Schedule" Post-Commissioning

PM wants to select 3 service dates at 4-month intervals after commissioning.

**Files:**
- Create: `apps/erp/src/components/om/create-amc-dialog.tsx`
- Create: `apps/erp/src/lib/amc-actions.ts` (server action)
- Modify: `apps/erp/src/app/(erp)/om/amc/page.tsx` (add button)

- [ ] **Step 1: Create server action for AMC schedule creation**

Creates an `om_contracts` record (contract_type: 'warranty_period') and 3 `om_visit_schedules` entries at 4-month intervals from commissioning date.

- [ ] **Step 2: Create AMC dialog component**

Dialog with: project (dropdown — only commissioned projects), commissioning_date (auto-filled), 3 visit dates (auto-calculated at 4-month intervals, editable).

- [ ] **Step 3: Add "Create AMC" button to AMC page**

- [ ] **Step 4: Verify build, commit**

---

## Applicability to Rest of ERP

Several PM requests improve the entire ERP:
1. **Column visibility defaults** — review all entity DataTables for sensible defaults
2. **Creation forms** — all list pages should have "New" buttons where the user has write access
3. **Remarks/Notes columns** — consider adding to leads and proposals DataTables too
4. **Sidebar completeness** — each role should have access to all pages they need

## Post-Implementation

After all tasks:
- [ ] Update CLAUDE.md current state table
- [ ] Update SHIROI_MASTER_REFERENCE_3_0.md
- [ ] Push to main for Vercel deployment
