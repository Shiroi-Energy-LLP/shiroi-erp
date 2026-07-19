# Team Tasks · Won→Manivel · Morning-message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Team-Tasks date/type bugs, make every Won deal spawn a project assigned to Manivel (+ backfill the 57 stranded ones), and add overdue-deals / today's-follow-ups / MTD-won-value to the morning WhatsApp digests.

**Architecture:** Three independent parts. A = app-only (formatter + form + tiny CHECK migration). B = one DB migration (trigger auto-stub + criteria-based backfill). C = one DB migration (3 digest SQL objects) + an ERP `action_block` helper returned by `/api/briefing/run` + edits to two n8n Compose nodes.

**Tech Stack:** Next.js 14 RSC, Supabase Postgres (triggers/RPC/views), `@repo/ui` (vitest), n8n (WhatsApp digests), Anthropic Haiku briefing.

**Spec:** `docs/superpowers/specs/2026-06-08-team-tasks-won-handoff-morning-digest-design.md`

---

## File Structure

| Path | Change | Responsibility |
|------|--------|----------------|
| `packages/ui/src/formatters.ts` | modify | `formatDate` renders date-only in IST |
| `packages/ui/src/formatters.test.ts` | modify | failing-first TZ test for `formatDate` |
| `apps/erp/src/lib/leads-task-actions.ts` | modify | persist `category` on manual lead tasks |
| `apps/erp/src/components/leads/quick-add-task.tsx` | modify | Type `<Select>` + IST default date |
| `apps/erp/src/app/(erp)/sales/tasks/page.tsx` | modify | label new categories |
| `supabase/migrations/168_2026-06-08-task-category-add-types.sql` | create | extend `tasks_category_check` |
| `supabase/migrations/169_2026-06-08-won-without-proposal-autocreate-and-backfill.sql` | create | trigger auto-stub + backfill |
| `supabase/migrations/170_2026-06-08-morning-digest-overdue-followups-wonmtd.sql` | create | 2 views + 1 RPC |
| `apps/erp/src/lib/ai/briefing-action-block.ts` | create | build the deterministic action block |
| `apps/erp/src/lib/ai/briefing-action-block.test.ts` | create | unit test the pure formatter |
| `apps/erp/src/app/api/briefing/run/route.ts` | modify | return `action_block` |
| `packages/types/database.ts` | regen | new views/RPC types (after mig 170) |
| `infrastructure/n8n/workflows/19-vivek-daily-7am.json` | modify | append action block + sanitize send |
| `infrastructure/n8n/workflows/20b-prem-daily-8am-ai.json` | modify | append action block + sanitize send |

Parts A/B/C are independently shippable; commit at each task.

---

# PART A — Team Tasks

## Task A1: `formatDate` IST fix

**Files:**
- Modify: `packages/ui/src/formatters.ts:28-34`
- Test: `packages/ui/src/formatters.test.ts`

- [ ] **Step 1: Add the failing test** (append inside `formatters.test.ts`)

```ts
describe('formatDate (date-only, server-tz-safe)', () => {
  it('renders the given calendar day in IST regardless of runtime TZ', () => {
    // Pre-fix, under TZ=UTC this returned the previous day ("09 Jun 2026").
    expect(formatDate('2026-06-10')).toBe('10 Jun 2026');
    expect(formatDate('2026-01-01')).toBe('01 Jan 2026');
  });
});
```
(If `formatDate` isn't already imported at the top of the file, add it to the existing import from `'./formatters'`.)

- [ ] **Step 2: Run the test under UTC to verify it fails**

Run (PowerShell): `$env:TZ='UTC'; pnpm --filter @repo/ui test -- formatters; Remove-Item Env:\TZ`
Expected: FAIL — `formatDate('2026-06-10')` returns `'09 Jun 2026'`.

- [ ] **Step 3: Apply the fix** — add `timeZone` to the options:

```ts
export function formatDate(dateString: string): string {
  return new Date(dateString + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}
```

- [ ] **Step 4: Run the test under UTC to verify it passes**

Run: `$env:TZ='UTC'; pnpm --filter @repo/ui test -- formatters; Remove-Item Env:\TZ`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/formatters.ts packages/ui/src/formatters.test.ts
git commit -m "fix(ui): formatDate renders date-only values in IST (server off-by-one)"
```

## Task A2: Task "Type" picker

**Files:**
- Create: `supabase/migrations/168_2026-06-08-task-category-add-types.sql`
- Modify: `apps/erp/src/lib/leads-task-actions.ts:14-21,43-54`
- Modify: `apps/erp/src/components/leads/quick-add-task.tsx`
- Modify: `apps/erp/src/app/(erp)/sales/tasks/page.tsx:27-36`

- [ ] **Step 1: Write the migration** (`168_2026-06-08-task-category-add-types.sql`)

```sql
-- Migration 168 — allow sales task types on tasks.category
-- Adds call / site_visit / document to the existing CHECK so manually-added
-- lead tasks carry a meaningful Type (was blank because no category was saved).
BEGIN;
ALTER TABLE tasks DROP CONSTRAINT tasks_category_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_category_check CHECK (
  category IS NULL OR category = ANY (ARRAY[
    'advance_payment','material_delivery','structure_installation','panel_installation',
    'electrical_work','testing_commissioning','civil_work','net_metering','handover',
    'general','payment_followup','payment_escalation','lead_followup',
    'call','site_visit','document'
  ])
);
COMMIT;
```

- [ ] **Step 2: Apply to dev + verify the constraint**

Apply via Supabase MCP `apply_migration` (project `actqtzoxjilqnldnacqz`, name `168_2026-06-08-task-category-add-types`).
Verify: `INSERT INTO tasks (id, title, entity_type, entity_id, assigned_to, created_by, due_date, category, is_completed) VALUES (gen_random_uuid(),'t','lead', NULL, NULL, NULL, CURRENT_DATE,'call', false) RETURNING id;` succeeds, then `ROLLBACK` (wrap in BEGIN/ROLLBACK). A bogus category must raise `check_violation`.

- [ ] **Step 3: Persist `category` in the action** (`leads-task-actions.ts`)

In `interface CreateLeadTaskInput` add:
```ts
  category?: string;
```
In the `.insert({...})` object (currently lines 43-54), add after `priority`:
```ts
    category: input.category ?? 'general',
```

- [ ] **Step 4: Add the Type `<Select>` + IST default** (`quick-add-task.tsx`)

Replace the `dueDate` initializer to compute tomorrow in IST:
```tsx
  const [dueDate, setDueDate] = useState(() => {
    const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    istNow.setDate(istNow.getDate() + 1);
    const y = istNow.getFullYear();
    const m = String(istNow.getMonth() + 1).padStart(2, '0');
    const d = String(istNow.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
```
Add state: `const [category, setCategory] = useState('call');`
Add this block immediately before the Priority `<div className="w-28">`:
```tsx
      <div className="w-32">
        <label className="text-xs font-medium text-n-500 mb-1 block">Type</label>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 text-sm">
          <option value="call">Call</option>
          <option value="site_visit">Site visit</option>
          <option value="lead_followup">Follow-up</option>
          <option value="document">Document</option>
          <option value="payment_followup">Payment</option>
          <option value="general">Other</option>
        </Select>
      </div>
```
In the `createLeadTask({...})` call, add `category,` to the payload.

- [ ] **Step 5: Label the new categories** (`sales/tasks/page.tsx`, in `getCategoryLabel`)

Add these cases before `default`:
```ts
    case 'call': return 'Call';
    case 'site_visit': return 'Site visit';
    case 'document': return 'Document';
```

- [ ] **Step 6: Verify (types + build + preview)**

Run: `pnpm check-types` → PASS.
Start the dev server (preview_start), open a lead's Tasks tab, add a task with Type "Site visit" + a due date, confirm the Team Tasks list (`/sales/tasks`) shows Type "Site visit" and the correct date.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/168_2026-06-08-task-category-add-types.sql apps/erp/src/lib/leads-task-actions.ts apps/erp/src/components/leads/quick-add-task.tsx "apps/erp/src/app/(erp)/sales/tasks/page.tsx"
git commit -m "feat(sales): task Type picker on lead tasks + IST default due date (mig 168)"
```

---

# PART B — Won → Manivel

## Task B1: Auto-create project on Won-without-proposal + backfill

**Files:**
- Create: `supabase/migrations/169_2026-06-08-won-without-proposal-autocreate-and-backfill.sql`

**Background:** `fn_mark_proposal_accepted_on_lead_won` currently returns without acting when a won lead has no in-play proposal, so no project is ever created. We add a no-proposal branch that stubs an `accepted` budgetary proposal (firing the existing `create_project_from_accepted_proposal` cascade → project + Manivel via mig-104). Then we backfill the 57 stranded won leads (12 recent → `order_received`, 45 old → `completed`).

- [ ] **Step 1: Capture the pre-state (evidence)**

Run on dev: `SELECT count(*) FROM leads l WHERE l.status='won' AND l.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id=l.id) AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.lead_id=l.id AND pr.deleted_at IS NULL);`
Expected: `58`.

- [ ] **Step 2: Write the migration**

```sql
-- Migration 169 — Won-without-proposal auto-creates a project (+ one-time backfill)
-- Root cause: project creation only fires from an accepted proposal. With the
-- proposal gate off, leads can be Won with no proposal → no project ever (58 on dev).
-- Fix: stub an accepted budgetary proposal when none exists → existing cascade
-- builds the project and mig-104 assigns Manivel.
BEGIN;

-- 1. Trigger function: add the no-proposal stub branch
CREATE OR REPLACE FUNCTION public.fn_mark_proposal_accepted_on_lead_won()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_proposal_id UUID;
  v_prepared_by UUID;
  v_lead RECORD;
BEGIN
  IF NEW.status != 'won' OR OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_proposal_id
  FROM proposals
  WHERE lead_id = NEW.id
    AND status = ANY (ARRAY['draft','sent','viewed','negotiating']::proposal_status[])
  ORDER BY is_budgetary ASC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_proposal_id IS NOT NULL THEN
    UPDATE proposals
    SET status='accepted', accepted_at=NOW(),
        accepted_by_name=COALESCE(accepted_by_name,'Auto-accepted on lead won'),
        acceptance_method=COALESCE(acceptance_method,'physical_signature')
    WHERE id = v_proposal_id;
    RETURN NEW;
  END IF;

  -- A proposal exists but isn't in-play (e.g. already accepted/rejected): cascade/idempotency handles it.
  IF EXISTS (SELECT 1 FROM proposals WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- No proposal at all → stub an accepted one so a project is created + assigned to Manivel.
  SELECT customer_name, estimated_size_kwp, base_quote_price, assigned_to
    INTO v_lead FROM leads WHERE id = NEW.id;

  v_prepared_by := COALESCE(
    v_lead.assigned_to,
    (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
       WHERE e.is_active AND p.role IN ('marketing_manager','founder')
       ORDER BY e.created_at DESC LIMIT 1),
    (SELECT id FROM employees WHERE is_active ORDER BY created_at LIMIT 1)
  );

  INSERT INTO proposals (
    lead_id, proposal_number, prepared_by, system_size_kwp, system_type,
    total_after_discount, valid_until, is_budgetary, status,
    accepted_at, accepted_by_name, acceptance_method
  ) VALUES (
    NEW.id, generate_doc_number('PROP'), v_prepared_by,
    COALESCE(v_lead.estimated_size_kwp, 0), 'on_grid', COALESCE(v_lead.base_quote_price, 0),
    CURRENT_DATE, TRUE, 'accepted', NOW(), 'Auto-stub on lead won (no proposal)', 'physical_signature'
  );

  RETURN NEW;
END;
$function$;

-- 2. Dev-specific DRA dedup (no-op on other envs — prod dedup handled at prod-apply review).
--    Keeps "DRA Infinique" (more data); soft-deletes "DRA - Infinique".
UPDATE leads SET deleted_at = NOW()
WHERE id = 'f5fd49cb-e222-438f-bc9e-3467d27e52b7' AND deleted_at IS NULL;

-- 3. Backfill: stub + project for every stranded won lead. Recent (created >= 2026-01-01)
--    stays order_received; old becomes completed. Criteria-based → re-runs on prod.
ALTER TABLE projects DISABLE TRIGGER projects_sync_enqueue;   -- don't spam Zoho with 57 historical projects
ALTER TABLE projects DISABLE TRIGGER trg_payment_followup;    -- don't create payment tasks on completed ones

DO $backfill$
DECLARE r RECORD; v_prepared_by UUID;
BEGIN
  FOR r IN
    SELECT l.id, l.estimated_size_kwp, l.base_quote_price, l.assigned_to,
           (l.created_at >= DATE '2026-01-01') AS is_recent
    FROM leads l
    WHERE l.status='won' AND l.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id=l.id)
      AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.lead_id=l.id AND pr.deleted_at IS NULL)
  LOOP
    v_prepared_by := COALESCE(r.assigned_to,
      (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
         WHERE e.is_active AND p.role IN ('marketing_manager','founder')
         ORDER BY e.created_at DESC LIMIT 1));
    INSERT INTO proposals (lead_id, proposal_number, prepared_by, system_size_kwp, system_type,
                           total_after_discount, valid_until, is_budgetary, status,
                           accepted_at, accepted_by_name, acceptance_method)
    VALUES (r.id, generate_doc_number('PROP'), v_prepared_by, COALESCE(r.estimated_size_kwp,0),
            'on_grid', COALESCE(r.base_quote_price,0), CURRENT_DATE, TRUE, 'accepted',
            NOW(), 'Backfill: won without proposal', 'physical_signature');
    IF NOT r.is_recent THEN
      UPDATE projects SET status='completed' WHERE lead_id = r.id AND deleted_at IS NULL;
    END IF;
  END LOOP;
END $backfill$;

ALTER TABLE projects ENABLE TRIGGER projects_sync_enqueue;
ALTER TABLE projects ENABLE TRIGGER trg_payment_followup;

COMMIT;
```

- [ ] **Step 3: Apply to dev**

Apply via Supabase MCP `apply_migration` (project `actqtzoxjilqnldnacqz`, name `169_2026-06-08-won-without-proposal-autocreate-and-backfill`).

- [ ] **Step 4: Verify the backfill**

Run on dev:
```sql
-- (a) no stranded leads remain
SELECT count(*) AS stranded FROM leads l
WHERE l.status='won' AND l.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id=l.id)
  AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.lead_id=l.id AND pr.deleted_at IS NULL);
-- (b) 12 recent (order_received) + 45 old (completed), all assigned to Manivel
SELECT pr.status, count(*),
       count(*) FILTER (WHERE e.full_name='Manivel Sellamuthu') AS manivel
FROM projects pr
JOIN proposals p ON p.id = pr.proposal_id AND p.accepted_by_name LIKE 'Backfill%'
LEFT JOIN employees e ON e.id = pr.project_manager_id
GROUP BY pr.status;
-- (c) DRA dup soft-deleted
SELECT customer_name, deleted_at IS NOT NULL AS killed FROM leads WHERE id='f5fd49cb-e222-438f-bc9e-3467d27e52b7';
```
Expected: (a) `0`; (b) `order_received=12`/`completed=45`, all `manivel`=row count; (c) `killed=true`.

- [ ] **Step 5: Verify going-forward (synthetic, rolled back)**

```sql
BEGIN;
WITH l AS (
  INSERT INTO leads (id, customer_name, phone, status, source, estimated_size_kwp)
  VALUES (gen_random_uuid(), 'ZZ Trigger Test', '9000000000', 'new', 'referral', 7)
  RETURNING id
)
UPDATE leads SET status='won' WHERE id=(SELECT id FROM l);
-- a project must now exist for that lead, assigned to Manivel
SELECT pr.status, e.full_name FROM projects pr
JOIN leads ld ON ld.id = pr.lead_id
LEFT JOIN employees e ON e.id = pr.project_manager_id
WHERE ld.customer_name='ZZ Trigger Test';
ROLLBACK;
```
Expected: one row, `status='order_received'`, `full_name='Manivel Sellamuthu'`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/169_2026-06-08-won-without-proposal-autocreate-and-backfill.sql
git commit -m "fix(sales): Won without proposal now spawns a project for Manivel + backfill 57 stranded (mig 169)"
```

> **Prod note (do not run autonomously):** prod is paused. When restored, re-run the Step-1 stranded query on prod, review/dedup prod's duplicates (the DRA hardcode no-ops there), then apply mig 169 to prod and re-run Step-4 verification.

---

# PART C — Morning messages (overdue deals · today's follow-ups · won MTD)

## Task C1: Digest SQL (2 views + 1 RPC)

**Files:**
- Create: `supabase/migrations/170_2026-06-08-morning-digest-overdue-followups-wonmtd.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 170 — morning-digest data: overdue deals, today's follow-ups, won MTD.
-- "Today"/"this month" computed in IST. Money aggregated in SQL (never JS reduce).
BEGIN;

-- 4a. Open leads overdue on follow-up OR expected close (all owners)
CREATE OR REPLACE VIEW v_digest_leads_overdue AS
SELECT
  l.id AS lead_id, l.customer_name, l.estimated_size_kwp,
  l.next_followup_date, l.expected_close_date,
  e.full_name AS owner_name,
  GREATEST(0, (now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_followup_date) AS followup_overdue_days,
  GREATEST(0, (now() AT TIME ZONE 'Asia/Kolkata')::date - l.expected_close_date) AS close_overdue_days
FROM leads l
LEFT JOIN employees e ON e.id = l.assigned_to
WHERE l.deleted_at IS NULL
  AND l.status NOT IN ('won','lost','on_hold','disqualified','converted')
  AND ( (l.next_followup_date IS NOT NULL AND l.next_followup_date < (now() AT TIME ZONE 'Asia/Kolkata')::date)
     OR (l.expected_close_date IS NOT NULL AND l.expected_close_date < (now() AT TIME ZONE 'Asia/Kolkata')::date) )
ORDER BY LEAST(COALESCE(l.next_followup_date,'9999-12-31'::date),
               COALESCE(l.expected_close_date,'9999-12-31'::date));
COMMENT ON VIEW v_digest_leads_overdue IS 'Open leads whose follow-up or expected-close date is before today (IST). Drives the morning action block.';
GRANT SELECT ON public.v_digest_leads_overdue TO authenticated, service_role;

-- 4b. Open sales-domain tasks due today (lead tasks + sales-category project tasks)
CREATE OR REPLACE VIEW v_digest_followup_tasks_today AS
SELECT
  t.id, t.title, t.category, t.due_date, t.entity_type, t.entity_id,
  e.full_name AS assignee_name,
  CASE WHEN t.entity_type='lead' THEN l.customer_name
       WHEN t.entity_type='project' THEN pr.customer_name END AS customer_name
FROM tasks t
LEFT JOIN employees e ON e.id = t.assigned_to
LEFT JOIN leads l ON t.entity_type='lead' AND l.id = t.entity_id
LEFT JOIN projects pr ON t.entity_type='project' AND pr.id = t.entity_id
WHERE t.deleted_at IS NULL AND t.is_completed = FALSE
  AND t.due_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  AND ( t.entity_type='lead'
        OR (t.entity_type='project' AND t.category IN ('payment_followup','payment_escalation','advance_payment','general')) )
ORDER BY e.full_name NULLS LAST, t.title;
COMMENT ON VIEW v_digest_followup_tasks_today IS 'Open sales-domain tasks due today (IST), grouped by assignee. Drives the morning action block.';
GRANT SELECT ON public.v_digest_followup_tasks_today TO authenticated, service_role;

-- 4c. Value won this calendar month-to-date (IST). Value = accepted proposal total, else base_quote_price.
CREATE OR REPLACE FUNCTION get_won_value_mtd()
RETURNS TABLE(won_count bigint, won_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH won_this_month AS (
    SELECT DISTINCT ON (h.lead_id) h.lead_id
    FROM lead_status_history h
    WHERE h.to_status = 'won'
      AND (h.changed_at AT TIME ZONE 'Asia/Kolkata')
            >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))
    ORDER BY h.lead_id, h.changed_at DESC
  )
  SELECT count(*)::bigint,
         COALESCE(SUM(COALESCE(p.total_after_discount, l.base_quote_price, 0)), 0)
  FROM won_this_month w
  JOIN leads l ON l.id = w.lead_id AND l.deleted_at IS NULL AND l.status='won'
  LEFT JOIN LATERAL (
    SELECT total_after_discount FROM proposals
    WHERE lead_id = w.lead_id AND status='accepted'
    ORDER BY created_at DESC LIMIT 1
  ) p ON true;
$fn$;
GRANT EXECUTE ON FUNCTION get_won_value_mtd() TO authenticated, service_role;

COMMIT;
```

- [ ] **Step 2: Apply to dev + sanity-check shape**

Apply via MCP `apply_migration` (project `actqtzoxjilqnldnacqz`, name `170_2026-06-08-morning-digest-overdue-followups-wonmtd`).
Run: `SELECT * FROM v_digest_leads_overdue LIMIT 3; SELECT * FROM v_digest_followup_tasks_today LIMIT 3; SELECT * FROM get_won_value_mtd();` — confirm columns resolve and `get_won_value_mtd` returns one `(won_count, won_value)` row.

- [ ] **Step 3: Regenerate `database.ts`** (NEVER-DO #20 — schema + types same commit)

Use MCP `generate_typescript_types` (dev) → write to `packages/types/database.ts` → `node scripts/strip-view-fk-entries.mjs` → `pnpm check-types`. Must pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/170_2026-06-08-morning-digest-overdue-followups-wonmtd.sql packages/types/database.ts
git commit -m "feat(digest): overdue-deals + today-followups views + won-MTD rpc (mig 170)"
```

## Task C2: ERP `action_block` helper + route

**Files:**
- Create: `apps/erp/src/lib/ai/briefing-action-block.ts`
- Create: `apps/erp/src/lib/ai/briefing-action-block.test.ts`
- Modify: `apps/erp/src/app/api/briefing/run/route.ts`

- [ ] **Step 1: Write the failing test for the pure formatter** (`briefing-action-block.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { formatActionBlock } from './briefing-action-block';

describe('formatActionBlock', () => {
  it('renders overdue, today, and won-MTD sections compactly', () => {
    const out = formatActionBlock({
      overdue: [{ customer_name: 'Acme', owner_name: 'Prem', followup_overdue_days: 3, close_overdue_days: 0 }],
      followupsToday: [{ assignee_name: 'Prem', customer_name: 'Beta', title: 'Call back' }],
      wonCount: 4, wonValue: 12000000,
    });
    expect(out).toContain('Overdue (1)');
    expect(out).toContain('Acme');
    expect(out).toContain("Today's follow-ups (1)");
    expect(out).toContain('Won this month: ₹1.2Cr');
    expect(out).not.toContain('\t');
  });

  it('renders graceful empties', () => {
    const out = formatActionBlock({ overdue: [], followupsToday: [], wonCount: 0, wonValue: 0 });
    expect(out).toContain('Overdue (0)');
    expect(out).toContain('Won this month: ₹0');
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `pnpm --filter erp test -- briefing-action-block`
Expected: FAIL (cannot import `formatActionBlock`).

- [ ] **Step 3: Implement the helper** (`briefing-action-block.ts`)

```ts
'use server';

import { createAdminClient } from '@repo/supabase/admin';

export interface OverdueRow { customer_name: string | null; owner_name: string | null; followup_overdue_days: number | null; close_overdue_days: number | null; }
export interface FollowupRow { assignee_name: string | null; customer_name: string | null; title: string | null; }
export interface ActionBlockData { overdue: OverdueRow[]; followupsToday: FollowupRow[]; wonCount: number; wonValue: number; }
export interface ActionBlock { text: string; overdue_count: number; followups_today_count: number; won_mtd_value: number; }

function shortINR(amount: number): string {
  if (amount >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(1)}Cr`;
  if (amount >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`;
  if (amount >= 1_000) return `₹${Math.round(amount / 1_000)}K`;
  return `₹${Math.round(amount)}`;
}

/** Pure formatter — unit-tested. WhatsApp template body: newlines OK, no tabs/4+ spaces. */
export function formatActionBlock(d: ActionBlockData): string {
  const lines: string[] = [];
  lines.push(`⚠ Overdue (${d.overdue.length})`);
  for (const o of d.overdue.slice(0, 8)) {
    const which = (o.followup_overdue_days ?? 0) > 0 ? `f/up ${o.followup_overdue_days}d` : `close ${o.close_overdue_days}d`;
    lines.push(`• ${o.customer_name ?? '—'} (${o.owner_name ?? 'unassigned'}, ${which})`);
  }
  if (d.overdue.length > 8) lines.push(`…+${d.overdue.length - 8} more`);

  lines.push(`📋 Today's follow-ups (${d.followupsToday.length})`);
  for (const t of d.followupsToday.slice(0, 8)) {
    lines.push(`• ${t.customer_name ?? t.title ?? '—'} — ${t.assignee_name ?? 'unassigned'}`);
  }
  if (d.followupsToday.length > 8) lines.push(`…+${d.followupsToday.length - 8} more`);

  lines.push(`💰 Won this month: ${shortINR(d.wonValue)} (${d.wonCount})`);
  return lines.join('\n');
}

export async function buildActionBlock(): Promise<ActionBlock> {
  const op = '[buildActionBlock]';
  const admin = createAdminClient();
  const [overdue, followups, wonMtd] = await Promise.all([
    admin.from('v_digest_leads_overdue').select('customer_name, owner_name, followup_overdue_days, close_overdue_days').limit(50),
    admin.from('v_digest_followup_tasks_today').select('assignee_name, customer_name, title').limit(50),
    admin.rpc('get_won_value_mtd'),
  ]);
  if (overdue.error) console.error(`${op} overdue failed`, { error: overdue.error, timestamp: new Date().toISOString() });
  if (followups.error) console.error(`${op} followups failed`, { error: followups.error, timestamp: new Date().toISOString() });
  if (wonMtd.error) console.error(`${op} wonMtd failed`, { error: wonMtd.error, timestamp: new Date().toISOString() });

  const wonRow = (wonMtd.data as Array<{ won_count: number; won_value: number }> | null)?.[0];
  const data: ActionBlockData = {
    overdue: overdue.data ?? [],
    followupsToday: followups.data ?? [],
    wonCount: Number(wonRow?.won_count ?? 0),
    wonValue: Number(wonRow?.won_value ?? 0),
  };
  return {
    text: formatActionBlock(data),
    overdue_count: data.overdue.length,
    followups_today_count: data.followupsToday.length,
    won_mtd_value: data.wonValue,
  };
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `pnpm --filter erp test -- briefing-action-block`
Expected: PASS.

- [ ] **Step 5: Return `action_block` from the route** (`api/briefing/run/route.ts`)

Add import: `import { buildActionBlock } from '@/lib/ai/briefing-action-block';`
Compute it once, after the auth/parse block, before Step 5's returns:
```ts
  const actionBlock = await buildActionBlock();
```
Add `action_block: actionBlock.text,` to BOTH JSON responses (the cached `return NextResponse.json({ cached: true, … })` and the final `return NextResponse.json({ cached: false, … })`).

- [ ] **Step 6: Verify route**

Run: `pnpm check-types` → PASS.
Manual: with dev server running, `curl -s -X POST $URL/api/briefing/run -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{"recipient_role":"marketing_manager"}'` → response JSON contains a non-empty `action_block`.

- [ ] **Step 7: Commit**

```bash
git add apps/erp/src/lib/ai/briefing-action-block.ts apps/erp/src/lib/ai/briefing-action-block.test.ts "apps/erp/src/app/api/briefing/run/route.ts"
git commit -m "feat(digest): action_block (overdue/today/won-MTD) on /api/briefing/run"
```

## Task C3: Wire the action block into both digests

**Files:**
- Modify: `infrastructure/n8n/workflows/20b-prem-daily-8am-ai.json`
- Modify: `infrastructure/n8n/workflows/19-vivek-daily-7am.json`

- [ ] **Step 1: 20b Prem — prepend action block in Compose**

In `node-compose` `jsCode`, change the AI-available branch so the body leads with the action block:
```js
const aiResult = $('AI Briefing — marketing_manager').item?.json;
const aiShort = aiResult?.whatsapp_short;
const actionBlock = aiResult?.action_block || '';
const dateLine = DateTime.now().setZone('Asia/Kolkata').toFormat('EEE, dd LLL yyyy');
const body = [actionBlock, aiShort].filter(s => s && String(s).length > 1).join('\n\n').slice(0, 900);
if (body.length > 10) {
  return [{ json: { title: `📊 Sales briefing — ${dateLine}`, body, to_phone: $env.SALES_HEAD_WHATSAPP || '', source: 'ai' } }];
}
return [{ json: { title: `📊 Sales briefing — ${dateLine}`, body: `Briefing unavailable. https://erp.shiroienergy.com/sales`, to_phone: $env.SALES_HEAD_WHATSAPP || '', source: 'fallback' } }];
```

- [ ] **Step 2: 20b Prem — sanitize the send body** (`node-whatsapp-prem`)

Change the second body parameter `text` expression to strip tabs / collapse 4+ spaces (newlines stay — matches existing digests; the Meta 132018 triggers are tabs + 4+ spaces):
```
={{ ($json.body || ' ').replace(/\t/g,' ').replace(/ {4,}/g,'   ').slice(0, 900) }}
```

- [ ] **Step 3: 19 Vivek — prepend action block in Compose**

In `19`'s `node-compose` `jsCode`, in the AI-available branch, replace the `body: aiShort.slice(0, 900),` line so it prepends the action block:
```js
  const actionBlock = aiResult?.action_block || '';
  const body = [actionBlock, aiShort].filter(s => s && String(s).length > 1).join('\n\n').slice(0, 900);
  return [{ json: { title: `🌅 Morning briefing — ${dateLine}`, body, to_phone: $env.VIVEK_WHATSAPP || '', source: 'ai' } }];
```
Apply the same send-body sanitization (Step 2 pattern) to `node-whatsapp-vivek`.

- [ ] **Step 4: Push both workflows to n8n**

Read `scripts/push-n8n-workflows.ts` to confirm its selector args, then push only these two (it preserves active state; match by **exact name** to avoid stale paused duplicates):
Run: `pnpm tsx scripts/push-n8n-workflows.ts 19 20b` (adjust selector to the script's convention if it differs).

- [ ] **Step 5: Smoke test (real send)**

In the n8n UI, "Execute workflow" on **20b** and **19**. Confirm Prem (+91 94440 60787) and Vivek (+91 94444 14087) receive a message whose body starts with the ⚠ Overdue / 📋 Today's follow-ups / 💰 Won-this-month block. Then check delivery status — query dev `customer_message_log` or n8n's `57-meta-delivery-webhook` execution data for `sent`/`delivered` (NOT `failed`/132018). If `failed` with 132018, change the Step-2 sanitizer to also replace newlines: `.replace(/\n/g,' — ')`.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/n8n/workflows/19-vivek-daily-7am.json infrastructure/n8n/workflows/20b-prem-daily-8am-ai.json
git commit -m "feat(digest): surface overdue/today/won-MTD block in Vivek 7AM + Prem 8AM messages"
```

---

# Finalize

- [ ] **Step 1: Run all four CI gates locally** (read each stdout tail — exit-code notifications can lie)

```
pnpm check-types
pnpm lint
bash scripts/ci/check-forbidden-patterns.sh
pnpm build
```
All must be clean (`error TS`, `Failed:`, `ELIFECYCLE`, `Build failed` → fix before pushing).

- [ ] **Step 2: Update docs**
- `docs/CHANGELOG.md` — one line per part (migs 168/169/170 + digest action block).
- `docs/modules/sales.md` — note the Won-without-proposal auto-stub + Type picker.
- `docs/modules/projects.md` — note the auto-create-on-won path (extends the mig-104 gotcha).
- Keep `scripts/data/won-backfill-review-2026-06-08.md` (review artifact) — local only, do not commit customer PII if the repo policy forbids it (confirm with Vivek).

- [ ] **Step 3: Push** `git push origin main`.

- [ ] **Step 4: Prod (Vivek-run, separate):** restore prod, review/dedup prod's stranded leads, apply migs 168→169→170 in order, regen types confirm, push the n8n workflows pointed at prod, smoke-test the morning sends.

---

## Self-Review (done while writing)

- **Spec coverage:** 1a date → A1; 1b type → A2; won→Manivel + backfill → B1; 4a/4b/4c → C1; surfacing → C2/C3. All covered.
- **Type consistency:** `formatActionBlock` / `ActionBlockData` / `buildActionBlock` names align across helper, test, and route. `action_block` key consistent across route + both Compose nodes. Category values (`call`/`site_visit`/`document`) consistent across migration 168, form, and label map.
- **Placeholder scan:** none — every step has concrete code/SQL/commands.
- **Known soft spots (flagged, not placeholders):** stub uses `system_type='on_grid'` (Shiroi default — if the proposals enum lacks it the mig apply errors and we adjust); n8n push selector + the 132018 newline contingency are both verify-steps with fallbacks.
