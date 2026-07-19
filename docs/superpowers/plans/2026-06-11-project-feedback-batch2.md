# Project Feedback Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 12-item feedback batch — FY filter, soft project delete, project auto-search everywhere, /tasks milestone picker + Log removal, Activities polish + custom stage, ticket/AMC comboboxes, price-book managed categories/units.

**Spec:** `docs/superpowers/specs/2026-06-11-project-feedback-batch2-design.md` — READ IT FIRST; decisions and findings live there.

**Architecture:** One dev-only migration (177). Search moves to a `search_projects_lite` RPC consumed by a typeahead box and by `getProjects`. Soft delete reuses the existing `deleted_at` + new `deleted_by`. Price-book categories/units become DB-managed lists (expense-categories pattern) consumed by price-book AND BOI/BOQ forms via optional props with constant fallbacks.

**Tech stack:** Next.js 14 App Router, Supabase, TypeScript, `@repo/ui`, vitest.

---

## Ground rules (apply to every batch)

1. **Migration:** dev project `actqtzoxjilqnldnacqz` ONLY (never `kfkydkwycgijvexqiysc`). Apply via MCP `apply_migration` (load via ToolSearch `select:mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__apply_migration,mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__execute_sql`).
2. **Types regen after the migration (once):**
   ```bash
   node -e "require('dotenv').config({path:'.env.local'}); fetch('https://api.supabase.com/v1/projects/actqtzoxjilqnldnacqz/types/typescript',{headers:{Authorization:'Bearer '+(process.env.SUPABASE_ACCESS_TOKEN||'').trim()}}).then(r=>r.json()).then(o=>require('fs').writeFileSync('packages/types/database.ts',o.types))"
   node scripts/strip-view-fk-entries.mjs
   ```
3. **Implementer agents run ONLY `pnpm check-types`** (read real stdout). The controller runs the per-batch gate chain: check-types → lint → forbidden-patterns (via Git-Bash/Bash tool — PowerShell `bash` resolves to a broken WSL) → `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` (background, never pipe through `Select-Object`). Controller commits + pushes after review.
4. Server actions: `ActionResult` or the file's local `{success,error?}` idiom; never throw; `const op='[fn]'` logging; attribution via `getCurrentEmployeeId()`.
5. No new `as any` on tables/RPCs that exist in regenerated types.
6. Read every modified file in full before editing; line numbers below are anchors, match on content.

## Batches

| Batch | Tasks | Commit |
|---|---|---|
| B1 | 1–6 (mig 177 · projects: year/delete/search · combobox upgrade · tasks: milestone picker + log removal) | `feat(projects): batch2 B1 — FY filter, soft delete, project auto-search + typeahead, /tasks milestone picker, log column removal (mig 177)` |
| B2 | 7–10 (activities polish + custom stage · tickets · AMC · price-book managed lists) | `feat(erp): batch2 B2 — activities polish + custom stage, ticket/AMC project search, price-book managed categories+units` |
| B3 | 11 (docs + final verification incl. full vitest) | `docs: record project feedback batch 2` |

---

### Task 1: Migration 177

**Files:** Create `supabase/migrations/177_2026-06-11-feedback-batch2.sql`; regen `packages/types/database.ts`.

- [ ] **Step 1.1** Before writing the seed, collect existing units on dev via `execute_sql`:
```sql
SELECT DISTINCT unit FROM price_book WHERE unit IS NOT NULL
UNION SELECT DISTINCT unit FROM project_boq_items WHERE unit IS NOT NULL ORDER BY 1;
```
Use the result to extend the seed list below (append any value not already present, keeping its exact casing).

- [ ] **Step 1.2** Write the migration:

```sql
-- =============================================================================
-- Migration 177 — feedback batch 2 (2026-06-11)
-- 1) projects.deleted_by (soft-delete audit; deleted_at exists since 004a)
-- 2) search_projects_lite RPC (typeahead + injection-safe list search)
-- 3) project_activities.stage_custom (free-text stage; master list untouched)
-- 4) item_categories + item_units managed lists (expense_categories pattern);
--    price_book CHECK → FK (fixes the broken legacy CATEGORY_OPTIONS bug)
-- =============================================================================

-- ── 1. Soft-delete audit ─────────────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES employees(id);

-- ── 2. Project search RPC ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_projects_lite(p_query TEXT DEFAULT NULL, p_limit INT DEFAULT 12)
RETURNS TABLE (
  id             UUID,
  project_number TEXT,
  customer_name  TEXT,
  project_name   TEXT,
  status         TEXT,
  order_date     TEXT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.id, p.project_number, p.customer_name, p.project_name,
         p.status::text, p.order_date::text
  FROM projects p
  WHERE p.deleted_at IS NULL
    AND (
      p_query IS NULL OR btrim(p_query) = '' OR
      p.customer_name  ILIKE '%' || p_query || '%' OR
      p.project_name   ILIKE '%' || p_query || '%' OR
      p.project_number ILIKE '%' || p_query || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 500);
$$;

REVOKE ALL ON FUNCTION search_projects_lite(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION search_projects_lite(TEXT, INT) TO authenticated;

-- ── 3. Activities custom stage ───────────────────────────────────────────────
ALTER TABLE project_activities ADD COLUMN IF NOT EXISTS stage_custom TEXT;

-- ── 4. Managed item categories + units ───────────────────────────────────────
CREATE TABLE item_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value      TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO item_categories (value, label, sort_order) VALUES
  ('solar_panels',        'Solar Panels',          10),
  ('inverter',            'Inverter',              20),
  ('battery',             'Battery',               30),
  ('mms',                 'MMS (Structure)',       40),
  ('dc_accessories',      'DC Accessories',        50),
  ('ac_accessories',      'AC Accessories',        60),
  ('conduits',            'Conduits',              70),
  ('earthing_accessories','Earthing Accessories',  80),
  ('safety_accessories',  'Safety Accessories',    90),
  ('generation_meter',    'Generation Meter',     100),
  ('ic',                  'IC (Installation & Commissioning)', 110),
  ('statutory_approvals', 'Statutory Approvals',  120),
  ('transport_civil',     'Transport & Civil',    130),
  ('miscellaneous',       'Miscellaneous',        140),
  ('others',              'Others',               150);

CREATE TABLE item_units (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value      TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vivek's canonical list first, then every distinct unit found in Step 1.1
-- that isn't already covered (exact casing) appended with sort_order 200.
INSERT INTO item_units (value, sort_order) VALUES
  ('Nos', 10), ('No', 20), ('KWp', 30), ('Kg', 40), ('Set', 50), ('Meter', 60),
  ('Packet', 70), ('Wp', 80), ('Lot', 90), ('Box', 100), ('Length', 110)
ON CONFLICT (value) DO NOTHING;
-- >>> APPEND here: INSERT … VALUES ('<each extra unit from Step 1.1>', 200) ON CONFLICT DO NOTHING;

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_categories_read" ON item_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "item_units_read"      ON item_units      FOR SELECT TO authenticated USING (true);
CREATE POLICY "item_categories_write" ON item_categories FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));
CREATE POLICY "item_categories_update" ON item_categories FOR UPDATE TO authenticated
  USING (get_my_role() IN ('founder','project_manager','purchase_officer'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));
CREATE POLICY "item_units_write" ON item_units FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));
CREATE POLICY "item_units_update" ON item_units FOR UPDATE TO authenticated
  USING (get_my_role() IN ('founder','project_manager','purchase_officer'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));

-- price_book: CHECK → FK (existing rows are Manivel-15-clean per mig 057)
ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_fkey
  FOREIGN KEY (item_category) REFERENCES item_categories(value);
```

- [ ] **Step 1.3** Apply to dev; verify: `SELECT count(*) FROM item_categories;` (15), `SELECT count(*) FROM item_units;` (≥11), `SELECT search_projects_lite('a', 3);` returns rows, `SELECT conname FROM pg_constraint WHERE conrelid='price_book'::regclass AND contype='f';` includes the new FK. Regen types (ground rule 2) + `pnpm check-types`.

### Task 2: Projects — FY filter + soft delete + getProject guard

**Files:** Modify `apps/erp/src/lib/projects-queries.ts`, `apps/erp/src/lib/project-detail-actions.ts`, `apps/erp/src/app/(erp)/projects/page.tsx`; Create `apps/erp/src/components/projects/detail/delete-project-card.tsx`; Modify `apps/erp/src/app/(erp)/projects/[id]/page.tsx` (render the card).

- [ ] **2.1 getProjects**: add `fy?: string` to its filters type; after the status filter insert:
```ts
  if (filters.fy && /^\d{4}-\d{2}$/.test(filters.fy)) {
    const startYear = parseInt(filters.fy.slice(0, 4), 10);
    const fyFrom = `${startYear}-04-01`;
    const fyTo = `${startYear + 1}-04-01`;
    // Internally generated dates — safe to interpolate (not user text).
    query = query.or(
      `and(order_date.gte.${fyFrom},order_date.lt.${fyTo}),and(order_date.is.null,created_at.gte.${fyFrom},created_at.lt.${fyTo})`,
    );
  }
```
- [ ] **2.2 page.tsx**: add `year?: string` to searchParams; pass `fy: params.year` into the query filters; in the FilterBar add (next to the status FilterSelect, matching its existing API — read how `FilterSelect` is used at lines 74-79):
```tsx
<FilterSelect paramName="year" placeholder="All years"
  options={fyOptions.map((fy) => ({ value: fy, label: `FY ${fy}` }))} />
```
with, above the return:
```ts
const currentFyStart = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const fyOptions: string[] = [];
for (let y = currentFyStart; y >= 2014; y--) fyOptions.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
```
Add `'year'` to the FilterBar's `filterParams` array. (If `FilterSelect`'s prop names differ, match its real signature — read the component.)
- [ ] **2.3 getProject guard**: in `projects-queries.ts`, find the single-project fetch (`getProject`) and add `.is('deleted_at', null)` to it.
- [ ] **2.4 deleteProject action** — append to `project-detail-actions.ts`:
```ts
const PROJECT_DELETE_ROLES = new Set<string>(['founder', 'project_manager']);

/**
 * Soft delete (deleted_at + deleted_by). Hard delete is impossible anyway —
 * a dozen RESTRICT FKs (invoices, payments, POs…) reference projects.
 * Restore is DB-only by design (2026-06-11 spec).
 */
export async function deleteProject(input: {
  projectId: string;
  confirmNumber: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteProject]';
  const { role } = await getCallerRole();
  if (!role || !PROJECT_DELETE_ROLES.has(role)) {
    return { success: false, error: 'Only Project Managers and Founders can delete projects.' };
  }
  const supabase = await createClient();
  const { data: project, error: readErr } = await supabase
    .from('projects')
    .select('project_number, deleted_at')
    .eq('id', input.projectId)
    .maybeSingle();
  if (readErr || !project) return { success: false, error: readErr?.message ?? 'Project not found' };
  if (project.deleted_at) return { success: false, error: 'Project is already deleted.' };
  if ((project.project_number ?? '') !== input.confirmNumber.trim()) {
    return { success: false, error: 'Confirmation text does not match the project number.' };
  }
  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', (await supabase.auth.getUser()).data.user?.id ?? '').maybeSingle();
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString(), deleted_by: employee?.id ?? null })
    .eq('id', input.projectId);
  if (error) {
    console.error(`${op} Soft delete failed:`, { code: error.code, message: error.message, projectId: input.projectId });
    return { success: false, error: error.message };
  }
  revalidatePath('/projects');
  return { success: true };
}
```
(Reuse the file's existing `getCallerRole`; if `getCurrentEmployeeId` from `./auth` is cleaner for the employee lookup, use it instead of the inline query.)
- [ ] **2.5 DeleteProjectCard** — create (client component):
```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, CardTitle, CardContent, Input } from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { deleteProject } from '@/lib/project-detail-actions';

export function DeleteProjectCard({ projectId, projectNumber }: { projectId: string; projectNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteProject({ projectId, confirmNumber: confirm });
    setBusy(false);
    if (result.success) router.push('/projects');
    else setError(result.error ?? 'Delete failed');
  }

  return (
    <Card className="border-red-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-red-700">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!open ? (
          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50"
            onClick={() => setOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Project
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-n-600">
              This hides the project everywhere (soft delete; restorable only via the database).
              Type <span className="font-mono font-semibold">{projectNumber}</span> to confirm.
            </p>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder={projectNumber} className="h-8 text-xs font-mono" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setOpen(false); setConfirm(''); setError(null); }} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDelete} disabled={busy || confirm.trim() !== projectNumber}>
                {busy ? 'Deleting…' : 'Delete permanently from lists'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```
- [ ] **2.6 Render it** in `[id]/page.tsx` details branch, right column after the Company & Project card, gated:
```tsx
{viewerRole && ['founder', 'project_manager'].includes(viewerRole) && (
  <DeleteProjectCard projectId={id} projectNumber={(project as any).project_number ?? ''} />
)}
```
(+ import.)

### Task 3: Project auto-search — RPC action, typeahead box, list-search swap

**Files:** Modify `apps/erp/src/lib/project-detail-actions.ts` (add `searchProjectsLite`), `apps/erp/src/lib/projects-queries.ts` (swap search), `apps/erp/src/app/(erp)/projects/page.tsx` (use the box); Create `apps/erp/src/components/projects/projects-search-box.tsx`.

- [ ] **3.1 Action** (mirrors `searchContactsLite` in the same file):
```ts
export interface ProjectSearchHit {
  id: string;
  project_number: string | null;
  customer_name: string | null;
  project_name: string | null;
}

export async function searchProjectsLite(query: string): Promise<ProjectSearchHit[]> {
  const op = '[searchProjectsLite]';
  const supabase = await createClient();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await supabase.rpc('search_projects_lite', {
    p_query: trimmed,
    p_limit: 8,
  });
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((r: { id: string; project_number: string | null; customer_name: string | null; project_name: string | null }) => ({
    id: r.id, project_number: r.project_number, customer_name: r.customer_name, project_name: r.project_name,
  }));
}
```
- [ ] **3.2 getProjects search swap** — replace lines 49-52 (`sanitizeForIlike` + `.or`) with:
```ts
  if (filters.search) {
    // Injection-safe: resolve matching ids via RPC, then filter by id.
    // Also makes project_name searchable (spec 2026-06-11 #3).
    const { data: hits, error: searchErr } = await supabase.rpc('search_projects_lite', {
      p_query: filters.search.trim(),
      p_limit: 500,
    });
    if (searchErr) {
      console.error(`${op} search RPC failed:`, { code: searchErr.code, message: searchErr.message });
    }
    const ids = (hits ?? []).map((h: { id: string }) => h.id);
    if (ids.length === 0) {
      return { data: [], total: 0, page, pageSize, totalPages: 0 };
    }
    query = query.in('id', ids);
  }
```
Remove the `sanitizeForIlike` import from this file IF it has no other usage here (grep within the file first).
- [ ] **3.3 ProjectsSearchBox** — create (client). Read the existing `SearchInput` component (imported by projects/page.tsx) first and mirror its debounced URL-param behavior exactly; then add the dropdown:
```tsx
'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { searchProjectsLite, type ProjectSearchHit } from '@/lib/project-detail-actions';

/**
 * Projects list search: keeps the ?search= URL-filter behavior (debounced,
 * like SearchInput) AND shows typeahead suggestions "Customer – Project Name"
 * that navigate straight to the project (spec 2026-06-11 #3).
 */
export function ProjectsSearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(searchParams.get('search') ?? '');
  const [hits, setHits] = React.useState<ProjectSearchHit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const urlTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rpcTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushUrl(next: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next) sp.set('search', next); else sp.delete('search');
    sp.delete('page');
    router.replace(sp.toString() ? `/projects?${sp.toString()}` : '/projects');
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    setHighlighted(-1);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => pushUrl(next), 350);
    if (rpcTimer.current) clearTimeout(rpcTimer.current);
    if (next.trim().length >= 2) {
      rpcTimer.current = setTimeout(async () => {
        const results = await searchProjectsLite(next);
        setHits(results);
        setOpen(true);
      }, 250);
    } else {
      setHits([]);
      setOpen(false);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      setOpen(false);
      router.push(`/projects/${hits[highlighted].id}`);
    } else if (e.key === 'Escape') { setOpen(false); setHighlighted(-1); }
  }

  return (
    <div ref={containerRef} className="relative w-64">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (hits.length > 0) setOpen(true); }}
        placeholder="Search customer, project name or number…"
        autoComplete="off"
        className="w-full h-9 pl-8 pr-3 border border-n-300 rounded-md bg-white text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
      />
      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-[22rem] rounded-md border border-n-200 bg-white shadow-md max-h-72 overflow-y-auto">
          <ul role="listbox">
            {hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === highlighted}
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); router.push(`/projects/${h.id}`); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none ${
                  i === highlighted ? 'bg-n-100 text-n-900' : 'text-n-700'
                }`}>
                <span className="truncate text-sm">
                  {h.customer_name ?? '—'}{h.project_name ? ` – ${h.project_name}` : ''}
                </span>
                {h.project_number && (
                  <span className="ml-2 text-[10px] text-n-400 flex-shrink-0 font-mono">{h.project_number}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```
- [ ] **3.4** In projects/page.tsx replace the `SearchInput` usage with `<ProjectsSearchBox />` (+ import; drop the SearchInput import if now unused).

### Task 4: ProjectCombobox upgrade + caller selects

**Files:** Modify `apps/erp/src/components/forms/project-combobox.tsx` + the data suppliers: `apps/erp/src/app/(erp)/expenses/page.tsx`, `apps/erp/src/lib/project-activities-queries.ts` (`getProjectOptionsForActivities`), the OM suppliers feeding `project-filter-combobox.tsx` / `create-plant-monitoring-dialog.tsx` / `add-inverter-dialog.tsx` (find each component's `projects` prop source and extend its select), `apps/erp/src/lib/amc-actions.ts` (`getCommissionedProjects`, `getAllProjectsForAmc`), and the tickets page's projects fetch.

- [ ] **4.1 Combobox**: `ProjectOpt` gains `project_name?: string | null`. Filter adds `(p.project_name?.toLowerCase().includes(lower) ?? false)`. Display: replace the two `{project.customer_name}` renders (selected display + option row) with `` `${p.customer_name}${p.project_name ? ' – ' + p.project_name : ''}` `` (option row keeps the number badge on the right; the input display uses the same combined string).
- [ ] **4.2** For EACH supplier listed above: add `project_name` to its `.select('…')` string and pass it through its mapping (where a mapping narrows fields). Where a list feeds the combobox with only `customer_name` (AMC), also add `project_number`. `pnpm check-types` will catch misses.

### Task 5: /tasks — milestone picker

**Files:** Modify `apps/erp/src/lib/tasks-actions.ts` (`createTask` + new `getProjectMilestonesLite`), `apps/erp/src/components/tasks/create-task-dialog.tsx`.

- [ ] **5.1** In tasks-actions.ts add:
```ts
export async function getProjectMilestonesLite(
  projectId: string,
): Promise<{ id: string; milestone_name: string }[]> {
  const op = '[getProjectMilestonesLite]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_milestones')
    .select('id, milestone_name')
    .eq('project_id', projectId)
    .order('milestone_order', { ascending: true });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    return [];
  }
  return data ?? [];
}
```
and extend `createTask`'s input with `milestoneId?: string` → insert `milestone_id: input.milestoneId ?? null`.
- [ ] **5.2** In create-task-dialog.tsx: add state `const [milestoneId, setMilestoneId] = useState(''); const [milestones, setMilestones] = useState<{ id: string; milestone_name: string }[]>([]);`. When the project select changes, `setMilestoneId('')` and (if a project is chosen) `getProjectMilestonesLite(projectId).then(setMilestones)`. Render below the project field, only when `milestones.length > 0`:
```tsx
<div>
  <Label>Milestone (optional)</Label>
  <Select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
    <option value="">— No milestone —</option>
    {milestones.map((m) => (
      <option key={m.id} value={m.id}>{m.milestone_name.replace(/_/g, ' ')}</option>
    ))}
  </Select>
</div>
```
Pass `milestoneId: milestoneId || undefined` into the `createTask` call. Reset both states on dialog close.
- [ ] **5.3 Verification (controller or agent via execute_sql on dev):** `SELECT count(*) FROM tasks WHERE entity_type='project' AND entity_id IS NOT NULL AND project_id IS NULL AND deleted_at IS NULL;` → record N (these are the rows only the 2026-06-11 hardening surfaces). Record the number for the close-out report.

### Task 6: /tasks — remove the Log column (decision: this surface ONLY)

**Files:** Modify `apps/erp/src/app/(erp)/tasks/page.tsx` (drop the `Log` `<th>` ~line 153), `apps/erp/src/components/tasks/tasks-table.tsx` (drop: expansion state/handlers ~34-54, the Log `<td>` ~140-149, the expanded row ~172-184, and the whole `ActivityLogPanel` component ~194-271 + its now-unused imports).

- [ ] **6.1** Make the edits; KEEP `ActivityLogCell` (execution), `TaskWorkLog` + the Work Log card on `/tasks/[id]`, and all `task_work_logs` actions. `rg -n "ActivityLogPanel" apps/erp/src` must return zero after.

**— END OF B1: controller gates, commits, pushes. —**

### Task 7: Activities polish + custom stage

**Files:** Modify `apps/erp/src/lib/project-activities-constants.ts`, `project-activities-queries.ts`, `project-activities-actions.ts`, `apps/erp/src/components/projects/activities/activities-client.tsx`, `activity-form-dialog.tsx`, `apps/erp/src/app/(erp)/activities/page.tsx`.

- [ ] **7.1 Constants**: `ProjectActivityRow` gains `stage_custom: string | null;` and `project_display: string | null;` (project_name ?? customer_name).
- [ ] **7.2 Queries** (`listProjectActivities`): select adds `stage_custom`; row mapping adds
```ts
      stage_custom: r.stage_custom ?? null,
      project_display: project ? (project.project_name ?? project.customer_name ?? null) : null,
```
- [ ] **7.3 Actions**: `ActivityInput` gains `stageCustom: string | null;`. `validate` unchanged. Both insert and update payloads add `stage_custom: input.data.stageCustom?.trim() || null` and keep `stage_id: input.data.stageId` — with the rule enforced in the action: if `stageId` is set, force `stage_custom: null`; if `stageCustom` is set, force `stage_id: null`.
- [ ] **7.4 Dialog** (`activity-form-dialog.tsx`):
  - New props: `projects?: { id: string; project_number: string | null; customer_name: string; project_name?: string | null }[]` and make `projectId` optional (`projectId?: string`). When `projectId` is absent and `projects` provided, render a required `ProjectCombobox` row at the top (import from `@/components/forms/project-combobox`); keep chosen id in state `pickedProjectId`; submit uses `projectId ?? pickedProjectId`; validate it's set ("Pick a project").
  - Stage select gains a final option `<option value="__custom__">Other (type below)…</option>`. New state `stageCustom` (init `existing?.stage_custom ?? ''`; if `existing` has stage_custom and no stage_id, init the select to `'__custom__'`). When select is `'__custom__'`, render `<Input value={stageCustom} … placeholder="Custom stage name" />` below. Submit maps: `stageId: stageId && stageId !== '__custom__' ? stageId : null`, `stageCustom: stageId === '__custom__' ? stageCustom || null : null`.
- [ ] **7.5 Tables** (`activities-client.tsx`):
  - Stage cell: `{r.stage_label ?? r.stage_custom ?? '—'}`.
  - Project cell (global view): render `{r.project_display ?? '—'}` as the link text; DELETE the small project_number sub-line.
  - Word wrap: Description cell → remove the `truncate block` span; use `<span className="whitespace-normal break-words">{r.description}</span>` and drop the `max-w-[260px]` cap (keep a sane `max-w-[420px]`). Same change for Notes (`whitespace-normal break-words`, keep `max-w-[200px]`).
- [ ] **7.6 Global Add button** (`/activities/page.tsx`): in the header flex row add (canManage only):
```tsx
{canManage && (
  <ActivityFormDialog
    stages={stages}
    projects={projects}
    trigger={<Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Add Activity</Button>}
  />
)}
```
(+ imports `ActivityFormDialog`, `Button` from `@repo/ui`, `Plus` from lucide. The `projects` array on that page already exists for the filters.)

### Task 8: Service tickets — drop Ticket # display + combobox

**Files:** Modify `apps/erp/src/app/(erp)/om/tickets/page.tsx` (th ~192, td ~222-224), the ticket DETAIL page (grep `ticket_number` under `app/(erp)/om/tickets/` and components — replace any displayed number with the ticket title), `DeleteTicketButton` (confirm text uses title or generic "this ticket"), `apps/erp/src/components/om/create-ticket-dialog.tsx` (Select → ProjectCombobox), plus the tickets page's projects fetch (add `project_name`).

- [ ] **8.1** Remove the "Ticket #" column (header + cell). Adjust the table's column count anywhere it matters (colSpan rows).
- [ ] **8.2** `rg -n "ticket_number" apps/erp/src/app apps/erp/src/components` — replace every *display* usage (keep generation in `service-ticket-actions.ts` and any internal keys). DeleteTicketButton: change its prop/label to use the ticket title.
- [ ] **8.3** create-ticket-dialog: replace the `<Select id="projectId">` block with:
```tsx
<ProjectCombobox
  projects={projects}
  value={projectId}
  onChange={setProjectId}
  placeholder="Search project by customer, name or number…"
/>
```
converting the form to controlled `projectId` state (it currently reads FormData — read the file; if it uses `name="projectId"` form submission, pass `name="projectId"` to ProjectCombobox instead, which renders a hidden input for FormData — that prop exists).

### Task 9: AMC — combobox

**Files:** Modify `apps/erp/src/components/om/create-amc-dialog.tsx`, `apps/erp/src/lib/amc-actions.ts` (selects in `getCommissionedProjects` + `getAllProjectsForAmc` gain `project_number, project_name`).

- [ ] **9.1** Replace the `<Select id="amc-project">` with `ProjectCombobox`, keeping: the `category`-driven source list (`free_amc` → commissionedProjects, else allProjects), and the commissioned-date autofill — adapt `handleProjectChange` to take the id from `onChange`:
```tsx
<ProjectCombobox
  projects={activeList}
  value={selectedProject}
  onChange={(id) => {
    setSelectedProject(id);
    const proj = activeList.find((p) => p.id === id);
    if (category === 'free_amc' && proj?.commissioned_date) setCommDate(proj.commissioned_date);
  }}
  placeholder="Search project…"
/>
```
where `activeList` is the existing conditional list mapped to `{ id, project_number, customer_name, project_name }` (commissioned_date kept alongside for the autofill lookup).

### Task 10: Price-book managed lists

**Files:** Create `apps/erp/src/lib/item-catalog-queries.ts`, `apps/erp/src/lib/item-catalog-actions.ts`, `apps/erp/src/app/(erp)/price-book/settings/page.tsx`, `apps/erp/src/components/price-book/catalog-admin.tsx`; Modify `apps/erp/src/components/price-book/add-price-book-item-dialog.tsx`, `edit-price-book-item-dialog.tsx`, the `/price-book` page (fetch lists + pass + "Manage lists" link), `apps/erp/src/lib/boi-constants.ts` (`getCategoryLabel` prettify fallback), `apps/erp/src/components/projects/forms/bom-line-form.tsx` + `boq-variance-form.tsx` (optional `categories`/`units` props w/ constant fallback), `step-bom.tsx` + `step-boq.tsx` (fetch + thread props).

- [ ] **10.1 Queries**:
```ts
import { createClient } from '@repo/supabase/server';

export interface ItemCategoryOpt { value: string; label: string; is_active: boolean; sort_order: number }
export interface ItemUnitOpt { value: string; is_active: boolean; sort_order: number }

export async function listItemCategories(activeOnly = true): Promise<ItemCategoryOpt[]> {
  const op = '[listItemCategories]';
  const supabase = await createClient();
  let q = supabase.from('item_categories').select('value, label, is_active, sort_order')
    .order('sort_order', { ascending: true }).order('label', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return []; }
  return data ?? [];
}

export async function listItemUnits(activeOnly = true): Promise<ItemUnitOpt[]> {
  const op = '[listItemUnits]';
  const supabase = await createClient();
  let q = supabase.from('item_units').select('value, is_active, sort_order')
    .order('sort_order', { ascending: true }).order('value', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return []; }
  return data ?? [];
}
```
- [ ] **10.2 Actions** (`'use server'`; gate `founder|project_manager|purchase_officer` via `getUserProfile`; ActionResult):
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';
import { err, ok, type ActionResult } from '@/lib/types/actions';

const CATALOG_ROLES = new Set<string>(['founder', 'project_manager', 'purchase_officer']);

async function requireCatalogRole(): Promise<ActionResult<true>> {
  const profile = await getUserProfile();
  if (!profile) return err('Not authenticated', 'UNAUTHENTICATED');
  if (!CATALOG_ROLES.has(profile.role)) return err('Not allowed to manage catalog lists.', 'FORBIDDEN');
  return ok(true);
}

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function revalidateCatalog() {
  revalidatePath('/price-book');
  revalidatePath('/price-book/settings');
}

export async function addItemCategory(input: { label: string }): Promise<ActionResult<{ value: string }>> {
  const op = '[addItemCategory]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const label = input.label.trim();
  if (!label) return err('Category label is required');
  const value = slugify(label);
  if (!value) return err('Category label must contain letters or numbers');
  const supabase = await createClient();
  const { error } = await supabase.from('item_categories').insert({ value, label });
  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message, value });
    return err(error.code === '23505' ? `Category "${label}" already exists.` : error.message, error.code);
  }
  revalidateCatalog();
  return ok({ value });
}

export async function addItemUnit(input: { value: string }): Promise<ActionResult<{ value: string }>> {
  const op = '[addItemUnit]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const value = input.value.trim();
  if (!value) return err('Unit is required');
  const supabase = await createClient();
  const { error } = await supabase.from('item_units').insert({ value });
  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message, value });
    return err(error.code === '23505' ? `Unit "${value}" already exists.` : error.message, error.code);
  }
  revalidateCatalog();
  return ok({ value });
}

export async function toggleItemCategoryActive(input: { value: string; isActive: boolean }): Promise<ActionResult> {
  const op = '[toggleItemCategoryActive]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from('item_categories').update({ is_active: input.isActive }).eq('value', input.value);
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return err(error.message, error.code); }
  revalidateCatalog();
  return ok(undefined as void);
}

export async function toggleItemUnitActive(input: { value: string; isActive: boolean }): Promise<ActionResult> {
  const op = '[toggleItemUnitActive]';
  const gate = await requireCatalogRole();
  if (!gate.success) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from('item_units').update({ is_active: input.isActive }).eq('value', input.value);
  if (error) { console.error(`${op} failed:`, { code: error.code, message: error.message }); return err(error.message, error.code); }
  revalidateCatalog();
  return ok(undefined as void);
}
```
- [ ] **10.3 Dialogs**: both price-book dialogs DELETE the local `CATEGORY_OPTIONS`/`UNIT_OPTIONS` arrays; props gain `categories: { value: string; label: string }[]`, `units: string[]`, `canManageLists: boolean`. Category/unit `<Select>`s map the props. When `canManageLists`, each select gets a final option `+ Add new category…` / `+ Add new unit…` (sentinel `'__add__'`) that swaps in an inline `<Input>` + Save/Cancel mini-row calling `addItemCategory`/`addItemUnit`; on success select the returned value and `router.refresh()`. The `/price-book` page fetches `listItemCategories()`, `listItemUnits()` + the viewer role, passes all three; the page header gains `<Link href="/price-book/settings">Manage lists</Link>` (Button variant ghost, canManageLists only).
- [ ] **10.4 Settings page** (`/price-book/settings/page.tsx`, server): `requireRole(['founder','project_manager','purchase_officer'])` (import from `@/lib/auth`); fetch BOTH lists with `activeOnly=false`; render `<CatalogAdmin categories={…} units={…} />`. `catalog-admin.tsx` (client): two Cards side by side — each lists rows (label/value, active toggle via the toggle actions + router.refresh) + an add-input row at the bottom calling the add actions. Match `/expenses/categories/page.tsx`'s structure (read it first) — same table styling, same toggle pattern.
- [ ] **10.5 BOI/BOQ threading**: `bom-line-form.tsx` and `boq-variance-form.tsx` components that render category/unit selects (`BomInlineAddRow`, `BoiInlineAddRow`, `BoiEditButton`, `BoqAddItemRow`, `BoqEditButton`) gain optional props `categories?: { value: string; label: string }[]` and `units?: string[]`, defaulting to the existing `BOI_CATEGORIES`/`UNITS`/`GST-local` constants when absent (`const cats = categories ?? BOI_CATEGORIES; const unitList = units ?? UNITS;`). `step-bom.tsx` and `step-boq.tsx` add `listItemCategories()` + `listItemUnits()` to their `Promise.all` and thread `categories={cats.map(c => ({ value: c.value, label: c.label }))}` / `units={unitList.map(u => u.value)}` into those components.
- [ ] **10.6 getCategoryLabel** (boi-constants.ts): unknown values return `value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())` instead of the raw value.

**— END OF B2: controller gates, commits, pushes. —**

### Task 11: Docs + final verification (B3)

- [ ] **11.1** Full gate chain + `pnpm vitest run` (expect fully green — the 4 proposal/handover failures were fixed in `8127e5c`).
- [ ] **11.2** `docs/CHANGELOG.md`: one June-2026 entry for the batch (mig 177; all 12 items; the price-book broken-CHECK bug fix; the injection-pattern removal in projects search).
- [ ] **11.3** `docs/CURRENT_STATUS.md`: prepend Last-updated entry with VIVEK ACTIONS (walk the new surfaces; note delete is DB-restore-only; note custom stages don't affect completion %).
- [ ] **11.4** `docs/modules/projects.md` (FY filter, delete, search, combobox), `docs/modules/om.md` (tickets #/combobox, AMC combobox), `docs/modules/purchase.md` or wherever price-book is documented (managed lists + settings page + fixed bug), `docs/modules/hr.md` not touched. Update the activities section in projects.md (custom stage, project-name column, global add).
- [ ] **11.5** Commit + push.

---

## Plan self-review record

- **Spec coverage:** #1→T2.1/2.2 · #2→T2.3-2.6 · #3→T3+T4 · #4→T5 (+5.3 verification) · #5→T7 · #6→T6 · #7/#8→T8 (8 verified-no-op for created date) · #9→T8.3 · #10→T9 · #11/#12→T1.4+T10 · docs→T11.
- **Type consistency:** `ProjectSearchHit` defined T3.1, consumed T3.3; `ActivityInput.stageCustom` T7.3 ↔ dialog T7.4; catalog props `{value,label}[]`/`string[]` consistent across T10.3/10.5; `search_projects_lite` returns TEXT status/order_date (casts in RPC) so no enum mismatch in generated types.
- **Known intentional choices:** `.or()` with internally-generated FY dates is safe (not user input); `sanitizeForIlike` stays in the other five PR-#7 sites; ticket_number stays in schema; task_work_logs untouched.
