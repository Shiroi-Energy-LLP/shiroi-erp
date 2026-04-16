# Plant Monitoring Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/om/plant-monitoring` page that centralises solar plant monitoring-portal credentials, auto-populated from commissioning reports and editable by founder + project_manager.

**Architecture:** New `plant_monitoring_credentials` table with AFTER UPDATE trigger on `commissioning_reports` that upserts credentials on status transition to submitted/finalized. RLS-gated server actions returning `ActionResult<T>`. Standard list page with sticky filter bar, 7-column table, per-row masked password cell, Add/Edit/Delete dialogs.

**Tech Stack:** Next.js 14 App Router, Supabase Postgres (migrations + RLS + plpgsql), TypeScript strict, `@repo/ui` component kit, Playwright smoke tests.

**Spec:** [docs/superpowers/specs/2026-04-16-plant-monitoring-design.md](../specs/2026-04-16-plant-monitoring-design.md)

---

## File Structure

**Created:**
- `supabase/migrations/058_plant_monitoring.sql` — table + indexes + brand-detection function + trigger + RLS + summary RPC
- `apps/erp/src/lib/plant-monitoring-queries.ts` — `listPlantMonitoringCredentials`, `getProjectsWithCredentials`, `getPlantMonitoringSummary`
- `apps/erp/src/lib/plant-monitoring-actions.ts` — `createPlantMonitoringCredential`, `updatePlantMonitoringCredential`, `softDeletePlantMonitoringCredential`
- `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx` — server list page
- `apps/erp/src/app/(erp)/om/plant-monitoring/loading.tsx` — skeleton
- `apps/erp/src/components/om/plant-monitoring-password-cell.tsx` — client, eye toggle + 30s re-mask + copy
- `apps/erp/src/components/om/create-plant-monitoring-dialog.tsx` — client, Add modal
- `apps/erp/src/components/om/edit-plant-monitoring-dialog.tsx` — client, Edit modal
- `apps/erp/src/components/om/delete-plant-monitoring-button.tsx` — client, confirm soft-delete

**Modified:**
- `apps/erp/src/lib/roles.ts` — add `plantMonitoring` to `ITEMS`, wire into O&M sections for founder / project_manager / om_technician
- `apps/erp/src/components/sidebar.tsx` — add `Activity` to lucide imports + ICON_MAP
- `packages/types/database.ts` — regenerated after migration
- `apps/erp/e2e/smoke.spec.ts` — add `/om/plant-monitoring` smoke test

---

## Task 1 — Migration 058: DB schema, trigger, RLS, summary RPC

**Files:**
- Create: `supabase/migrations/058_plant_monitoring.sql`

- [ ] **Step 1.1: Write the migration SQL**

Create `supabase/migrations/058_plant_monitoring.sql`:

```sql
-- Migration 058: Plant Monitoring credentials
--
-- New module under O&M. Stores portal login credentials (URL, username, password)
-- for every solar plant. Auto-synced from commissioning_reports via an AFTER
-- UPDATE trigger that fires on status transition to 'submitted' or 'finalized'.
--
-- Design spec: docs/superpowers/specs/2026-04-16-plant-monitoring-design.md

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Brand-detection helper (used by trigger and by server actions)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.plant_monitoring_detect_brand(portal_url TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN portal_url IS NULL THEN NULL
    WHEN lower(portal_url) LIKE '%isolarcloud%' THEN 'sungrow'
    WHEN lower(portal_url) LIKE '%growatt%' THEN 'growatt'
    WHEN lower(portal_url) LIKE '%sunnyportal%' OR lower(portal_url) LIKE '%sma-%' OR lower(portal_url) LIKE '%ennexos%' THEN 'sma'
    WHEN lower(portal_url) LIKE '%fusionsolar%' OR lower(portal_url) LIKE '%huawei%' THEN 'huawei'
    WHEN lower(portal_url) LIKE '%fronius%' OR lower(portal_url) LIKE '%solarweb%' THEN 'fronius'
    WHEN lower(portal_url) LIKE '%soliscloud%' OR lower(portal_url) LIKE '%solis%' THEN 'solis'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION public.plant_monitoring_detect_brand(TEXT)
  IS 'Classify a monitoring portal URL into one of: sungrow, growatt, sma, huawei, fronius, solis, other. Used by trigger + server actions so classification is consistent.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. plant_monitoring_credentials table
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.plant_monitoring_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  commissioning_report_id UUID REFERENCES public.commissioning_reports(id) ON DELETE SET NULL,

  inverter_brand TEXT CHECK (inverter_brand IN (
    'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis', 'other'
  )),

  portal_url TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.employees(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.plant_monitoring_credentials
  IS 'Centralised portal credentials for every commissioned solar plant. Auto-populated from commissioning_reports via trigger; manually editable by founder + project_manager.';

-- Unique: one active credential per (project, portal_url). Supports the
-- ON CONFLICT clause in the trigger and prevents duplicate auto-syncs.
CREATE UNIQUE INDEX IF NOT EXISTS plant_monitoring_credentials_unique_active
  ON public.plant_monitoring_credentials (project_id, portal_url)
  WHERE deleted_at IS NULL;

-- Query-path indexes (rule #17 — any filterable column gets an index)
CREATE INDEX IF NOT EXISTS plant_monitoring_credentials_project_idx
  ON public.plant_monitoring_credentials (project_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS plant_monitoring_credentials_created_at_idx
  ON public.plant_monitoring_credentials (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS plant_monitoring_credentials_brand_idx
  ON public.plant_monitoring_credentials (inverter_brand) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. updated_at trigger
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_plant_monitoring_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plant_monitoring_updated_at ON public.plant_monitoring_credentials;
CREATE TRIGGER trg_plant_monitoring_updated_at
  BEFORE UPDATE ON public.plant_monitoring_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_plant_monitoring_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Sync trigger from commissioning_reports
--    Fires on status transition to submitted or finalized, upserts on
--    (project_id, portal_url).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sync_plant_monitoring_from_commissioning()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_employee_id UUID;
BEGIN
  -- Only act when status newly transitions to submitted/finalized
  IF (NEW.status NOT IN ('submitted', 'finalized'))
     OR (NEW.status IS NOT DISTINCT FROM OLD.status) THEN
    RETURN NEW;
  END IF;

  -- All three fields required — ignore partial entries
  IF NEW.monitoring_portal_link IS NULL
     OR NEW.monitoring_login IS NULL
     OR NEW.monitoring_password IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map auth.uid() -> employees.id (same pattern as migration 055)
  SELECT id INTO v_employee_id
    FROM public.employees
    WHERE profile_id = auth.uid()
    LIMIT 1;

  INSERT INTO public.plant_monitoring_credentials (
    project_id, commissioning_report_id,
    portal_url, username, password,
    inverter_brand,
    created_by, updated_by
  )
  VALUES (
    NEW.project_id, NEW.id,
    NEW.monitoring_portal_link, NEW.monitoring_login, NEW.monitoring_password,
    public.plant_monitoring_detect_brand(NEW.monitoring_portal_link),
    v_employee_id, v_employee_id
  )
  ON CONFLICT (project_id, portal_url) WHERE deleted_at IS NULL
  DO UPDATE SET
    username = EXCLUDED.username,
    password = EXCLUDED.password,
    commissioning_report_id = EXCLUDED.commissioning_report_id,
    inverter_brand = EXCLUDED.inverter_brand,
    updated_by = EXCLUDED.created_by;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_plant_monitoring_from_commissioning ON public.commissioning_reports;
CREATE TRIGGER trg_sync_plant_monitoring_from_commissioning
  AFTER UPDATE OF status, monitoring_portal_link, monitoring_login, monitoring_password
  ON public.commissioning_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_plant_monitoring_from_commissioning();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Summary RPC (rule #12 — no JS aggregation)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_plant_monitoring_summary()
RETURNS TABLE (
  total_count BIGINT,
  brand_sungrow BIGINT,
  brand_growatt BIGINT,
  brand_sma BIGINT,
  brand_huawei BIGINT,
  brand_fronius BIGINT,
  brand_solis BIGINT,
  brand_other BIGINT,
  missing_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH creds AS (
    SELECT inverter_brand, project_id
    FROM public.plant_monitoring_credentials
    WHERE deleted_at IS NULL
  ),
  projects_with_finalized_commissioning AS (
    SELECT DISTINCT project_id
    FROM public.commissioning_reports
    WHERE status IN ('submitted', 'finalized')
      AND project_id IS NOT NULL
  ),
  projects_with_creds AS (
    SELECT DISTINCT project_id FROM creds
  )
  SELECT
    (SELECT COUNT(*) FROM creds)::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'sungrow')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'growatt')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'sma')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'huawei')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'fronius')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'solis')::BIGINT,
    (SELECT COUNT(*) FROM creds WHERE inverter_brand = 'other' OR inverter_brand IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM projects_with_finalized_commissioning p
      WHERE NOT EXISTS (SELECT 1 FROM projects_with_creds c WHERE c.project_id = p.project_id)
    )::BIGINT;
$$;

COMMENT ON FUNCTION public.get_plant_monitoring_summary()
  IS 'Returns aggregates for the Plant Monitoring summary cards: total count, per-brand counts, and count of projects with finalized commissioning but no credentials row.';

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Row-Level Security
--    Uses public.get_my_role() (STABLE SECURITY DEFINER) per migration 054.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.plant_monitoring_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plant_monitoring_select ON public.plant_monitoring_credentials;
CREATE POLICY plant_monitoring_select
  ON public.plant_monitoring_credentials
  FOR SELECT
  USING (
    public.get_my_role() = ANY (ARRAY['founder', 'project_manager', 'om_technician'])
  );

DROP POLICY IF EXISTS plant_monitoring_insert ON public.plant_monitoring_credentials;
CREATE POLICY plant_monitoring_insert
  ON public.plant_monitoring_credentials
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['founder', 'project_manager'])
  );

DROP POLICY IF EXISTS plant_monitoring_update ON public.plant_monitoring_credentials;
CREATE POLICY plant_monitoring_update
  ON public.plant_monitoring_credentials
  FOR UPDATE
  USING (
    public.get_my_role() = ANY (ARRAY['founder', 'project_manager'])
  );

-- No DELETE policy = physical deletes are blocked. We soft-delete via UPDATE.
```

- [ ] **Step 1.2: Apply migration to dev Supabase**

Use the Supabase MCP tool `mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__apply_migration`:

```
project_id: actqtzoxjilqnldnacqz
name: plant_monitoring
query: <contents of 058_plant_monitoring.sql>
```

Expected: migration applied successfully. If the migration fails due to an already-existing object, read the error, fix the SQL (typically by adding `IF NOT EXISTS` / `DROP IF EXISTS`), and re-apply.

- [ ] **Step 1.3: Verify via MCP execute_sql**

Run these checks via `mcp__7a8c9855-afca-4cdf-b7bb-3ea5d2c5ca01__execute_sql`:

```sql
-- 1. Table exists with expected columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'plant_monitoring_credentials'
ORDER BY ordinal_position;

-- 2. Indexes are in place
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'plant_monitoring_credentials';

-- 3. RLS is enabled and policies exist
SELECT polname, polcmd FROM pg_policy
WHERE polrelid = 'public.plant_monitoring_credentials'::regclass;

-- 4. Brand detection function works
SELECT
  public.plant_monitoring_detect_brand('https://isolarcloud.com/abc') AS sungrow,
  public.plant_monitoring_detect_brand('https://server.growatt.com/login') AS growatt,
  public.plant_monitoring_detect_brand('https://fusionsolar.huawei.com/') AS huawei,
  public.plant_monitoring_detect_brand('https://solarweb.com/') AS fronius,
  public.plant_monitoring_detect_brand('https://random-portal.com/login') AS other;

-- 5. Summary RPC executes (returns zeros on empty table)
SELECT * FROM public.get_plant_monitoring_summary();
```

Expected: all 5 queries return correct shapes. Brand function returns `sungrow`, `growatt`, `huawei`, `fronius`, `other`. Summary returns 0 for every count (table is empty).

- [ ] **Step 1.4: Regenerate TypeScript types**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp"
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

Expected: `packages/types/database.ts` updated. `git diff packages/types/database.ts | head -50` should show the new `plant_monitoring_credentials` row type and `plant_monitoring_detect_brand` / `get_plant_monitoring_summary` function signatures.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/058_plant_monitoring.sql packages/types/database.ts
git commit -m "$(cat <<'EOF'
feat(db): migration 058 — plant_monitoring_credentials + trigger + summary RPC

New O&M module for centralised solar plant monitoring credentials.
Auto-sync from commissioning_reports via AFTER UPDATE trigger on
status transition to submitted/finalized. URL-based brand detection
helper. RLS: founder+project_manager full CRUD, om_technician read-only,
physical DELETE blocked.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Queries layer (`plant-monitoring-queries.ts`)

**Files:**
- Create: `apps/erp/src/lib/plant-monitoring-queries.ts`

- [ ] **Step 2.1: Write the queries module**

Create `apps/erp/src/lib/plant-monitoring-queries.ts`:

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type CredRow = Database['public']['Tables']['plant_monitoring_credentials']['Row'];
type ProjectLite = { id: string; customer_name: string; project_number: string | null };

export type PlantMonitoringCredential = CredRow & {
  projects: ProjectLite | null;
};

// ═══════════════════════════════════════════════════════════════════════
// listPlantMonitoringCredentials — paginated, filtered
// ═══════════════════════════════════════════════════════════════════════

export interface ListFilters {
  project_id?: string;
  brand?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export async function listPlantMonitoringCredentials(
  filters: ListFilters,
): Promise<{ items: PlantMonitoringCredential[]; total: number }> {
  const op = '[listPlantMonitoringCredentials]';
  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 50;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const supabase = await createClient();

  let query = supabase
    .from('plant_monitoring_credentials')
    .select(
      'id, project_id, commissioning_report_id, inverter_brand, portal_url, username, password, notes, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, projects!plant_monitoring_credentials_project_id_fkey(id, customer_name, project_number)',
      { count: 'estimated' },
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (filters.project_id) {
    query = query.eq('project_id', filters.project_id);
  }

  if (filters.brand) {
    query = query.eq('inverter_brand', filters.brand);
  }

  if (filters.search && filters.search.trim().length > 0) {
    const term = filters.search.trim();
    // Search username and notes. Project-name search is handled via the
    // project_id filter (user selects a project from the dropdown).
    query = query.or(`username.ilike.%${term}%,notes.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { items: [], total: 0 };
  }

  return {
    items: (data ?? []) as unknown as PlantMonitoringCredential[],
    total: count ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// getProjectsWithCredentials — for the filter dropdown
// ═══════════════════════════════════════════════════════════════════════

type CredWithProject = {
  project_id: string | null;
  projects: ProjectLite | null;
};

export async function getProjectsWithCredentials(): Promise<ProjectLite[]> {
  const op = '[getProjectsWithCredentials]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .select('project_id, projects!plant_monitoring_credentials_project_id_fkey(id, customer_name, project_number)')
    .is('deleted_at', null)
    .not('project_id', 'is', null)
    .limit(500)
    .returns<CredWithProject[]>();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  const seen = new Set<string>();
  const result: ProjectLite[] = [];
  for (const row of data ?? []) {
    const p = row.projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({
        id: p.id,
        customer_name: p.customer_name ?? '',
        project_number: p.project_number ?? null,
      });
    }
  }
  return result.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}

// ═══════════════════════════════════════════════════════════════════════
// getAllActiveProjects — used by the Add dialog's project picker
// ═══════════════════════════════════════════════════════════════════════

export async function getAllActiveProjects(): Promise<ProjectLite[]> {
  const op = '[getAllActiveProjects]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id, customer_name, project_number')
    .order('customer_name', { ascending: true })
    .limit(1000);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    customer_name: p.customer_name ?? '',
    project_number: p.project_number ?? null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// getPlantMonitoringSummary — wraps the summary RPC
// ═══════════════════════════════════════════════════════════════════════

export interface MonitoringSummary {
  total: number;
  brands: Record<string, number>;
  missing: number;
}

export async function getPlantMonitoringSummary(): Promise<MonitoringSummary> {
  const op = '[getPlantMonitoringSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_plant_monitoring_summary');

  if (error || !data) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    return { total: 0, brands: {}, missing: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { total: 0, brands: {}, missing: 0 };
  }

  return {
    total: Number(row.total_count ?? 0),
    brands: {
      sungrow: Number(row.brand_sungrow ?? 0),
      growatt: Number(row.brand_growatt ?? 0),
      sma: Number(row.brand_sma ?? 0),
      huawei: Number(row.brand_huawei ?? 0),
      fronius: Number(row.brand_fronius ?? 0),
      solis: Number(row.brand_solis ?? 0),
      other: Number(row.brand_other ?? 0),
    },
    missing: Number(row.missing_count ?? 0),
  };
}
```

- [ ] **Step 2.2: Type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors. If `plant_monitoring_credentials` is missing from `Database['public']['Tables']`, the types were not regenerated — go back and complete Task 1 Step 1.4.

- [ ] **Step 2.3: Commit**

```bash
git add apps/erp/src/lib/plant-monitoring-queries.ts
git commit -m "$(cat <<'EOF'
feat(plant-monitoring): queries layer

List + filter-dropdown + summary RPC wrapper. Typed rows, count:estimated,
no JS aggregation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Actions layer (`plant-monitoring-actions.ts`)

**Files:**
- Create: `apps/erp/src/lib/plant-monitoring-actions.ts`

- [ ] **Step 3.1: Write the actions module**

Create `apps/erp/src/lib/plant-monitoring-actions.ts`:

```typescript
'use server';

import type { Database } from '@repo/types/database';
import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type CredRow = Database['public']['Tables']['plant_monitoring_credentials']['Row'];
type CredInsert = Database['public']['Tables']['plant_monitoring_credentials']['Insert'];
type CredUpdate = Database['public']['Tables']['plant_monitoring_credentials']['Update'];

// ═══════════════════════════════════════════════════════════════════════
// Helper — look up current employee.id from auth.uid()
// ═══════════════════════════════════════════════════════════════════════

async function getCurrentEmployeeId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  return data?.id ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
// createPlantMonitoringCredential
// ═══════════════════════════════════════════════════════════════════════

export async function createPlantMonitoringCredential(input: {
  project_id: string;
  portal_url: string;
  username: string;
  password: string;
  notes?: string | null;
}): Promise<ActionResult<CredRow>> {
  const op = '[createPlantMonitoringCredential]';

  if (!input.project_id) return err('Project is required');
  if (!input.portal_url?.trim()) return err('Portal URL is required');
  if (!input.username?.trim()) return err('Username is required');
  if (!input.password?.trim()) return err('Password is required');

  const supabase = await createClient();
  const employeeId = await getCurrentEmployeeId();

  // Compute brand server-side via the same helper the trigger uses
  const { data: brandRow, error: brandErr } = await supabase.rpc(
    'plant_monitoring_detect_brand' as never,
    { portal_url: input.portal_url } as never,
  );

  // Fall back to 'other' if the RPC isn't yet in the generated types or
  // returns unexpectedly — the CHECK constraint allows it.
  const brand = (!brandErr && typeof brandRow === 'string' ? brandRow : 'other') as string;

  const insert: CredInsert = {
    project_id: input.project_id,
    portal_url: input.portal_url.trim(),
    username: input.username.trim(),
    password: input.password,
    notes: input.notes?.trim() || null,
    inverter_brand: brand,
    created_by: employeeId,
    updated_by: employeeId,
  };

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .insert(insert)
    .select()
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return err('A credential for this project and URL already exists', error.code);
    }
    return err(error?.message ?? 'Failed to create credential', error?.code);
  }

  revalidatePath('/om/plant-monitoring');
  return ok(data);
}

// ═══════════════════════════════════════════════════════════════════════
// updatePlantMonitoringCredential
// ═══════════════════════════════════════════════════════════════════════

export async function updatePlantMonitoringCredential(
  id: string,
  patch: {
    portal_url?: string;
    username?: string;
    password?: string;
    notes?: string | null;
  },
): Promise<ActionResult<CredRow>> {
  const op = '[updatePlantMonitoringCredential]';

  if (!id) return err('Credential id is required');

  const supabase = await createClient();
  const employeeId = await getCurrentEmployeeId();

  const update: CredUpdate = {
    updated_by: employeeId,
  };

  if (patch.portal_url !== undefined) {
    const trimmed = patch.portal_url.trim();
    if (!trimmed) return err('Portal URL cannot be empty');
    update.portal_url = trimmed;

    // Recompute brand when URL changes
    const { data: brandRow, error: brandErr } = await supabase.rpc(
      'plant_monitoring_detect_brand' as never,
      { portal_url: trimmed } as never,
    );
    if (!brandErr && typeof brandRow === 'string') {
      update.inverter_brand = brandRow;
    }
  }

  if (patch.username !== undefined) {
    const trimmed = patch.username.trim();
    if (!trimmed) return err('Username cannot be empty');
    update.username = trimmed;
  }

  if (patch.password !== undefined) {
    if (!patch.password) return err('Password cannot be empty');
    update.password = patch.password;
  }

  if (patch.notes !== undefined) {
    update.notes = patch.notes?.trim() || null;
  }

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { id, code: error?.code, message: error?.message });
    if (error?.code === '23505') {
      return err('Another credential for this project already uses this URL', error.code);
    }
    return err(error?.message ?? 'Failed to update credential', error?.code);
  }

  revalidatePath('/om/plant-monitoring');
  return ok(data);
}

// ═══════════════════════════════════════════════════════════════════════
// softDeletePlantMonitoringCredential
// ═══════════════════════════════════════════════════════════════════════

export async function softDeletePlantMonitoringCredential(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const op = '[softDeletePlantMonitoringCredential]';

  if (!id) return err('Credential id is required');

  const supabase = await createClient();
  const employeeId = await getCurrentEmployeeId();

  const { data, error } = await supabase
    .from('plant_monitoring_credentials')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: employeeId,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error || !data) {
    console.error(`${op} Failed:`, { id, code: error?.code, message: error?.message });
    return err(error?.message ?? 'Failed to delete credential', error?.code);
  }

  revalidatePath('/om/plant-monitoring');
  return ok({ id: data.id });
}
```

- [ ] **Step 3.2: Type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors.

Note: the `rpc('plant_monitoring_detect_brand' as never, ... as never)` casts are deliberate — some generated types don't include function-argument overloads cleanly, and this is the minimal escape hatch. This is ONE `as never` bounded to an RPC call signature, not a `as any` (rule #11). If the generated types include the overload cleanly, remove the casts.

- [ ] **Step 3.3: Commit**

```bash
git add apps/erp/src/lib/plant-monitoring-actions.ts
git commit -m "$(cat <<'EOF'
feat(plant-monitoring): server actions (create/update/softDelete)

ActionResult<T> return shape per rule #19. Server-side brand recomputation
on URL changes via plant_monitoring_detect_brand RPC. employees.id
lookup via profile_id=auth.uid() for created_by/updated_by/deleted_by.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Password cell component

**Files:**
- Create: `apps/erp/src/components/om/plant-monitoring-password-cell.tsx`

- [ ] **Step 4.1: Write the component**

Create `apps/erp/src/components/om/plant-monitoring-password-cell.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

const AUTO_REMASK_MS = 30_000;

interface PlantMonitoringPasswordCellProps {
  password: string;
}

export function PlantMonitoringPasswordCell({ password }: PlantMonitoringPasswordCellProps) {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto re-mask after 30s
  React.useEffect(() => {
    if (revealed) {
      timerRef.current = setTimeout(() => setRevealed(false), AUTO_REMASK_MS);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [revealed]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API failure (e.g. non-secure context) — silently ignore
    }
  }

  function handleToggle() {
    setRevealed((r) => !r);
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className={`font-mono text-[11px] ${revealed ? 'text-n-900' : 'text-n-500 tracking-widest'}`}>
        {revealed ? password : '••••••••'}
      </span>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        className="text-n-400 hover:text-n-700 transition-colors"
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      {revealed && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy password"
          className="text-n-400 hover:text-n-700 transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4.2: Type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors.

- [ ] **Step 4.3: Commit**

```bash
git add apps/erp/src/components/om/plant-monitoring-password-cell.tsx
git commit -m "$(cat <<'EOF'
feat(plant-monitoring): password cell with 30s auto re-mask + copy

Per-row eye toggle. Copy-to-clipboard visible only when revealed.
Cleanup on unmount to avoid dangling timers.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Create / Edit / Delete dialog components

**Files:**
- Create: `apps/erp/src/components/om/create-plant-monitoring-dialog.tsx`
- Create: `apps/erp/src/components/om/edit-plant-monitoring-dialog.tsx`
- Create: `apps/erp/src/components/om/delete-plant-monitoring-button.tsx`

- [ ] **Step 5.1: Create dialog component**

Create `apps/erp/src/components/om/create-plant-monitoring-dialog.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Textarea,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createPlantMonitoringCredential } from '@/lib/plant-monitoring-actions';

interface ProjectOpt {
  id: string;
  customer_name: string;
}

interface CreatePlantMonitoringDialogProps {
  projects: ProjectOpt[];
}

export function CreatePlantMonitoringDialog({ projects }: CreatePlantMonitoringDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await createPlantMonitoringCredential({
      project_id: String(form.get('project_id') ?? ''),
      portal_url: String(form.get('portal_url') ?? ''),
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
      notes: String(form.get('notes') ?? '') || null,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Credential
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Monitoring Credential</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="project_id">Project *</Label>
            <select
              id="project_id"
              name="project_id"
              required
              className="w-full h-9 px-2 text-sm border border-n-300 rounded"
            >
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.customer_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="portal_url">Portal URL *</Label>
            <Input
              id="portal_url"
              name="portal_url"
              type="url"
              required
              placeholder="https://isolarcloud.com/..."
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="username">Username *</Label>
            <Input id="username" name="username" required className="h-9 text-sm" />
          </div>

          <div>
            <Label htmlFor="password">Password *</Label>
            <div className="flex gap-1">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                className="h-9 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" name="notes" rows={2} className="text-sm" />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5.2: Edit dialog component**

Create `apps/erp/src/components/om/edit-plant-monitoring-dialog.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Textarea,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updatePlantMonitoringCredential } from '@/lib/plant-monitoring-actions';

interface EditPlantMonitoringDialogProps {
  credential: {
    id: string;
    portal_url: string;
    username: string;
    password: string;
    notes: string | null;
  };
}

export function EditPlantMonitoringDialog({ credential }: EditPlantMonitoringDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await updatePlantMonitoringCredential(credential.id, {
      portal_url: String(form.get('portal_url') ?? ''),
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
      notes: String(form.get('notes') ?? '') || null,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Edit">
          <Pencil className="h-3.5 w-3.5 text-n-500" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Credential</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="portal_url_edit">Portal URL *</Label>
            <Input
              id="portal_url_edit"
              name="portal_url"
              type="url"
              required
              defaultValue={credential.portal_url}
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="username_edit">Username *</Label>
            <Input
              id="username_edit"
              name="username"
              required
              defaultValue={credential.username}
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="password_edit">Password *</Label>
            <div className="flex gap-1">
              <Input
                id="password_edit"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                defaultValue={credential.password}
                className="h-9 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="notes_edit">Notes (optional)</Label>
            <Textarea
              id="notes_edit"
              name="notes"
              rows={2}
              defaultValue={credential.notes ?? ''}
              className="text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5.3: Delete button component**

Create `apps/erp/src/components/om/delete-plant-monitoring-button.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
  Button,
} from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { softDeletePlantMonitoringCredential } from '@/lib/plant-monitoring-actions';

interface DeletePlantMonitoringButtonProps {
  credentialId: string;
  customerName: string;
}

export function DeletePlantMonitoringButton({ credentialId, customerName }: DeletePlantMonitoringButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);

    const result = await softDeletePlantMonitoringCredential(credentialId);

    setDeleting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Delete">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete credential?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-n-700">
          Delete monitoring credentials for <strong>{customerName}</strong>? The record will be
          soft-deleted and can be recovered by a founder from the database if needed.
        </p>
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5.4: Type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors. If `Textarea`, `DialogFooter`, or `variant="destructive"` is not exported from `@repo/ui`, open `packages/ui/src/index.ts` and check what IS exported — the dialog patterns may use different names (e.g., plain `<Button>` without destructive variant + red className).

- [ ] **Step 5.5: Commit**

```bash
git add apps/erp/src/components/om/create-plant-monitoring-dialog.tsx apps/erp/src/components/om/edit-plant-monitoring-dialog.tsx apps/erp/src/components/om/delete-plant-monitoring-button.tsx
git commit -m "$(cat <<'EOF'
feat(plant-monitoring): create/edit/delete dialog components

Standard dialog pattern: form + ActionResult handling + router.refresh()
on success. Show/Hide toggle on password input. Soft-delete confirmation
dialog uses customer name for recognition.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Page route + loading skeleton

**Files:**
- Create: `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx`
- Create: `apps/erp/src/app/(erp)/om/plant-monitoring/loading.tsx`

- [ ] **Step 6.1: Write the page**

Create `apps/erp/src/app/(erp)/om/plant-monitoring/page.tsx`:

```tsx
import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, Badge, Button } from '@repo/ui';
import { Activity, ExternalLink } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import {
  listPlantMonitoringCredentials,
  getProjectsWithCredentials,
  getAllActiveProjects,
  getPlantMonitoringSummary,
} from '@/lib/plant-monitoring-queries';
import { createClient } from '@repo/supabase/server';
import { PlantMonitoringPasswordCell } from '@/components/om/plant-monitoring-password-cell';
import { CreatePlantMonitoringDialog } from '@/components/om/create-plant-monitoring-dialog';
import { EditPlantMonitoringDialog } from '@/components/om/edit-plant-monitoring-dialog';
import { DeletePlantMonitoringButton } from '@/components/om/delete-plant-monitoring-button';
import { FilterBar } from '@/components/filter-bar';
import { FilterSelect } from '@/components/filter-select';
import { SearchInput } from '@/components/search-input';

const BRAND_OPTIONS = [
  { value: 'sungrow', label: 'Sungrow' },
  { value: 'growatt', label: 'Growatt' },
  { value: 'sma', label: 'SMA' },
  { value: 'huawei', label: 'Huawei' },
  { value: 'fronius', label: 'Fronius' },
  { value: 'solis', label: 'Solis' },
  { value: 'other', label: 'Other' },
];

function brandBadgeVariant(brand: string | null): 'info' | 'success' | 'warning' | 'outline' {
  switch (brand) {
    case 'sungrow': return 'info';
    case 'growatt': return 'success';
    case 'sma': return 'warning';
    case 'huawei':
    case 'fronius':
    case 'solis':
      return 'info';
    default:
      return 'outline';
  }
}

interface PageProps {
  searchParams: Promise<{
    project?: string;
    brand?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function PlantMonitoringPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const perPage = 50;

  const [{ items, total }, filterProjects, allProjects, summary, viewerRole] = await Promise.all([
    listPlantMonitoringCredentials({
      project_id: params.project || undefined,
      brand: params.brand || undefined,
      search: params.search || undefined,
      page: currentPage,
      per_page: perPage,
    }),
    getProjectsWithCredentials(),
    getAllActiveProjects(),
    getPlantMonitoringSummary(),
    getViewerRole(),
  ]);

  const canEdit = viewerRole === 'founder' || viewerRole === 'project_manager';
  const totalPages = Math.ceil(total / perPage);
  const hasFilters = Boolean(params.project || params.brand || params.search);

  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.project) p.set('project', params.project);
    if (params.brand) p.set('brand', params.brand);
    if (params.search) p.set('search', params.search);
    if (page > 1) p.set('page', String(page));
    const qs = p.toString();
    return `/om/plant-monitoring${qs ? `?${qs}` : ''}`;
  }

  // Top 3 brands for the summary card
  const sortedBrands = Object.entries(summary.brands)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Plant Monitoring{' '}
            <span className="text-sm font-normal text-n-500">({total} total)</span>
          </h1>
          <p className="text-xs text-n-500 mt-0.5">
            Online portal credentials for every commissioned plant. Auto-synced from commissioning reports.
          </p>
        </div>
        {canEdit && <CreatePlantMonitoringDialog projects={allProjects} />}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Plants Monitored</div>
            <div className="text-2xl font-heading font-bold text-n-900 mt-1">{summary.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Top Brands</div>
            {sortedBrands.length === 0 ? (
              <div className="text-sm text-n-400 mt-1">No data yet</div>
            ) : (
              <div className="flex gap-2 mt-1 flex-wrap">
                {sortedBrands.map(([brand, count]) => (
                  <span key={brand} className="text-xs font-medium text-n-700 capitalize">
                    {brand}: <span className="font-bold">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-n-500 uppercase tracking-wider">Missing Credentials</div>
            <div className={`text-2xl font-heading font-bold mt-1 ${summary.missing > 0 ? 'text-amber-600' : 'text-n-900'}`}>
              {summary.missing}
            </div>
            {summary.missing > 0 && (
              <div className="text-[10px] text-n-500 mt-0.5">
                Projects with finalized commissioning but no credential
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/om/plant-monitoring" filterParams={['search', 'project', 'brand']}>
            <FilterSelect paramName="project" className="w-48 text-xs h-8">
              <option value="">All Projects</option>
              {filterProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.customer_name}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="brand" className="w-32 text-xs h-8">
              <option value="">All Brands</option>
              {BRAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search username/notes..."
              className="w-56 h-8 text-xs"
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Activity className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Credentials Yet</h2>
              <p className="text-xs text-n-500 max-w-[360px] mt-1">
                {hasFilters
                  ? 'No credentials match your current filters.'
                  : 'Credentials will appear here automatically when an engineer finalizes a commissioning report. You can also add them manually.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Project</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Brand</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Username</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Password</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Monitoring Link</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Created</th>
                    {canEdit && <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-20">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((cred) => {
                    const customerName = cred.projects?.customer_name ?? '—';
                    return (
                      <tr key={cred.id} className="border-b border-n-100 hover:bg-n-50">
                        <td className="px-2 py-1.5">
                          {cred.project_id ? (
                            <Link href={`/projects/${cred.project_id}`} className="text-[#00B050] hover:underline text-xs font-medium">
                              {customerName}
                            </Link>
                          ) : customerName}
                        </td>
                        <td className="px-2 py-1.5">
                          {cred.inverter_brand ? (
                            <Badge variant={brandBadgeVariant(cred.inverter_brand)} className="text-[10px] px-1.5 py-0 capitalize">
                              {cred.inverter_brand}
                            </Badge>
                          ) : (
                            <span className="text-n-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] font-mono text-n-700">
                          {cred.username}
                        </td>
                        <td className="px-2 py-1.5">
                          <PlantMonitoringPasswordCell password={cred.password} />
                        </td>
                        <td className="px-2 py-1.5">
                          <a
                            href={cred.portal_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#00B050] hover:underline text-[11px] inline-flex items-center gap-1 max-w-[260px]"
                            title={cred.portal_url}
                          >
                            <span className="truncate">{cred.portal_url}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-n-500">
                          {formatDate(cred.created_at)}
                        </td>
                        {canEdit && (
                          <td className="px-2 py-1.5">
                            <div className="flex gap-0.5">
                              <EditPlantMonitoringDialog
                                credential={{
                                  id: cred.id,
                                  portal_url: cred.portal_url,
                                  username: cred.username,
                                  password: cred.password,
                                  notes: cred.notes,
                                }}
                              />
                              <DeletePlantMonitoringButton
                                credentialId={cred.id}
                                customerName={customerName}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-n-500">
          <div>
            Showing {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, total)} of {total}
          </div>
          <div className="flex gap-1">
            {currentPage > 1 && (
              <Link href={pageUrl(currentPage - 1)}>
                <Button variant="outline" size="sm" className="h-7 text-xs">Previous</Button>
              </Link>
            )}
            <span className="px-2 py-1">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link href={pageUrl(currentPage + 1)}>
                <Button variant="outline" size="sm" className="h-7 text-xs">Next</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Helper — viewer role lookup
// Kept in the page file because it's the only place that needs it and
// following the pattern used in projects/[id]/page.tsx.
// ───────────────────────────────────────────────────────────────────────
async function getViewerRole(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return data?.role ?? null;
}
```

- [ ] **Step 6.2: Write the loading skeleton**

Create `apps/erp/src/app/(erp)/om/plant-monitoring/loading.tsx`:

```tsx
import { Card, CardContent } from '@repo/ui';

export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-64 bg-n-100 rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="py-3">
              <div className="h-3 w-24 bg-n-100 rounded" />
              <div className="h-7 w-16 bg-n-100 rounded mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="py-3">
          <div className="h-8 w-full bg-n-100 rounded" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-6 w-full bg-n-50 rounded" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6.3: Type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors. Common issues:
- If `formatDate` is not exported from `@repo/ui/formatters`, grep for it — usually in `packages/ui/src/formatters.ts`.
- If `Badge` variants differ, check `packages/ui/src/badge.tsx` for the actual variant set.

- [ ] **Step 6.4: Commit**

```bash
git add apps/erp/src/app/\(erp\)/om/plant-monitoring/
git commit -m "$(cat <<'EOF'
feat(plant-monitoring): page route + loading skeleton

Server list page with 3-card summary, sticky filter bar, 7-column table,
pagination. Edit/Delete actions gated to founder + project_manager via
viewer-role lookup on profiles.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Sidebar integration

**Files:**
- Modify: `apps/erp/src/lib/roles.ts`
- Modify: `apps/erp/src/components/sidebar.tsx`

- [ ] **Step 7.1: Add `plantMonitoring` to ITEMS and wire into O&M sections**

Edit `apps/erp/src/lib/roles.ts`.

Find the `ITEMS` block (around line 80) and add a new entry right after `amcSchedule`:

```typescript
  amcSchedule:    { label: 'AMC Schedule',      href: '/om/amc',           icon: 'CalendarCheck' },
  plantMonitoring: { label: 'Plant Monitoring', href: '/om/plant-monitoring', icon: 'Activity' },
```

Then update the O&M section in **three** roles:

Find the `founder` section's `{ label: 'O&M', ... }` line (around line 94) and update:

```typescript
    { label: 'O&M',          items: [ITEMS.omVisits, ITEMS.amcSchedule, ITEMS.serviceTickets, ITEMS.plantMonitoring] },
```

Find the `project_manager` section's `{ label: 'O&M', ... }` line (around line 119) and update:

```typescript
    { label: 'O&M',          items: [ITEMS.serviceTickets, ITEMS.amcSchedule, ITEMS.plantMonitoring] },
```

Find the `om_technician` section's `{ label: 'O&M', ... }` line (around line 124) and update:

```typescript
    { label: 'O&M',          items: [ITEMS.omVisits, ITEMS.amcSchedule, ITEMS.serviceTickets, ITEMS.plantMonitoring] },
```

- [ ] **Step 7.2: Register `Activity` icon in sidebar ICON_MAP**

Edit `apps/erp/src/components/sidebar.tsx`.

In the lucide import block (lines 8-16), add `Activity`:

```typescript
import {
  LayoutDashboard, Users, FileText, HardHat, ShoppingCart,
  TrendingUp, Wrench, UserCog, Package,
  Palette, ClipboardList, FileCheck, Globe, Megaphone,
  DollarSign, Award, GraduationCap, BookOpen, Truck,
  BarChart3, CalendarCheck, Building2, Shield,
  MessageSquare, Flag, ListChecks, Receipt, Activity,
  PanelLeftClose, PanelLeftOpen, Menu,
} from 'lucide-react';
```

In the `ICON_MAP` declaration (lines 18-25), add `Activity`:

```typescript
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Users, FileText, HardHat, ShoppingCart,
  TrendingUp, Wrench, UserCog, Package,
  Palette, ClipboardList, FileCheck, Globe, Megaphone,
  DollarSign, Award, GraduationCap, BookOpen, Truck,
  BarChart3, CalendarCheck, Building2, Shield,
  MessageSquare, Flag, ListChecks, Receipt, Activity,
};
```

- [ ] **Step 7.3: Type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors.

- [ ] **Step 7.4: Commit**

```bash
git add apps/erp/src/lib/roles.ts apps/erp/src/components/sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(sidebar): add Plant Monitoring to O&M section

Wired for founder, project_manager, and om_technician. Uses Activity
icon (registered in sidebar ICON_MAP).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Playwright smoke test

**Files:**
- Modify: `apps/erp/e2e/smoke.spec.ts`

- [ ] **Step 8.1: Add smoke test for the new route**

Edit `apps/erp/e2e/smoke.spec.ts`. Add this test at the end of the file (after the `price book page renders` test):

```typescript
// ═══════════════════════════════════════════════════════════════════════
// Test 6: /om/plant-monitoring
// ═══════════════════════════════════════════════════════════════════════
test('plant monitoring page renders', async ({ page }) => {
  const authed = await loginIfCredentialsPresent(page);
  test.skip(!authed, 'PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD not set');

  await page.goto('/om/plant-monitoring');
  await expect(page.locator('body')).toContainText(/plant monitoring/i);
  await expectNoDevErrorOverlay(page);
});
```

Also update the header comment block at the top of the file — change "5 critical paths" to "6 critical paths" and add a line for test 6.

- [ ] **Step 8.2: List tests to verify discovery**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp/apps/erp" && pnpm test:e2e --list
```

Expected: 6 tests discovered in `e2e/smoke.spec.ts` (the 5 existing + our new one).

- [ ] **Step 8.3: Commit**

```bash
git add apps/erp/e2e/smoke.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): smoke test for /om/plant-monitoring

Skipped when PLAYWRIGHT_LOGIN_EMAIL/_PASSWORD env vars are absent,
consistent with the other 5 smoke tests.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — End-to-end verification

- [ ] **Step 9.1: Full type check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w check-types
```

Expected: 0 errors across all 4 packages.

- [ ] **Step 9.2: Lint**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && pnpm -w lint
```

Expected: 0 errors, 0 new warnings. Warnings about `any` or `count: 'exact'` only if introduced; our code uses neither.

- [ ] **Step 9.3: Forbidden-pattern check**

Run:

```bash
cd "/c/Users/vivek/Projects/shiroi-erp" && bash scripts/ci/check-forbidden-patterns.sh
```

Expected: "No new forbidden patterns". Baseline violations are grandfathered; we must not introduce new ones.

- [ ] **Step 9.4: Manual verification in dev**

Start the dev server via preview_start if not running, or `pnpm -F @shiroi/erp dev`.

Test checklist:
1. Open `/om/plant-monitoring` as founder. Confirm page renders with 3 summary cards, filter bar, empty state.
2. Click "Add Credential". Fill: pick any project, URL `https://isolarcloud.com/test`, username `test`, password `secret123`. Save.
3. Confirm: row appears with `sungrow` brand badge. Password shows `••••••••`. Click eye icon → shows `secret123`. Wait 30 seconds — auto re-masks.
4. Click the external-link icon → opens the portal URL in a new tab.
5. Click edit pencil → change password to `newpass456` → Save. Confirm row updates.
6. Click delete trash → confirm dialog → Delete. Confirm row disappears.
7. Verify DB: `SELECT id, customer_name, deleted_at FROM plant_monitoring_credentials JOIN projects ON ...` — row exists with `deleted_at` set.
8. Open a project, go to Commissioning stepper step. Fill `monitoring_portal_link`, `monitoring_login`, `monitoring_password`. Click Submit so status transitions to `submitted`. Return to `/om/plant-monitoring` and confirm the credential appears automatically.
9. Re-open that commissioning report, change the password, re-submit. Confirm `/om/plant-monitoring` shows the new password on the SAME row (no duplicate).
10. As om_technician (use `?view_as=om_technician` on founder dashboard or log in as one): confirm the sidebar shows Plant Monitoring under O&M, but the Add/Edit/Delete buttons are absent on the page.

- [ ] **Step 9.5: Update CLAUDE.md**

Edit `CLAUDE.md`. In the CURRENT STATE table (near the top), add a new row before the "Prod deployment" row:

```markdown
| Plant Monitoring module | ✅ Complete | Migration 058: plant_monitoring_credentials table + trigger + RLS + summary RPC. /om/plant-monitoring page with filter bar, 3 summary cards (total, top brands, missing count), 7-column table (project, brand, username, password with 30s auto-remask + copy, portal link, created, actions). Auto-syncs from commissioning_reports on status transition to submitted/finalized via AFTER UPDATE trigger, upserts on (project_id, portal_url). Add/Edit/Delete dialogs gated to founder+project_manager; om_technician read-only. Brand auto-detection via URL pattern (sungrow/growatt/sma/huawei/fronius/solis/other). Sidebar link under O&M for founder, project_manager, om_technician. |
| Migration 058 | ✅ Applied (dev) | Plant Monitoring credentials: new `plant_monitoring_credentials` table with multi-entry-per-project support, soft delete, `plant_monitoring_detect_brand()` helper, `fn_sync_plant_monitoring_from_commissioning()` AFTER UPDATE trigger on commissioning_reports, `get_plant_monitoring_summary()` RPC, RLS (founder+project_manager CRUD, om_technician SELECT, no physical DELETE). Prod pending. |
```

Also update the "Last updated" line at the bottom to reflect today's date + the Plant Monitoring work.

- [ ] **Step 9.6: Commit docs and push**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: record Plant Monitoring module completion

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Spec Coverage Self-Review

Mapping every spec section to its implementing task:

- **§1 Purpose** → UI/flow in Task 6
- **§2 User stories** → All four stories addressed:
  - Manivel editing credentials → Task 5 (edit dialog) + Task 7 (PM sidebar entry)
  - O&M tech searching + clicking portal → Task 6 (filter bar + external-link anchor) + Task 7 (om_technician sidebar entry)
  - Vivek auto-sync → Task 1 (trigger)
  - Manivel recovery → Task 1 (soft delete column) + Task 3 (softDelete action; hard delete blocked at RLS)
- **§3 Scope / in-scope** — every item covered:
  - Table, trigger, brand detection → Task 1
  - Route, search/filter/pagination → Task 6
  - Password reveal + 30s re-mask → Task 4
  - Add/Edit/Delete → Tasks 3 + 5
  - Read-only for om_technician → Task 6 `canEdit` gate
  - Sidebar link → Task 7
  - Unique constraint → Task 1
  - RLS using `get_my_role()` → Task 1
- **§4 Data model** — matched byte-for-byte in Task 1 SQL
- **§5 Auto-sync trigger** — Task 1 (`fn_sync_plant_monitoring_from_commissioning`)
- **§6 RLS** — Task 1 policies
- **§7 File layout** — mirrored in the File Structure section of this plan
- **§8 UI** — Task 6
- **§9 Server actions** — Task 3
- **§10 Queries** — Task 2
- **§11 Sidebar** — Task 7
- **§12 Error handling** — pattern applied in Tasks 2 and 3
- **§13 Testing** — Task 8 smoke test + Task 9 manual checklist
- **§14 Migration plan** — Tasks 1, 2–7 (build), 9 (verify)
- **§15 Non-goals** — respected; no backfill, no vault encryption, no brand integration, no history table

No gaps.

## Placeholder Scan

Grep for "TBD", "TODO" (as a code instruction, not a test assertion), "fill in", "similar to Task", "add appropriate" — none present. Every step has concrete code or a concrete command.

## Type Consistency

- `PlantMonitoringCredential` returned by `listPlantMonitoringCredentials` in Task 2 — consumed by the page in Task 6 via `.projects?.customer_name`. Matches.
- `ActionResult<CredRow>` from `createPlantMonitoringCredential` — call sites in Tasks 5 check `result.success` + `result.error`. Matches.
- Brand enum literals `'sungrow' | 'growatt' | 'sma' | 'huawei' | 'fronius' | 'solis' | 'other'` — consistent across SQL CHECK (Task 1), brand function (Task 1), `BRAND_OPTIONS` in page (Task 6), and `brandBadgeVariant` (Task 6).
- `canEdit` computed in Task 6 is the single role gate; dialogs in Task 5 are only rendered when `canEdit` is true, so no duplicate role check is needed.

Plan is consistent and complete.
