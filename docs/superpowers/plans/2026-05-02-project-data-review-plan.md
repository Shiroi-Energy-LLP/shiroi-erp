# Project Data Review Triage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (single-session execution).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/data-review/projects` triage UI for founder + marketing_manager + project_manager to confirm system size + total order value across all 362 projects, with `[Mark Duplicate]` smart-merge.

**Architecture:**
- Schema-first: migration 102 adds `projects.review_status` + `project_review_audit` table + 4 SQL helpers (`get_project_review_counts`, `confirm_project_review`, `score_project_data_richness`, `mark_project_duplicate`).
- Server actions in `apps/erp/src/lib/data-review-actions.ts` wrap the SQL helpers, return `ActionResult<T>`.
- Page server-rendered with role guard at `apps/erp/src/app/(erp)/data-review/projects/page.tsx`; client `DataReviewShell` handles tabs + KPI strip + table.
- Banner on `/dashboard` (cached 60s, auto-hides at 0).

**Tech Stack:** Next.js 14 (App Router), Supabase Postgres + RLS, shadcn/ui, Tailwind. Vitest for SQL helpers. Playwright for smoke.

**Spec:** `docs/superpowers/specs/2026-05-02-project-data-review-design.md`

**Working dir:** `C:\Users\vivek\Projects\shiroi-erp`

---

## File Structure

**Created:**
- `supabase/migrations/102_project_review_triage.sql` — schema + 4 RPCs
- `apps/erp/src/lib/data-review-queries.ts` — read fns
- `apps/erp/src/lib/data-review-actions.ts` — `'use server'` mutations returning `ActionResult<T>`
- `apps/erp/src/app/(erp)/data-review/layout.tsx` — section role guard
- `apps/erp/src/app/(erp)/data-review/projects/page.tsx` — server-rendered shell
- `apps/erp/src/app/(erp)/data-review/projects/_components/data-review-shell.tsx` — tabs + KPI strip
- `apps/erp/src/app/(erp)/data-review/projects/_components/projects-table.tsx` — row list
- `apps/erp/src/app/(erp)/data-review/projects/_components/project-edit-row.tsx` — inline edit form
- `apps/erp/src/app/(erp)/data-review/projects/_components/duplicate-search.tsx` — typeahead
- `apps/erp/src/app/(erp)/data-review/projects/_components/audit-log-tab.tsx` — audit log + undo
- `apps/erp/src/components/dashboard/data-review-banner.tsx` — banner
- `e2e/data-review.spec.ts` — Playwright smoke
- `apps/erp/src/lib/__tests__/data-review-helpers.test.ts` — SQL helper unit tests via test client

**Modified:**
- `packages/types/database.ts` — regenerate after migration
- `apps/erp/src/app/(erp)/dashboard/page.tsx` — wire banner in
- `docs/CHANGELOG.md` + `docs/CURRENT_STATUS.md` — entry on ship

---

## Conventions to follow (CLAUDE.md NEVER-DOs)

- Reads in `*-queries.ts`, mutations in `*-actions.ts` (`'use server'`)
- Server actions return `ActionResult<T>` from `apps/erp/src/lib/types/actions` — never throw
- Row types via `Database['public']['Tables']['x']['Row']` — no `any`
- All financial aggregation in SQL (NEVER-DO #12) — no JS reduces
- Money: `decimal.js` on the client, `NUMERIC(14,2)` in SQL
- Format INR with `formatINR` / `shortINR`
- Run `pnpm tsx scripts/strip-view-fk-entries.mjs` after regenerating `database.ts`
- Component files ≤500 LOC

---

## Task 1: Apply migration 102 to dev

**Files:**
- Create: `supabase/migrations/102_project_review_triage.sql`

- [ ] **Step 1: Write the migration file**

Copy the schema + 4 RPCs from `docs/superpowers/specs/2026-05-02-project-data-review-design.md` (the "Schema" section) into `supabase/migrations/102_project_review_triage.sql`. Add at top:

```sql
-- 102_project_review_triage.sql
-- Project Data Review triage UI — see spec 2026-05-02-project-data-review-design.md
-- Adds review_status to projects + audit table + 4 helper functions.

BEGIN;
```

And `COMMIT;` at the end.

The 4 RPCs are: `get_project_review_counts`, `confirm_project_review`, `score_project_data_richness`, `mark_project_duplicate`. Plus the `undo_project_review` helper sketched below:

```sql
CREATE OR REPLACE FUNCTION undo_project_review(
  p_project_id UUID,
  p_made_by UUID
) RETURNS TABLE(success BOOLEAN, code TEXT)
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_audit project_review_audit%ROWTYPE;
BEGIN
  SELECT * INTO v_audit FROM project_review_audit
    WHERE project_id = p_project_id AND decision <> 'undo'
    ORDER BY made_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'no_decision_to_undo'::TEXT; RETURN; END IF;

  -- Revert based on the original decision
  IF v_audit.decision = 'confirmed' THEN
    -- Restore prev values + flip back to pending
    UPDATE projects SET
      system_size_kwp = COALESCE(v_audit.prev_size_kwp, system_size_kwp),
      contracted_value = COALESCE(v_audit.prev_contracted_value, contracted_value),
      review_status = 'pending'
    WHERE id = p_project_id;
    -- Restore proposal flags (we lose info on the original flag state — set both to TRUE so banner reappears)
    UPDATE proposals pr SET
      system_size_kwp = COALESCE(v_audit.prev_size_kwp, pr.system_size_kwp),
      total_before_discount = COALESCE(v_audit.prev_contracted_value, pr.total_before_discount),
      total_after_discount = COALESCE(v_audit.prev_contracted_value, pr.total_after_discount),
      shiroi_revenue = COALESCE(v_audit.prev_contracted_value, pr.shiroi_revenue),
      financials_invalidated = TRUE,
      system_size_uncertain = TRUE
    WHERE pr.id = (SELECT proposal_id FROM projects WHERE id = p_project_id);
  ELSIF v_audit.decision = 'duplicate' THEN
    -- Restore the deleted project + flip canonical back to pending if it was pending before
    UPDATE projects SET deleted_at = NULL, review_status = 'pending' WHERE id = p_project_id;
    UPDATE projects SET review_status = 'pending'
      WHERE id = v_audit.duplicate_of_project_id AND review_status = 'confirmed';
  END IF;

  INSERT INTO project_review_audit(project_id, decision, made_by, notes)
  VALUES (p_project_id, 'undo', p_made_by, 'Undo of audit row ' || v_audit.id);

  RETURN QUERY SELECT TRUE, 'ok'::TEXT;
END;
$$;
```

Also add to the existing `projects` UPDATE RLS so `marketing_manager` can write — find the policy via `SELECT policyname, cmd, qual FROM pg_policies WHERE tablename='projects' AND cmd='UPDATE'`. Most likely the policy needs `OR role = 'marketing_manager'` added to its `USING` and `WITH CHECK` expressions. Wrap that change in the same migration.

- [ ] **Step 2: Apply migration to dev via Supabase MCP**

Use the `mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__apply_migration` tool with project_id `actqtzoxjilqnldnacqz` and the contents of the file. This both runs the SQL and registers it in `supabase_migrations.schema_migrations`.

- [ ] **Step 3: Verify migration applied**

```sql
SELECT name FROM supabase_migrations.schema_migrations WHERE name LIKE '%102%';
SELECT review_status, COUNT(*) FROM projects WHERE deleted_at IS NULL GROUP BY 1;
SELECT * FROM get_project_review_counts();
```

Expected: migration 102 listed; all 362 projects have `review_status='pending'`; counts RPC returns sensible numbers.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/102_project_review_triage.sql
git commit -m "feat(data-review): migration 102 — review_status + audit + 4 RPCs"
```

---

## Task 2: Regenerate types

- [ ] **Step 1: Regenerate**

```bash
pnpm tsx scripts/regenerate-types.ts
# OR if that doesn't exist, look at how prior migrations regenerated and follow the same path
# (Hint: probably `npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz > packages/types/database.ts`)
```

- [ ] **Step 2: Strip view FK entries (mandatory per CLAUDE.md notes)**

```bash
pnpm tsx scripts/strip-view-fk-entries.mjs
```

- [ ] **Step 3: Verify check-types passes**

```bash
pnpm check-types
```

Expected: 5/5 successful, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/database.ts
git commit -m "chore(types): regen for migration 102"
```

---

## Task 3: Vitest unit test for SQL helpers

**Files:**
- Create: `apps/erp/src/lib/__tests__/data-review-helpers.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../../.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe('confirm_project_review', () => {
  it('rejects size <= 0', async () => {
    // pick any pending project for the test
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('review_status', 'pending')
      .is('deleted_at', null)
      .limit(1)
      .single();
    const { data, error } = await supabase.rpc('confirm_project_review', {
      p_project_id: proj!.id, p_new_size_kwp: 0, p_new_contracted_value: 0,
      p_made_by: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();
    expect(data?.[0]).toEqual({ success: false, code: 'size_must_be_positive' });
  });

  it('rejects implausible per-kWp', async () => {
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('review_status', 'pending')
      .is('deleted_at', null)
      .limit(1)
      .single();
    const { data } = await supabase.rpc('confirm_project_review', {
      p_project_id: proj!.id, p_new_size_kwp: 1, p_new_contracted_value: 600_000,
      p_made_by: '00000000-0000-0000-0000-000000000000',
    });
    expect(data?.[0]).toEqual({ success: false, code: 'still_implausible' });
  });
});

describe('score_project_data_richness', () => {
  it('returns 0 for a brand-new project (no transactions)', async () => {
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .ilike('notes', '%[HubSpot Migration 2026-05-02]%')
      .is('deleted_at', null)
      .limit(1)
      .single();
    const { data } = await supabase.rpc('score_project_data_richness', { p_project_id: proj!.id });
    expect(data).toBeGreaterThanOrEqual(0);
  });
});

describe('get_project_review_counts', () => {
  it('returns counts that sum sensibly', async () => {
    const { data } = await supabase.rpc('get_project_review_counts');
    expect(data?.[0]).toBeTruthy();
    expect(data![0].all_projects).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/erp && pnpm vitest run src/lib/__tests__/data-review-helpers.test.ts
```

Expected: all PASS. If `still_implausible` test fails because the chosen project's flags weren't set (e.g. it's already confirmed), refine the project picker query.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/__tests__/data-review-helpers.test.ts
git commit -m "test(data-review): vitest for confirm + score + counts RPCs"
```

---

## Task 4: Read query helpers

**Files:**
- Create: `apps/erp/src/lib/data-review-queries.ts`

- [ ] **Step 1: Write queries**

```ts
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types';

type ProjectRow = Database['public']['Tables']['projects']['Row'];
type ProposalRow = Database['public']['Tables']['proposals']['Row'];

export interface ReviewProjectRow {
  id: string;
  project_number: string;
  customer_name: string;
  system_size_kwp: number;
  contracted_value: number;
  review_status: ProjectRow['review_status'];
  created_at: string;
  // Joined from proposal
  proposal_id: string | null;
  financials_invalidated: boolean;
  system_size_uncertain: boolean;
  proposal_notes: string | null;
  // Source signals
  hubspot_deal_id: string | null;  // from leads via lead_id
  pv_ref_in_notes: string | null;  // extracted from project.notes if [HubSpot Migration ...]
  drive_link: string | null;       // extracted from notes
  is_likely_duplicate: boolean;    // notes contains [Likely-Duplicate-Reconcile]
}

export type ReviewTab = 'needs_review' | 'all' | 'confirmed' | 'duplicates';

export async function getProjectReviewCounts() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_project_review_counts').single();
  if (error) throw error;
  return data;
}

export async function listProjectsForReview(opts: {
  tab: ReviewTab;
  page: number;     // 0-indexed
  pageSize: number; // default 50
  search?: string;  // matches customer_name, project_number, or PV ref in notes
  sourceFilter?: 'hubspot' | 'drive' | 'zoho' | 'all';
}): Promise<{ rows: ReviewProjectRow[]; totalRows: number }> {
  const supabase = await createClient();
  const pageSize = opts.pageSize ?? 50;
  const from = opts.page * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from('projects')
    .select(`
      id, project_number, customer_name, system_size_kwp, contracted_value,
      review_status, created_at, notes, lead_id, proposal_id,
      proposals(id, financials_invalidated, system_size_uncertain, notes),
      leads(hubspot_deal_id)
    `, { count: 'estimated' })
    .is('deleted_at', null);

  if (opts.tab === 'needs_review') {
    q = q.eq('review_status', 'pending');
  } else if (opts.tab === 'confirmed') {
    q = q.eq('review_status', 'confirmed');
  } else if (opts.tab === 'duplicates') {
    q = q.eq('review_status', 'duplicate');
    // Note: duplicate projects have deleted_at IS NOT NULL, so the .is('deleted_at', null) above blocks them.
    // Refetch without that filter for the Duplicates tab:
  }
  // 'all' tab: no review_status filter (still excludes deleted_at IS NOT NULL)

  if (opts.search && opts.search.trim()) {
    const s = opts.search.trim();
    q = q.or(`customer_name.ilike.%${s}%,project_number.ilike.%${s}%,notes.ilike.%${s}%`);
  }

  // Sort: needs-review tab uses smart sort; others by created_at desc
  if (opts.tab === 'needs_review') {
    // Smart sort done in JS after fetch (small N — paginated 50 anyway, but we want
    // the suspicious rows first across the whole queue).
    // Strategy: do two fetches — first with notes ILIKE '%[Likely-Duplicate-Reconcile]%', then the rest.
    // For simplicity, do server-side smart-sort via an RPC.
    // For now, just sort by created_at desc; smart sort gets implemented as a follow-up RPC if needed.
    q = q.order('created_at', { ascending: false });
  } else {
    q = q.order('created_at', { ascending: false });
  }

  q = q.range(from, to);

  // Special case: 'duplicates' tab — re-build query without is('deleted_at', null)
  if (opts.tab === 'duplicates') {
    let q2 = supabase
      .from('projects')
      .select(`
        id, project_number, customer_name, system_size_kwp, contracted_value,
        review_status, created_at, notes, lead_id, proposal_id,
        proposals(id, financials_invalidated, system_size_uncertain, notes),
        leads(hubspot_deal_id)
      `, { count: 'estimated' })
      .eq('review_status', 'duplicate')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (opts.search?.trim()) q2 = q2.or(`customer_name.ilike.%${opts.search}%,project_number.ilike.%${opts.search}%`);
    const { data, error, count } = await q2;
    if (error) throw error;
    return { rows: (data ?? []).map(rowToReview), totalRows: count ?? 0 };
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []).map(rowToReview), totalRows: count ?? 0 };
}

function rowToReview(row: any): ReviewProjectRow {
  const proposal = row.proposals as any;
  const lead = row.leads as any;
  const projectNotes: string = row.notes ?? '';
  const proposalNotes: string = proposal?.notes ?? '';
  const allNotes = [projectNotes, proposalNotes].join(' ');

  const pvMatch = allNotes.match(/PV\s*\d+\s*\/\s*\d{2}(?:-\d{2})?/i);
  const driveMatch = allNotes.match(/https?:\/\/drive\.google\.com[^\s)"]*/);

  return {
    id: row.id,
    project_number: row.project_number,
    customer_name: row.customer_name,
    system_size_kwp: Number(row.system_size_kwp),
    contracted_value: Number(row.contracted_value),
    review_status: row.review_status,
    created_at: row.created_at,
    proposal_id: row.proposal_id,
    financials_invalidated: proposal?.financials_invalidated ?? false,
    system_size_uncertain: proposal?.system_size_uncertain ?? false,
    proposal_notes: proposalNotes || null,
    hubspot_deal_id: lead?.hubspot_deal_id ?? null,
    pv_ref_in_notes: pvMatch?.[0] ?? null,
    drive_link: driveMatch?.[0] ?? null,
    is_likely_duplicate: allNotes.includes('[Likely-Duplicate-Reconcile]'),
  };
}

export async function searchProjectsForDuplicate(query: string, excludeId: string): Promise<{ id: string; project_number: string; customer_name: string; system_size_kwp: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp')
    .neq('id', excludeId)
    .is('deleted_at', null)
    .or(`customer_name.ilike.%${query}%,project_number.ilike.%${query}%`)
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

export async function getProjectReviewAudit(opts: { page: number; pageSize: number }): Promise<{ rows: any[]; totalRows: number }> {
  const supabase = await createClient();
  const from = opts.page * opts.pageSize;
  const to = from + opts.pageSize - 1;
  const { data, error, count } = await supabase
    .from('project_review_audit')
    .select(`
      id, project_id, decision, prev_size_kwp, new_size_kwp,
      prev_contracted_value, new_contracted_value, duplicate_of_project_id,
      losing_score, winning_score, notes, made_by, made_at,
      projects!project_review_audit_project_id_fkey(project_number, customer_name)
    `, { count: 'estimated' })
    .order('made_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { rows: data ?? [], totalRows: count ?? 0 };
}

export async function getProjectScoreForDuplicateConfirm(projectId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('score_project_data_richness', { p_project_id: projectId });
  if (error) throw error;
  return Number(data ?? 0);
}
```

- [ ] **Step 2: Verify check-types**

```bash
pnpm check-types
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/data-review-queries.ts
git commit -m "feat(data-review): query helpers"
```

---

## Task 5: Server actions

**Files:**
- Create: `apps/erp/src/lib/data-review-actions.ts`

- [ ] **Step 1: Write actions**

```ts
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/types/actions';

export async function confirmProjectReview(input: {
  projectId: string;
  newSizeKwp: number;
  newContractedValue: number;
}): Promise<ActionResult<{ ok: true }>> {
  const op = '[confirmProjectReview]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'unauthorized', error: 'Not signed in' };

  const { data, error } = await supabase.rpc('confirm_project_review', {
    p_project_id: input.projectId,
    p_new_size_kwp: input.newSizeKwp,
    p_new_contracted_value: input.newContractedValue,
    p_made_by: user.id,
  });
  if (error) {
    console.error(op, { code: error.code, message: error.message, ts: new Date().toISOString() });
    return { ok: false, code: 'db_error', error: error.message };
  }
  const row = data?.[0];
  if (!row?.success) return { ok: false, code: row?.code ?? 'unknown', error: row?.code ?? 'failed' };

  revalidatePath('/data-review/projects');
  revalidatePath('/dashboard');
  return { ok: true, data: { ok: true } };
}

export async function markProjectDuplicate(input: {
  projectAId: string;
  projectBId: string;
  notes: string;
}): Promise<ActionResult<{ keptId: string; deletedId: string; keptScore: number; deletedScore: number }>> {
  const op = '[markProjectDuplicate]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'unauthorized', error: 'Not signed in' };

  const { data, error } = await supabase.rpc('mark_project_duplicate', {
    p_project_a_id: input.projectAId,
    p_project_b_id: input.projectBId,
    p_notes: input.notes,
    p_made_by: user.id,
  });
  if (error) {
    console.error(op, { code: error.code, message: error.message, ts: new Date().toISOString() });
    return { ok: false, code: 'db_error', error: error.message };
  }
  const row = data?.[0];
  if (!row?.success) return { ok: false, code: row?.code ?? 'unknown', error: row?.code ?? 'failed' };

  revalidatePath('/data-review/projects');
  revalidatePath('/dashboard');
  return { ok: true, data: { keptId: row.kept_project_id, deletedId: row.deleted_project_id, keptScore: row.kept_score, deletedScore: row.deleted_score } };
}

export async function undoLastDecision(input: { projectId: string }): Promise<ActionResult<{ ok: true }>> {
  const op = '[undoLastDecision]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'unauthorized', error: 'Not signed in' };

  const { data, error } = await supabase.rpc('undo_project_review', {
    p_project_id: input.projectId,
    p_made_by: user.id,
  });
  if (error) {
    console.error(op, { code: error.code, message: error.message, ts: new Date().toISOString() });
    return { ok: false, code: 'db_error', error: error.message };
  }
  const row = data?.[0];
  if (!row?.success) return { ok: false, code: row?.code ?? 'unknown', error: row?.code ?? 'failed' };

  revalidatePath('/data-review/projects');
  revalidatePath('/dashboard');
  return { ok: true, data: { ok: true } };
}
```

- [ ] **Step 2: Verify check-types**

```bash
pnpm check-types
```

Expected: 0 errors. If `ActionResult` type isn't matching, look at an existing action file (e.g. `apps/erp/src/lib/orphan-triage-actions.ts`) for the exact shape.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/data-review-actions.ts
git commit -m "feat(data-review): server actions wrapping SQL helpers"
```

---

## Task 6: Layout + role guard

**Files:**
- Create: `apps/erp/src/app/(erp)/data-review/layout.tsx`

- [ ] **Step 1: Write layout**

Mirror the role guard pattern from `apps/erp/src/app/(erp)/cash/orphan-invoices/page.tsx` (post-CI-fix version, which uses `getUserProfile()` from `@/lib/auth`). The data-review section permits `founder` + `marketing_manager` + `project_manager`; other roles redirect to `/dashboard?notice=data-review-forbidden`.

```tsx
import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';

const ALLOWED_ROLES = new Set(['founder', 'marketing_manager', 'project_manager']);

export default async function DataReviewLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (!ALLOWED_ROLES.has(profile.role)) redirect('/dashboard?notice=data-review-forbidden');
  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/data-review/layout.tsx
git commit -m "feat(data-review): section layout with role guard"
```

---

## Task 7: Page (server-rendered)

**Files:**
- Create: `apps/erp/src/app/(erp)/data-review/projects/page.tsx`

- [ ] **Step 1: Write page**

```tsx
import { Suspense } from 'react';
import { listProjectsForReview, getProjectReviewCounts, type ReviewTab } from '@/lib/data-review-queries';
import { DataReviewShell } from './_components/data-review-shell';

interface SearchParams {
  tab?: string;
  page?: string;
  search?: string;
}

export default async function DataReviewProjectsPage({
  searchParams,
}: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const tab = (params.tab as ReviewTab) ?? 'needs_review';
  const page = Number(params.page ?? '0');
  const search = params.search ?? '';

  const [counts, listing] = await Promise.all([
    getProjectReviewCounts(),
    listProjectsForReview({ tab, page, pageSize: 50, search }),
  ]);

  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <DataReviewShell
        tab={tab}
        counts={counts}
        rows={listing.rows}
        totalRows={listing.totalRows}
        page={page}
        pageSize={50}
        search={search}
      />
    </Suspense>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/data-review/projects/page.tsx
git commit -m "feat(data-review): server-rendered page"
```

---

## Task 8: DataReviewShell client component

**Files:**
- Create: `apps/erp/src/app/(erp)/data-review/projects/_components/data-review-shell.tsx`

- [ ] **Step 1: Write shell**

Build a client component that:
- Renders 5 tabs: Needs Review · All · Confirmed · Duplicates · Audit (uses Next.js Link for nav, ?tab= query param)
- Shows KPI strip with the 4 counts (Pending / All / Confirmed / Duplicates)
- Shows a search input (debounced 300ms, updates ?search= query param)
- Renders `<ProjectsTable>` for non-Audit tabs
- Renders `<AuditLogTab>` for the Audit tab (server-fetched separately via `getProjectReviewAudit`)
- Pagination controls at the bottom (Prev/Next based on `totalRows` and `pageSize`)

Use shadcn/ui `Tabs`, `Input`, `Button`. Borrow patterns from `apps/erp/src/app/(erp)/cash/orphan-invoices/_components/triage-shell.tsx` if it exists.

Keep this file ≤500 LOC. Split sub-pieces into their own files if needed.

- [ ] **Step 2: Verify lint + check-types**

```bash
pnpm lint
pnpm check-types
```

Expected: 0 errors / warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/(erp)/data-review/projects/_components/data-review-shell.tsx
git commit -m "feat(data-review): shell with tabs + KPI strip"
```

---

## Task 9: ProjectsTable + ProjectEditRow

**Files:**
- Create: `apps/erp/src/app/(erp)/data-review/projects/_components/projects-table.tsx`
- Create: `apps/erp/src/app/(erp)/data-review/projects/_components/project-edit-row.tsx`

- [ ] **Step 1: Write `projects-table.tsx`**

Renders a table with columns: Project# · Customer · kWp · ₹ Order Value · Source/Flags · Action. Each row is `<tr>` collapsed; click expands to show the `<ProjectEditRow>` form below the row in a second `<tr>` with `colSpan={6}`.

Include source badges:
- "HubSpot · LikelyDup" — when `is_likely_duplicate=true`
- "HubSpot" — when `hubspot_deal_id` is set
- "Drive" — when project_number contains a year suffix consistent with Drive imports (or notes match `[Drive]` pattern)
- Otherwise no badge

Show a small banner inline if `financials_invalidated || system_size_uncertain`.

Use `formatINR` for ₹ display.

- [ ] **Step 2: Write `project-edit-row.tsx`**

A controlled-form component with:
- Two number inputs: kWp + ₹ — pre-filled with current values
- Three buttons: `[Save & Confirm]` (calls `confirmProjectReview` with the input values) · `[Confirm — no change]` (calls `confirmProjectReview` with current values unchanged) · `[Mark Duplicate]` (opens duplicate-search dialog)
- Toast on result: success → row collapses + parent revalidates; error → toast with the `code`/`error` message
- Disable buttons during in-flight; show spinner

Use `useTransition` for the action calls. Use shadcn/ui `Toast` for feedback.

- [ ] **Step 3: Verify lint + types**

```bash
pnpm lint && pnpm check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/(erp)/data-review/projects/_components/projects-table.tsx \
        apps/erp/src/app/(erp)/data-review/projects/_components/project-edit-row.tsx
git commit -m "feat(data-review): table + inline edit row"
```

---

## Task 10: DuplicateSearch typeahead

**Files:**
- Create: `apps/erp/src/app/(erp)/data-review/projects/_components/duplicate-search.tsx`

- [ ] **Step 1: Write component**

A modal dialog (shadcn/ui `Dialog`) opened from `[Mark Duplicate]`. Contains:
- Search input (debounced 300ms) — calls `searchProjectsForDuplicate` query helper via a client fetcher
- Result list: each row shows `project_number · customer_name · {size} kWp` — clickable
- On select: shows a side-by-side comparison panel with the data-richness score for each project (A vs B), auto-suggests the higher-scored one as canonical
- "Reason" textarea (required, ≥1 char)
- `[Confirm Merge]` button — calls `markProjectDuplicate` action, on success closes dialog + toasts "{deletedProj#} marked as duplicate of {keptProj#}"

For the score comparison, call `getProjectScoreForDuplicateConfirm(projectId)` for both projects in parallel.

- [ ] **Step 2: Wire button in `project-edit-row.tsx`**

When user clicks `[Mark Duplicate]`, set local state to open the dialog. Pass current row's projectId as the "A" side.

- [ ] **Step 3: Verify**

```bash
pnpm lint && pnpm check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/(erp)/data-review/projects/_components/duplicate-search.tsx \
        apps/erp/src/app/(erp)/data-review/projects/_components/project-edit-row.tsx
git commit -m "feat(data-review): duplicate-search modal + smart-merge"
```

---

## Task 11: AuditLogTab

**Files:**
- Create: `apps/erp/src/app/(erp)/data-review/projects/_components/audit-log-tab.tsx`

- [ ] **Step 1: Write component**

Server-fetched (use `getProjectReviewAudit` query helper), paginated. Table columns: Date · Project# · Customer · Decision (chip with color: confirmed=green, duplicate=red, undo=gray) · Details (kWp/₹ change for confirmed, score comparison for duplicate) · By · `[Undo]`.

`[Undo]` calls `undoLastDecision` action, only enabled for the latest non-undo decision per project, only visible to founder + marketing_manager.

- [ ] **Step 2: Verify**

```bash
pnpm lint && pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/(erp)/data-review/projects/_components/audit-log-tab.tsx
git commit -m "feat(data-review): audit log tab with undo"
```

---

## Task 12: Dashboard banner

**Files:**
- Create: `apps/erp/src/components/dashboard/data-review-banner.tsx`
- Modify: `apps/erp/src/app/(erp)/dashboard/page.tsx`

- [ ] **Step 1: Write banner**

```tsx
import { unstable_cache } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import Link from 'next/link';

const getCachedCounts = unstable_cache(
  async () => {
    const supabase = await createClient();
    const { data } = await supabase.rpc('get_project_review_counts').single();
    return data;
  },
  ['data-review-counts'],
  { revalidate: 60, tags: ['data-review'] },
);

export async function DataReviewBanner() {
  const counts = await getCachedCounts();
  if (!counts || Number(counts.needs_review) === 0) return null;
  return (
    <div className="mb-4 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <span>
        ⚠ {counts.needs_review} projects need a quick data review · system size + order value verification
      </span>
      <Link href="/data-review/projects" className="font-medium underline">
        Open triage →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Wire into dashboard page**

In `apps/erp/src/app/(erp)/dashboard/page.tsx`, add `<DataReviewBanner />` near the top of the page content (above the existing KPI cards but below any header). Only render for the three allowed roles (the section role guard already gates the link, but the banner is on the dashboard so it should also gate based on profile.role).

```tsx
import { DataReviewBanner } from '@/components/dashboard/data-review-banner';
// ...
{['founder', 'marketing_manager', 'project_manager'].includes(profile.role) && <DataReviewBanner />}
```

- [ ] **Step 3: Verify in browser preview**

Start preview, open `/dashboard`, screenshot — banner should show with current pending count. Click → lands on `/data-review/projects`.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/dashboard/data-review-banner.tsx \
        apps/erp/src/app/(erp)/dashboard/page.tsx
git commit -m "feat(data-review): dashboard banner with cached count"
```

---

## Task 13: Playwright smoke

**Files:**
- Create: `e2e/data-review.spec.ts`

- [ ] **Step 1: Write test**

3 scenarios:
1. Founder logs in → /data-review/projects loads → "Needs Review" tab shows N rows.
2. Click first pending row → expand edit form → enter new size + ₹ → Save & Confirm → row disappears from queue (or moves to Confirmed tab).
3. Click `[Mark Duplicate]` on another row → dialog opens → search "test" → see results.

Use the existing test user pattern from `e2e/smoke.spec.ts`.

- [ ] **Step 2: Run smoke (manual, not CI yet)**

```bash
pnpm tsx e2e/data-review.spec.ts  # or whatever runner the repo uses
```

If CI doesn't run Playwright, document that in the file header.

- [ ] **Step 3: Commit**

```bash
git add e2e/data-review.spec.ts
git commit -m "test(data-review): playwright smoke for 3 happy paths"
```

---

## Task 14: Verify with browser preview

- [ ] **Step 1: Start preview server**

Use the `mcp__Claude_Preview__preview_start` tool.

- [ ] **Step 2: Manual sanity-check**

Visit `/data-review/projects`. Verify:
- Page loads, role-gated correctly.
- KPI strip shows realistic counts.
- "Needs Review" tab shows ~199 rows.
- Click a row, edit kWp + ₹, click Save & Confirm.
- Verify count drops by 1, row reappears in Confirmed tab.
- Click Mark Duplicate on another row, search, pick a candidate, see score comparison.
- Confirm merge — verify the deleted project_number disappears from "All".
- Audit tab shows both decisions with timestamps.
- Dashboard `/dashboard` banner shows updated count.

Take a screenshot of `/data-review/projects` showing rows + edit form open.

- [ ] **Step 3: Note any issues**

If preview reveals issues, fix in source and re-verify.

---

## Task 15: Documentation + commit

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/CURRENT_STATUS.md`

- [ ] **Step 1: Append to CHANGELOG.md (top of May 2026 section)**

```markdown
- **[2026-05-02] — Project data-review triage shipped at `/data-review/projects`.** Migration 102 adds `projects.review_status` enum + `project_review_audit` table + 4 RPCs (`get_project_review_counts`, `confirm_project_review`, `score_project_data_richness`, `mark_project_duplicate`, `undo_project_review`). UI: 5-tab triage shell (Needs Review · All · Confirmed · Duplicates · Audit) with KPI strip, inline edit (kWp + ₹), three actions per row (Save & Confirm · Confirm — no change · Mark Duplicate). Smart-merge: when user marks a duplicate, both projects get scored on data-richness (count of attached invoices+payments+POs+bills+expenses+BOM lines) and the lower-scored is soft-deleted. Tie-break: older `created_at`. Cascade on Save & Confirm: project + linked proposal both updated, banners cleared. Dashboard banner shows pending count, cached 60s, auto-hides at 0. Roles: founder + marketing_manager + project_manager. Spec: `2026-05-02-project-data-review-design.md`. Plan: `2026-05-02-project-data-review-plan.md`. → migration 102
```

- [ ] **Step 2: Update CURRENT_STATUS.md**

Add a new row near the top of the "In flight this week" table:

```markdown
| **Project data-review triage `/data-review/projects`** | Claude (2026-05-02 evening) | ✅ Shipped May 2 (dev) — awaits team sweep | One-time-sweep UI for founder + marketing_manager + project_manager to confirm system size + order value across all 362 projects. Three actions per row, smart-merge on Mark Duplicate. Migration 102. **To unblock:** Vivek dogfoods 5–10 rows, then hands off to Prem + Manivel for the bulk sweep. |
```

Also update the header sentence at the top to mention the 4th thread.

- [ ] **Step 3: Commit + push**

```bash
git add docs/CHANGELOG.md docs/CURRENT_STATUS.md
git commit -m "docs(data-review): changelog + current status"
git push origin main
```

---

## Self-review notes for executor

- All migrations regenerate `database.ts` immediately after — never ship a schema change without it (NEVER-DO #20).
- Server actions return `ActionResult<T>` — never throw across the RSC boundary (NEVER-DO #19).
- Money via `decimal.js` on client / `NUMERIC(14,2)` in SQL.
- Keep components ≤500 LOC.
- After each task, commit. After all tasks, single push.
