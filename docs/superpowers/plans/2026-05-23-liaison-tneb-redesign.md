# Liaison TNEB Stages Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `discom_status` values to match official TNEB stage vocabulary, add an "awaiting client" blocking flag, move `ceig_scope` to the projects table, and replace the two-page liaison navigation with a single unified `/liaison` page (5 clickable cards + polished table).

**Architecture:** Migration 114 renames DB values and adds new columns. All TS files referencing old status strings are updated in the same pass. The unified `/liaison` page uses a new `get_liaison_summary()` SQL RPC for card counts and reads a `?filter=` URL param to pre-filter the table. The per-project detail route `/liaison/net-metering/[projectId]` is unchanged.

**Tech Stack:** Next.js 14 App Router, Supabase PostgreSQL, TypeScript, shadcn/ui (`@repo/ui`), `@repo/supabase/server` client. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-23-liaison-tneb-redesign-design.md`

**CI gate (run after each task):** `pnpm check-types`
**Full CI (run at the end):** `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/114_liaison_tneb_stages.sql` | Create | All DB changes + RPC |
| `packages/types/database.ts` | Regenerate | Auto-generated types from schema |
| `apps/erp/src/components/liaison/liaison-status-badge.tsx` | Create | TNEB + CEIG status badge components |
| `apps/erp/src/components/liaison/awaiting-client-toggle.tsx` | Create | Button to mark/clear awaiting-client flag |
| `apps/erp/src/lib/liaison-summary-queries.ts` | Create | `getLiaisonSummary()` RPC call + card counts |
| `apps/erp/src/lib/liaison-actions.ts` | Modify | Rename status values, add `setAwaitingClientDetails`, update `createNetMeteringApplication`, remove `updateCeigScope` |
| `apps/erp/src/lib/liaison-queries.ts` | Modify | Update status strings, add `?filter=` param support |
| `apps/erp/src/components/projects/forms/liaison-form.tsx` | Modify | Update `DISCOM_STATUSES`, remove `CeigScopeToggle`, add `AwaitingClientToggle` |
| `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx` | Modify | Update `deriveWorkflowStages` stage values, remove `CeigScopeToggle` usage |
| `apps/erp/src/components/liaison/net-metering-detail.tsx` | Modify | Update old status string references |
| `apps/erp/src/lib/project-detail-actions.ts` | Modify | Add `ceig_scope` to `EDITABLE_PROJECT_FIELDS` |
| `apps/erp/src/components/projects/detail/system-config-box.tsx` | Modify | Add `ceig_scope` `EditableField` + prop |
| `apps/erp/src/app/(erp)/projects/[id]/page.tsx` | Modify | Pass `ceig_scope` to `SystemConfigBox` |
| `apps/erp/src/app/(erp)/liaison/page.tsx` | Rewrite | Unified summary cards + table |
| `apps/erp/src/app/(erp)/liaison/net-metering/page.tsx` | Rewrite | Redirect to `/liaison` |

---

## Task 1: Migration 114 — DB schema changes + RPC

**Files:**
- Create: `supabase/migrations/114_liaison_tneb_stages.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/114_liaison_tneb_stages.sql` with the following content:

```sql
-- Migration 114: Liaison TNEB stage rename + awaiting-client flag + ceig_scope to projects

-- ── 1. Add ceig_scope to projects ──────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ceig_scope TEXT NOT NULL DEFAULT 'shiroi'
    CHECK (ceig_scope IN ('shiroi', 'client'));

-- Backfill from existing NMAs where the application already set ceig_scope
UPDATE projects p
SET ceig_scope = nma.ceig_scope
FROM net_metering_applications nma
WHERE nma.project_id = p.id
  AND nma.ceig_scope IS NOT NULL
  AND nma.ceig_scope IN ('shiroi', 'client');

-- ── 2. Drop old ceig_scope from net_metering_applications ──────────────────
-- (column moved to projects; no longer needed on the NMA)
ALTER TABLE net_metering_applications
  DROP COLUMN IF EXISTS ceig_scope;

-- ── 3. Rename discom_status CHECK values ───────────────────────────────────
-- Drop the existing CHECK constraint
ALTER TABLE net_metering_applications
  DROP CONSTRAINT IF EXISTS net_metering_applications_discom_status_check;

-- Rename existing rows to new TNEB vocabulary
UPDATE net_metering_applications SET discom_status = 'tneb_verified'
  WHERE discom_status = 'under_review';
UPDATE net_metering_applications SET discom_status = 'tneb_inspected'
  WHERE discom_status = 'site_inspection_scheduled';
UPDATE net_metering_applications SET discom_status = 'tneb_estimated'
  WHERE discom_status = 'approved';
UPDATE net_metering_applications SET discom_status = 'installation_completed'
  WHERE discom_status = 'net_meter_installed';
-- 'activated' never existed in the DB (was a code-only value), no rows to update.

-- Re-add CHECK with new + additional values
ALTER TABLE net_metering_applications
  ADD CONSTRAINT net_metering_applications_discom_status_check
    CHECK (discom_status IN (
      'pending',
      'applied',
      'tneb_verified',
      'tneb_inspected',
      'tneb_estimated',
      'installation_completed',
      'service_effected',
      'rejected',
      'objection_raised'
    ));

-- ── 4. Add awaiting-client columns ─────────────────────────────────────────
ALTER TABLE net_metering_applications
  ADD COLUMN IF NOT EXISTS awaiting_client_details BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS awaiting_client_since   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS awaiting_client_note    TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_nma_awaiting_client
  ON net_metering_applications (awaiting_client_details)
  WHERE awaiting_client_details = TRUE;

-- ── 5. Add get_liaison_summary() RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_liaison_summary()
RETURNS TABLE (
  total            BIGINT,
  awaiting_client  BIGINT,
  ceig_pending     BIGINT,
  ceig_in_process  BIGINT,
  tneb_active      BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT                                                                                AS total,
    COUNT(*) FILTER (WHERE awaiting_client_details = TRUE)::BIGINT                                 AS awaiting_client,
    COUNT(*) FILTER (WHERE ceig_required = TRUE AND ceig_status = 'pending')::BIGINT               AS ceig_pending,
    COUNT(*) FILTER (WHERE ceig_required = TRUE
                       AND ceig_status IN ('applied', 'inspection_scheduled'))::BIGINT             AS ceig_in_process,
    COUNT(*) FILTER (WHERE discom_status IN (
                       'applied', 'tneb_verified', 'tneb_inspected',
                       'tneb_estimated', 'installation_completed'))::BIGINT                        AS tneb_active
  FROM net_metering_applications;
$$;

GRANT EXECUTE ON FUNCTION get_liaison_summary() TO authenticated;
```

- [ ] **Step 2: Apply migration to dev via Supabase MCP**

Use the Supabase MCP tool `mcp__<supabase>__apply_migration` with the dev project id `actqtzoxjilqnldnacqz` and the SQL above.

- [ ] **Step 3: Regenerate `packages/types/database.ts`**

Use `mcp__<supabase>__generate_typescript_types` against project `actqtzoxjilqnldnacqz`. The response is JSON-wrapped — copy the result to `packages/types/database.ts`, then run:

```bash
node -e "const fs=require('fs'); const obj=JSON.parse(fs.readFileSync('packages/types/database.ts','utf8')); fs.writeFileSync('packages/types/database.ts', obj.types);"
node scripts/strip-view-fk-entries.mjs
```

- [ ] **Step 4: Verify types compile**

```bash
pnpm check-types
```

Expected: 0 errors. If errors appear, they will be in files referencing old `discom_status` values — those are fixed in subsequent tasks.

- [ ] **Step 5: Commit migration + types**

```bash
git add supabase/migrations/114_liaison_tneb_stages.sql packages/types/database.ts
git commit -m "feat(liaison): migration 114 — TNEB stage rename + awaiting-client + ceig_scope to projects"
```

---

## Task 2: New `LiaisonStatusBadge` component

**Files:**
- Create: `apps/erp/src/components/liaison/liaison-status-badge.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

// Pill style: matches lead status badges from May 20 spec.
// rounded-full h-5 px-2 text-[10px] font-semibold uppercase tracking-wider

const TNEB_STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:                { bg: '#F1F3F5', text: '#3F424D', label: 'Pending' },
  applied:                { bg: '#EFF6FF', text: '#1E40AF', label: 'Applied' },
  tneb_verified:          { bg: '#E0E7FF', text: '#3730A3', label: 'Verified' },
  tneb_inspected:         { bg: '#EDE9FE', text: '#5B21B6', label: 'Inspected' },
  tneb_estimated:         { bg: '#FEF3C7', text: '#92400E', label: 'Estimated' },
  installation_completed: { bg: '#CCFBF1', text: '#0F766E', label: 'Installation Done' },
  service_effected:       { bg: '#DCFCE7', text: '#166534', label: 'Service Effected' },
  rejected:               { bg: '#FEE2E2', text: '#991B1B', label: 'Rejected' },
  objection_raised:       { bg: '#FFEDD5', text: '#9A3412', label: 'Objection Raised' },
};

const CEIG_STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_applicable:      { bg: '#F1F3F5', text: '#6B7280', label: 'N/A' },
  pending:             { bg: '#FEF3C7', text: '#92400E', label: 'CEIG Pending' },
  applied:             { bg: '#EFF6FF', text: '#1E40AF', label: 'CEIG Applied' },
  inspection_scheduled:{ bg: '#EDE9FE', text: '#5B21B6', label: 'Inspection Sched.' },
  approved:            { bg: '#DCFCE7', text: '#166534', label: 'CEIG Approved' },
  rejected:            { bg: '#FEE2E2', text: '#991B1B', label: 'CEIG Rejected' },
  reapplied:           { bg: '#FFF7ED', text: '#9A3412', label: 'Reapplied' },
};

interface BadgeProps {
  status: string;
  className?: string;
}

export function TnebStageBadge({ status, className = '' }: BadgeProps) {
  const style = TNEB_STAGE_STYLES[status] ?? { bg: '#F1F3F5', text: '#3F424D', label: status.replace(/_/g, ' ') };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider h-5 ${className}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  );
}

export function CeigStageBadge({ status, className = '' }: BadgeProps) {
  const style = CEIG_STAGE_STYLES[status] ?? { bg: '#F1F3F5', text: '#3F424D', label: status.replace(/_/g, ' ') };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider h-5 ${className}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  );
}

export function AwaitingClientBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider h-5 ${className}`}
      style={{ backgroundColor: '#FFF7ED', color: '#9A3412' }}
    >
      Awaiting Client
    </span>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm check-types
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/liaison/liaison-status-badge.tsx
git commit -m "feat(liaison): LiaisonStatusBadge — TNEB/CEIG/awaiting-client pill components"
```

---

## Task 3: Update `liaison-actions.ts`

**Files:**
- Modify: `apps/erp/src/lib/liaison-actions.ts`

Changes needed:
1. `createNetMeteringApplication` — fetch project to auto-set `ceig_required`
2. `updateDiscomStatus` — fix `revalidatePath` to `/liaison`
3. `createObjection` — update hardcoded `objection_raised` reference in update (no change needed — that value is kept)
4. Remove `updateCeigScope` entirely (ceig_scope is now on projects, set via `EditableField`)
5. Add `setAwaitingClientDetails` action
6. Update all `revalidatePath('/liaison/net-metering')` → `revalidatePath('/liaison')`

- [ ] **Step 1: Replace `createNetMeteringApplication` with auto-CEIG logic**

Find this block in `liaison-actions.ts` (lines ~17–48):

```ts
  const { error } = await supabase
    .from('net_metering_applications')
    .insert({
      project_id: input.projectId,
      discom_name: input.discomName || 'TANGEDCO',
      discom_status: 'pending',
      ceig_required: false,
      followup_count: 0,
    } as any);
```

Replace with:

```ts
  // Fetch project to determine CEIG requirement
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('system_size_kwp, system_type, ceig_scope')
    .eq('id', input.projectId)
    .single();

  if (projectError || !project) {
    console.error(`${op} Could not fetch project:`, { error: projectError?.message });
    return { success: false, error: 'Could not load project data.' };
  }

  const ceigRequired =
    (project as any).ceig_scope === 'shiroi' &&
    Number((project as any).system_size_kwp ?? 0) >= 10 &&
    (project as any).system_type !== 'off_grid';

  const { error } = await supabase
    .from('net_metering_applications')
    .insert({
      project_id: input.projectId,
      discom_name: input.discomName || 'TANGEDCO',
      discom_status: 'pending',
      ceig_required: ceigRequired,
      followup_count: 0,
    } as any);
```

- [ ] **Step 2: Replace all `revalidatePath('/liaison/net-metering')` with `revalidatePath('/liaison')`**

There are multiple occurrences. Replace every instance:

```ts
revalidatePath(`/liaison/net-metering`);
```

with:

```ts
revalidatePath('/liaison');
```

- [ ] **Step 3: Remove `updateCeigScope` function**

Delete the entire `updateCeigScope` export (lines ~392–418 in the current file). It will no longer be called — `ceig_scope` is now edited via the project's `EditableField` in `SystemConfigBox`.

- [ ] **Step 4: Add `setAwaitingClientDetails` at the end of the file**

```ts
/**
 * Mark or clear the "awaiting client details" blocking flag on a net metering application.
 * Can be set at any stage — it's orthogonal to the TNEB stage.
 */
export async function setAwaitingClientDetails(input: {
  projectId: string;
  awaiting: boolean;
  note?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[setAwaitingClientDetails]';
  console.log(`${op} Setting awaiting=${input.awaiting} for project: ${input.projectId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('net_metering_applications')
    .update({
      awaiting_client_details: input.awaiting,
      awaiting_client_since: input.awaiting ? new Date().toISOString() : null,
      awaiting_client_note: input.note ?? null,
    } as any)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message, projectId: input.projectId });
    return { success: false, error: error.message };
  }

  revalidatePath('/liaison');
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}
```

- [ ] **Step 5: Verify types**

```bash
pnpm check-types
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/src/lib/liaison-actions.ts
git commit -m "feat(liaison): auto-set CEIG on NMA creation, add setAwaitingClientDetails, remove updateCeigScope"
```

---

## Task 4: Update `liaison-queries.ts`

**Files:**
- Modify: `apps/erp/src/lib/liaison-queries.ts`

- [ ] **Step 1: Add filter param support to `getAllNetMeteringApplications`**

Replace the existing `getAllNetMeteringApplications` function (lines ~58–98) with:

```ts
export type LiaisonFilter =
  | 'all'
  | 'awaiting_client'
  | 'ceig_pending'
  | 'ceig_in_process'
  | 'tneb_active';

export async function getAllNetMeteringApplications(filters: {
  filter?: LiaisonFilter;
  search?: string;
} = {}) {
  const op = '[getAllNetMeteringApplications]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  let query = supabase
    .from('net_metering_applications')
    .select(
      '*, projects(id, project_number, customer_name, system_size_kwp, system_type, site_city, ceig_required)',
    )
    .order('created_at', { ascending: false });

  switch (filters.filter) {
    case 'awaiting_client':
      query = query.eq('awaiting_client_details', true);
      break;
    case 'ceig_pending':
      query = query.eq('ceig_required', true).eq('ceig_status', 'pending');
      break;
    case 'ceig_in_process':
      query = query
        .eq('ceig_required', true)
        .in('ceig_status', ['applied', 'inspection_scheduled']);
      break;
    case 'tneb_active':
      query = query.in('discom_status', [
        'applied',
        'tneb_verified',
        'tneb_inspected',
        'tneb_estimated',
        'installation_completed',
      ]);
      break;
    default:
      break;
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load net metering applications: ${error.message}`);
  }

  let results = data ?? [];

  if (filters.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(
      (app: any) =>
        app.projects?.customer_name?.toLowerCase().includes(s) ||
        app.projects?.project_number?.toLowerCase().includes(s) ||
        app.discom_application_number?.toLowerCase().includes(s),
    );
  }

  return results;
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/liaison-queries.ts
git commit -m "feat(liaison): update getAllNetMeteringApplications with filter param + new status values"
```

---

## Task 5: New `liaison-summary-queries.ts`

**Files:**
- Create: `apps/erp/src/lib/liaison-summary-queries.ts`

- [ ] **Step 1: Create the file**

```ts
import { createClient } from '@repo/supabase/server';

export interface LiaisonSummary {
  total: number;
  awaiting_client: number;
  ceig_pending: number;
  ceig_in_process: number;
  tneb_active: number;
}

export async function getLiaisonSummary(): Promise<LiaisonSummary> {
  const op = '[getLiaisonSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_liaison_summary');

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    return { total: 0, awaiting_client: 0, ceig_pending: 0, ceig_in_process: 0, tneb_active: 0 };
  }

  const row = (data as any)?.[0] ?? {};
  return {
    total:           Number(row.total           ?? 0),
    awaiting_client: Number(row.awaiting_client ?? 0),
    ceig_pending:    Number(row.ceig_pending    ?? 0),
    ceig_in_process: Number(row.ceig_in_process ?? 0),
    tneb_active:     Number(row.tneb_active     ?? 0),
  };
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/liaison-summary-queries.ts
git commit -m "feat(liaison): getLiaisonSummary query via get_liaison_summary() RPC"
```

---

## Task 6: New `AwaitingClientToggle` component

**Files:**
- Create: `apps/erp/src/components/liaison/awaiting-client-toggle.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { setAwaitingClientDetails } from '@/lib/liaison-actions';

interface AwaitingClientToggleProps {
  projectId: string;
  isAwaiting: boolean;
  currentNote?: string | null;
}

export function AwaitingClientToggle({ projectId, isAwaiting, currentNote }: AwaitingClientToggleProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [showNoteInput, setShowNoteInput] = React.useState(false);
  const [note, setNote] = React.useState(currentNote ?? '');

  async function handleMark() {
    if (!isAwaiting) {
      setShowNoteInput(true);
      return;
    }
    // Clearing the flag — no note needed
    setSaving(true);
    await setAwaitingClientDetails({ projectId, awaiting: false });
    setSaving(false);
    router.refresh();
  }

  async function handleConfirmNote() {
    setSaving(true);
    await setAwaitingClientDetails({ projectId, awaiting: true, note: note.trim() || undefined });
    setSaving(false);
    setShowNoteInput(false);
    router.refresh();
  }

  if (showNoteInput) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is needed from the client? (optional)"
          className="text-xs border border-n-200 rounded px-2 py-1 w-56 focus:ring-1 focus:ring-p-300"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmNote()}
        />
        <Button size="sm" onClick={handleConfirmNote} disabled={saving} className="h-7 text-xs">
          {saving ? '...' : 'Confirm'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowNoteInput(false)} className="h-7 text-xs">
          Cancel
        </Button>
      </div>
    );
  }

  if (isAwaiting) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleMark}
        disabled={saving}
        className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
      >
        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
        {saving ? '...' : 'Mark Resolved'}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleMark}
      disabled={saving}
      className="h-7 text-xs text-n-600 hover:text-amber-700"
    >
      <AlertCircle className="h-3.5 w-3.5 mr-1" />
      Awaiting Client
    </Button>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/liaison/awaiting-client-toggle.tsx
git commit -m "feat(liaison): AwaitingClientToggle component"
```

---

## Task 7: Update `liaison-form.tsx`

**Files:**
- Modify: `apps/erp/src/components/projects/forms/liaison-form.tsx`

- [ ] **Step 1: Update `DISCOM_STATUSES` array**

Find (lines ~63–73):

```ts
const DISCOM_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'applied', label: 'Applied' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'site_inspection_scheduled', label: 'Site Inspection Scheduled' },
  { value: 'approved', label: 'Approved' },
  { value: 'net_meter_installed', label: 'Net Meter Installed' },
  { value: 'activated', label: 'Activated' },
  { value: 'objection_raised', label: 'Objection Raised' },
  { value: 'rejected', label: 'Rejected' },
];
```

Replace with:

```ts
const DISCOM_STATUSES = [
  { value: 'pending',                label: 'Pending' },
  { value: 'applied',                label: 'Applied' },
  { value: 'tneb_verified',          label: 'Verified' },
  { value: 'tneb_inspected',         label: 'Inspected' },
  { value: 'tneb_estimated',         label: 'Estimated' },
  { value: 'installation_completed', label: 'Installation Completed' },
  { value: 'service_effected',       label: 'Service Effected' },
  { value: 'objection_raised',       label: 'Objection Raised' },
  { value: 'rejected',               label: 'Rejected' },
];
```

- [ ] **Step 2: Remove `CeigScopeToggle` export and its `updateCeigScope` import**

At the top of the file, remove `updateCeigScope` from the imports:

```ts
// Remove this from the import list:
  updateCeigScope,
```

Then delete the entire `CeigScopeToggle` function export (find it at line ~463 and delete through the closing brace).

- [ ] **Step 3: Add `AwaitingClientToggle` to the exports from this file**

At the top of `liaison-form.tsx`, add the re-export so `step-liaison.tsx` can import from one place:

```ts
export { AwaitingClientToggle } from '@/components/liaison/awaiting-client-toggle';
```

- [ ] **Step 4: Verify types**

```bash
pnpm check-types
```

Expected: There will be a compile error in `step-liaison.tsx` because it still imports `CeigScopeToggle`. That is fixed in the next task — this is fine at this step.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/components/projects/forms/liaison-form.tsx
git commit -m "feat(liaison): update DISCOM_STATUSES to TNEB vocabulary, remove CeigScopeToggle, re-export AwaitingClientToggle"
```

---

## Task 8: Update `step-liaison.tsx`

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx`

- [ ] **Step 1: Update imports — remove `CeigScopeToggle`, add `AwaitingClientToggle`**

At the top, change the import from `liaison-form`:

```ts
import {
  LiaisonCreateButton,
  DiscomStatusForm,
  CeigStatusForm,
  NetMeterForm,
  FollowupForm,
  LiaisonFieldEditor,
  LiaisonDocUpload,
  LiaisonActivityForm,
  AwaitingClientToggle,        // add
} from '@/components/projects/forms/liaison-form';
// Remove CeigScopeToggle from the list above
```

- [ ] **Step 2: Replace `deriveWorkflowStages` with new TNEB vocabulary**

Replace the entire `deriveWorkflowStages` function (lines ~40–93):

```ts
function deriveWorkflowStages(app: any, showCeig: boolean): WorkflowStage[] {
  const ds: string = app.discom_status ?? 'pending';

  const TNEB_ORDER = [
    'applied', 'tneb_verified', 'tneb_inspected',
    'tneb_estimated', 'installation_completed', 'service_effected',
  ];
  const tnebIdx = TNEB_ORDER.indexOf(ds);

  function tnebStatus(stage: string): 'done' | 'active' | 'pending' {
    const stageIdx = TNEB_ORDER.indexOf(stage);
    if (stageIdx < tnebIdx) return 'done';
    if (stageIdx === tnebIdx) return 'active';
    return 'pending';
  }

  const stages: WorkflowStage[] = [];

  // 1. Application Created — always done once NMA exists
  stages.push({ key: 'created', label: 'Application Created', status: 'done' });

  // 2. CEIG Clearance (conditional)
  if (showCeig) {
    const ceigDone = app.ceig_status === 'approved';
    const ceigActive = ['applied', 'inspection_scheduled'].includes(app.ceig_status ?? '');
    stages.push({
      key: 'ceig',
      label: 'CEIG Clearance',
      status: ceigDone ? 'done' : ceigActive ? 'active' : 'pending',
    });
  }

  // 3–8. TNEB stages
  const tnebStages: { key: string; label: string; value: string }[] = [
    { key: 'applied',                label: 'Applied',               value: 'applied' },
    { key: 'tneb_verified',          label: 'Verified',              value: 'tneb_verified' },
    { key: 'tneb_inspected',         label: 'Inspected',             value: 'tneb_inspected' },
    { key: 'tneb_estimated',         label: 'Estimated',             value: 'tneb_estimated' },
    { key: 'installation_completed', label: 'Installation Done',     value: 'installation_completed' },
    { key: 'service_effected',       label: 'Service Effected',      value: 'service_effected' },
  ];

  for (const s of tnebStages) {
    stages.push({ key: s.key, label: s.label, status: tnebStatus(s.value) });
  }

  return stages;
}
```

- [ ] **Step 3: Update `showCeig` logic to use `ceig_scope` from the project**

Find (around line 144–147):

```ts
  const showCeig =
    application.ceig_required || (sizeKwp >= 10 && systemType !== 'off_grid');
```

Replace with:

```ts
  // ceig_scope is now on projects (migration 114). Show CEIG panel when scope is 'shiroi'
  // and the project meets the ≥10 kWp / non-off-grid threshold.
  const ceigScope = (project as any).ceig_scope ?? 'shiroi';
  const showCeig =
    application.ceig_required ||
    (ceigScope === 'shiroi' && sizeKwp >= 10 && systemType !== 'off_grid');
```

- [ ] **Step 4: Remove `CeigScopeToggle` usage from the JSX**

Search for `<CeigScopeToggle` in the file (around line 276) and delete the entire element:

```tsx
// Delete this block:
<CeigScopeToggle
  applicationId={application.id}
  currentScope={...}
  readOnly={readOnly}
/>
```

- [ ] **Step 5: Add `AwaitingClientToggle` to the JSX**

Search the file for `<DiscomStatusForm`. It appears inside the DISCOM/TNEB card section. Add the `AwaitingClientToggle` on the line immediately after the closing `/>` of `<DiscomStatusForm`:

```tsx
              <DiscomStatusForm projectId={projectId} currentStatus={application.discom_status} />
              {!readOnly && (
                <AwaitingClientToggle
                  projectId={projectId}
                  isAwaiting={application.awaiting_client_details ?? false}
                  currentNote={application.awaiting_client_note ?? null}
                />
              )}
```

- [ ] **Step 6: Verify types**

```bash
pnpm check-types
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/erp/src/components/projects/stepper-steps/step-liaison.tsx
git commit -m "feat(liaison): update step-liaison — new TNEB stages, remove CeigScopeToggle, add AwaitingClientToggle"
```

---

## Task 9: Update `net-metering-detail.tsx`

**Files:**
- Modify: `apps/erp/src/components/liaison/net-metering-detail.tsx`

- [ ] **Step 1: Update old status string references in the DISCOM status section**

Find the DISCOM_STATUSES list in this file (around lines 18–30). It has the old values. Replace:

```ts
// Old — delete these lines:
  { value: 'approved', label: 'Approved' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'site_inspection_scheduled', label: 'Site Inspection Scheduled' },
  { value: 'approved', label: 'Approved' },       // duplicate
  { value: 'net_meter_installed', label: 'Net Meter Installed' },
```

Replace the DISCOM status dropdown options in this file with:

```ts
const DISCOM_STATUS_OPTIONS = [
  { value: 'pending',                label: 'Pending' },
  { value: 'applied',                label: 'Applied' },
  { value: 'tneb_verified',          label: 'Verified' },
  { value: 'tneb_inspected',         label: 'Inspected' },
  { value: 'tneb_estimated',         label: 'Estimated' },
  { value: 'installation_completed', label: 'Installation Completed' },
  { value: 'service_effected',       label: 'Service Effected' },
  { value: 'objection_raised',       label: 'Objection Raised' },
  { value: 'rejected',               label: 'Rejected' },
];
```

- [ ] **Step 2: Update the badge variant logic for the DISCOM status badge**

Find around line 220:

```ts
application.discom_status === 'approved' || application.discom_status === 'net_meter_installed' ? 'success' :
application.discom_status === 'rejected' || application.discom_status === 'objection_raised' ? 'error' : 'warning'
```

Replace with:

```ts
['installation_completed', 'service_effected', 'tneb_estimated'].includes(application.discom_status) ? 'success' :
['rejected', 'objection_raised'].includes(application.discom_status) ? 'error' : 'warning'
```

- [ ] **Step 3: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/liaison/net-metering-detail.tsx
git commit -m "fix(liaison): update net-metering-detail to use new TNEB status values"
```

---

## Task 10: Add `ceig_scope` to project detail

**Files:**
- Modify: `apps/erp/src/lib/project-detail-actions.ts`
- Modify: `apps/erp/src/components/projects/detail/system-config-box.tsx`
- Modify: `apps/erp/src/app/(erp)/projects/[id]/page.tsx`

- [ ] **Step 1: Add `ceig_scope` to `EDITABLE_PROJECT_FIELDS` in `project-detail-actions.ts`**

Find `EDITABLE_PROJECT_FIELDS` (line ~15). After the `'scope_meter',` entry, add:

```ts
  'ceig_scope',
```

- [ ] **Step 2: Add `ceig_scope` prop to `SystemConfigBoxProps` in `system-config-box.tsx`**

Find the `SystemConfigBoxProps` interface (around line 25). Add `ceig_scope` to the `project` object type:

```ts
  project: {
    // ... existing fields ...
    ceig_scope: string | null;  // add this
  };
```

- [ ] **Step 3: Add `ceig_scope` EditableField to the System Configuration box**

In `SystemConfigBox`, find the section with `scope_la`, `scope_civil`, `scope_meter` fields. After `scope_meter`, add:

```tsx
<EditableField
  projectId={projectId}
  field="ceig_scope"
  label="CEIG Handled By"
  value={project.ceig_scope ?? 'shiroi'}
  type="select"
  options={SCOPE_OPTIONS}
/>
```

`SCOPE_OPTIONS` is already defined at the top of this file as `[{value:'shiroi',label:'Shiroi'},{value:'client',label:'Client'}]`.

- [ ] **Step 4: Pass `ceig_scope` to `SystemConfigBox` in `projects/[id]/page.tsx`**

In the `ProjectDetailPage`, find the `<SystemConfigBox>` call. Add to the `project` prop:

```tsx
ceig_scope: (project as any).ceig_scope ?? 'shiroi',
```

- [ ] **Step 5: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 6: Commit**

```bash
git add apps/erp/src/lib/project-detail-actions.ts apps/erp/src/components/projects/detail/system-config-box.tsx apps/erp/src/app/(erp)/projects/[id]/page.tsx
git commit -m "feat(projects): add ceig_scope field to SystemConfigBox — set by Manivel at project entry"
```

---

## Task 11: Rewrite `/liaison/page.tsx`

**Files:**
- Rewrite: `apps/erp/src/app/(erp)/liaison/page.tsx`

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `apps/erp/src/app/(erp)/liaison/page.tsx` with:

```tsx
import Link from 'next/link';
import { getLiaisonSummary } from '@/lib/liaison-summary-queries';
import { getAllNetMeteringApplications } from '@/lib/liaison-queries';
import type { LiaisonFilter } from '@/lib/liaison-queries';
import { formatDate } from '@repo/ui/formatters';
import { Card, CardContent, Eyebrow } from '@repo/ui';
import { Globe, AlertCircle, ShieldCheck, ShieldAlert, Zap } from 'lucide-react';
import { TnebStageBadge, CeigStageBadge, AwaitingClientBadge } from '@/components/liaison/liaison-status-badge';

interface LiaisonPageProps {
  searchParams: Promise<{ filter?: string; search?: string }>;
}

const CARD_DEFS = [
  {
    key: 'all' as const,
    label: 'Total Applications',
    summaryKey: 'total' as const,
    icon: Globe,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    key: 'awaiting_client' as const,
    label: 'Awaiting Client',
    summaryKey: 'awaiting_client' as const,
    icon: AlertCircle,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    key: 'ceig_pending' as const,
    label: 'CEIG Pending',
    summaryKey: 'ceig_pending' as const,
    icon: ShieldAlert,
    bgColor: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    key: 'ceig_in_process' as const,
    label: 'CEIG In Process',
    summaryKey: 'ceig_in_process' as const,
    icon: ShieldCheck,
    bgColor: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  {
    key: 'tneb_active' as const,
    label: 'TNEB Active',
    summaryKey: 'tneb_active' as const,
    icon: Zap,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
] as const;

export default async function LiaisonPage({ searchParams }: LiaisonPageProps) {
  const op = '[LiaisonPage]';
  const params = await searchParams;

  const rawFilter = params.filter;
  const activeFilter: LiaisonFilter =
    rawFilter === 'awaiting_client' ||
    rawFilter === 'ceig_pending' ||
    rawFilter === 'ceig_in_process' ||
    rawFilter === 'tneb_active'
      ? rawFilter
      : 'all';

  // getLiaisonSummary has its own error handling and returns zeroed fallback on failure.
  const summary = await getLiaisonSummary();
  let applications: any[] = [];
  try {
    applications = await getAllNetMeteringApplications({ filter: activeFilter, search: params.search });
  } catch (err) {
    console.error(`${op} Failed to load applications:`, { error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() });
  }

  const now = new Date();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">LIAISON</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Liaison</h1>
        <p className="text-sm text-[#7C818E] mt-1">
          CEIG clearances, TNEB net-metering applications, and follow-up tracking.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {CARD_DEFS.map((card) => {
          const Icon = card.icon;
          const isActive = activeFilter === card.key || (card.key === 'all' && activeFilter === 'all');
          const href = card.key === 'all' ? '/liaison' : `/liaison?filter=${card.key}`;
          return (
            <Link key={card.key} href={href} className="block group">
              <Card className={`transition-shadow hover:shadow-md ${isActive ? 'ring-2 ring-[#00B050]' : ''}`}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${card.bgColor}`}>
                    <Icon className={`h-4 w-4 ${card.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-[#7C818E] leading-tight">{card.label}</p>
                    <p className="text-xl font-heading font-bold text-[#1A1D24]">
                      {summary[card.summaryKey]}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Active filter chip */}
      {activeFilter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-n-600">
            Filtered: {CARD_DEFS.find((c) => c.key === activeFilter)?.label}
          </span>
          <Link href="/liaison" className="text-xs text-[#00B050] hover:underline">
            × Clear
          </Link>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-n-50 border-b-2 border-n-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">Project</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-n-600 uppercase tracking-wider">kWp</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">CEIG</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">TNEB Stage</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">App. Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">Next Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {(applications as any[]).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-16 text-center text-sm text-n-500">
                      No applications found
                      {activeFilter !== 'all' ? ' for this filter' : ''}.
                    </td>
                  </tr>
                ) : (
                  (applications as any[]).map((app, i) => {
                    const followupDate = app.next_followup_date ? new Date(app.next_followup_date) : null;
                    const followupOverdue = followupDate && followupDate < now;
                    return (
                      <tr
                        key={app.id}
                        className={`h-10 border-b border-n-100 hover:bg-[#00B050]/[0.04] ${i % 2 === 1 ? 'bg-n-50/30' : ''}`}
                      >
                        <td className="px-3 py-2">
                          {app.projects ? (
                            <Link
                              href={`/liaison/net-metering/${app.project_id}`}
                              className="font-medium text-n-900 hover:text-[#00B050] hover:underline"
                            >
                              {app.projects.project_number} — {app.projects.customer_name}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-n-600">
                          {app.projects?.system_size_kwp != null
                            ? Number(app.projects.system_size_kwp).toFixed(1)
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {app.ceig_required ? (
                            <CeigStageBadge status={app.ceig_status ?? 'pending'} />
                          ) : (
                            <span className="text-xs text-n-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <TnebStageBadge status={app.discom_status ?? 'pending'} />
                            {app.awaiting_client_details && <AwaitingClientBadge />}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-n-600 font-mono tabular-nums text-xs">
                          {app.discom_application_date ? formatDate(app.discom_application_date) : '—'}
                        </td>
                        <td className={`px-3 py-2 font-mono tabular-nums text-xs ${followupOverdue ? 'text-red-600 font-semibold' : 'text-n-600'}`}>
                          {followupDate ? formatDate(app.next_followup_date) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/(erp)/liaison/page.tsx
git commit -m "feat(liaison): unified page — 5 clickable summary cards + polished TNEB table"
```

---

## Task 12: Redirect `/liaison/net-metering/page.tsx`

**Files:**
- Rewrite: `apps/erp/src/app/(erp)/liaison/net-metering/page.tsx`

- [ ] **Step 1: Replace with redirect**

Replace the entire contents of `apps/erp/src/app/(erp)/liaison/net-metering/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function NetMeteringListPage() {
  redirect('/liaison');
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/(erp)/liaison/net-metering/page.tsx
git commit -m "feat(liaison): redirect /liaison/net-metering → /liaison (list now on unified page)"
```

---

## Task 13: Full CI check + docs update + push

- [ ] **Step 1: Run full CI gates**

```bash
pnpm check-types && pnpm lint --max-warnings 0 && bash scripts/ci/check-forbidden-patterns.sh
```

Expected: all three pass. Fix any warnings before moving on.

- [ ] **Step 2: Append to `docs/CHANGELOG.md`**

Add one line at the top of the changelog entries:

```
- **2026-05-23** — Liaison TNEB stage redesign (mig 114): renamed discom_status values to official TNEB vocabulary (applied/verified/inspected/estimated/installation_completed/service_effected), added awaiting_client_details flag, moved ceig_scope to projects table, unified /liaison page with 5 clickable summary cards + polished table. CeigScopeToggle removed from liaison panel — ceig_scope now set by PM in SystemConfigBox.
```

- [ ] **Step 3: Update `docs/CURRENT_STATUS.md`**

In the "In flight this week" table, add a new completed row:

```
| **Liaison TNEB redesign (mig 114)** | Claude (2026-05-23) | ✅ Shipped to dev | TNEB stage vocabulary, awaiting-client flag, ceig_scope → projects, unified /liaison page. |
```

- [ ] **Step 4: Update `docs/modules/liaison.md`**

Update the "Routes / Screens" section:

```
- `/liaison` — unified page: 5 clickable summary cards (Total / Awaiting Client / CEIG Pending / CEIG In Process / TNEB Active) + full applications table. `?filter=` param pre-filters the table.
- `/liaison/net-metering` — redirects to `/liaison`
- `/liaison/net-metering/[projectId]` — per-project detail (unchanged)
```

Update the "Workflow bar" section with the new stage names.

Update the "Key Tables" section to reflect:
- `ceig_scope` moved from `net_metering_applications` to `projects`
- New columns: `awaiting_client_details`, `awaiting_client_since`, `awaiting_client_note`
- `discom_status` new values

Update "Recent Changes" with migration 114.

- [ ] **Step 5: Commit docs**

```bash
git add docs/CHANGELOG.md docs/CURRENT_STATUS.md docs/modules/liaison.md
git commit -m "docs: update liaison module docs for TNEB redesign (mig 114)"
```

- [ ] **Step 6: Push to remote**

```bash
git push origin main
```

Expected: push succeeds. Vercel will auto-deploy to `erp.shiroienergy.com`.
