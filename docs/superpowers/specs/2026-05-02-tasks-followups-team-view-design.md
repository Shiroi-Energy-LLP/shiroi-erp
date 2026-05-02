# Tasks: Auto-create from Follow-ups + Team View + NOT NULL — Design

> Date: 2026-05-02
> Reporter: Vivek (with Prem feedback continuing from 2026-05-01 spec)
> Author: Claude (Opus, planning)
> Builds on: `docs/superpowers/specs/2026-05-01-task-sync-map-link-expected-orders-design.md` (migration 094 — payment-followup backfill)

## Context

Yesterday's spec (2026-05-01) addressed Prem's `/my-tasks` emptiness for **payment-followup** tasks: trigger fallback fixed + backfill applied via migration 094. Today's continuation expands the surface for sales follow-ups specifically:

1. **Auto-create tasks from `leads.next_followup_date`** — every lead follow-up should materialize as a row in `tasks`. Today, the `next_followup_date` field on `leads` exists but no trigger writes a `tasks` row when it's set, so the universal task list never sees lead follow-ups.
2. **Team Tasks view for marketing_manager** — Prem (marketing_manager role) needs visibility into every sales rep's open tasks, sortable by assignee. `/my-tasks` only shows tasks where `assigned_to = me`, by design.
3. **NOT NULL `tasks.assigned_to`** — every task must have an assignee. Dev currently has 0 unassigned tasks (verified 2026-05-02), so the constraint is safe to enforce immediately.
4. **Diagnostic: confirmed Prem has 4 open tasks on dev** (employee_id `01905444-3fec-4993-af84-a2ccdc348ffd`, role marketing_manager, active). Migration 094 is applied to prod (timestamp 20260501165333). If `/my-tasks` is still empty for Prem on prod, root cause is **no payment-followup tasks existed for the conditions to backfill**, not a bug. The fix is the new auto-create-from-followup trigger this spec adds, which will populate his queue from lead activity going forward.

---

## Ask 1 — Auto-create tasks from `leads.next_followup_date`

### Trigger

DB-level (per CLAUDE.md NEVER-DO #18 — never queue background work in server actions, and per the broader principle that triggers catch every write path including CSV imports, n8n writes, scripts).

```sql
CREATE OR REPLACE FUNCTION sync_lead_followup_task()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_existing_task_id UUID;
  v_assignee UUID;
BEGIN
  -- Only act when next_followup_date is meaningful and lead is alive
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve assignee: lead's assigned_to, fallback to oldest active marketing_manager,
  -- final fallback to founder (system_user). NEVER NULL.
  v_assignee := COALESCE(
    NEW.assigned_to,
    (SELECT e.id FROM employees e
       JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'marketing_manager' AND e.is_active = TRUE
      ORDER BY e.created_at ASC LIMIT 1),
    (SELECT e.id FROM employees e
       JOIN profiles p ON p.id = e.profile_id
      WHERE p.role = 'founder' AND e.is_active = TRUE
      ORDER BY e.created_at ASC LIMIT 1)
  );

  -- Find existing OPEN follow-up task for this lead, if any
  SELECT id INTO v_existing_task_id
  FROM tasks
  WHERE entity_type = 'lead'
    AND entity_id   = NEW.id
    AND category    = 'lead_followup'
    AND is_completed = FALSE
    AND deleted_at IS NULL
  LIMIT 1;

  IF NEW.next_followup_date IS NULL THEN
    -- Follow-up cleared: soft-close any open follow-up task (don't delete history)
    IF v_existing_task_id IS NOT NULL THEN
      UPDATE tasks
      SET is_completed = TRUE,
          completed_at = NOW(),
          completed_by = NEW.assigned_to,  -- system completion attributed to lead owner
          updated_at   = NOW()
      WHERE id = v_existing_task_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Upsert: update the existing open task or insert a new one
  IF v_existing_task_id IS NOT NULL THEN
    UPDATE tasks
    SET due_date    = NEW.next_followup_date,
        assigned_to = v_assignee,
        updated_at  = NOW()
    WHERE id = v_existing_task_id;
  ELSE
    INSERT INTO tasks (
      entity_type, entity_id, category, title,
      assigned_to, due_date, created_by, priority
    ) VALUES (
      'lead', NEW.id, 'lead_followup',
      'Follow up: ' || NEW.customer_name,
      v_assignee, NEW.next_followup_date, v_assignee, 'medium'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_lead_followup_task
  AFTER INSERT OR UPDATE OF next_followup_date, assigned_to, deleted_at ON leads
  FOR EACH ROW EXECUTE FUNCTION sync_lead_followup_task();
```

**Why upsert (not insert-only):**
- Sales reps often slip the date — we want one open task per lead per cycle, not a pile of orphans.
- When the rep changes `assigned_to` (lead reassignment), the task moves with the lead.
- When the date is cleared, the task auto-completes — no manual cleanup.

**Why category = `lead_followup`** (not generic `'followup'`): the existing `payment_followup` and `payment_escalation` categories are conventionally namespaced by domain. Sales follow-ups deserve their own bucket so analytics can split sales vs finance follow-ups without parsing the title.

### Backfill (one-shot, idempotent)

```sql
-- Create initial tasks for all currently-active leads with future follow-ups
WITH leads_needing_task AS (
  SELECT l.*
  FROM leads l
  WHERE l.deleted_at IS NULL
    AND l.next_followup_date IS NOT NULL
    AND l.next_followup_date >= CURRENT_DATE
    AND l.status NOT IN ('won','lost','on_hold')
    AND NOT EXISTS (
      SELECT 1 FROM tasks t
       WHERE t.entity_type='lead' AND t.entity_id=l.id
         AND t.category='lead_followup'
         AND t.is_completed=FALSE AND t.deleted_at IS NULL
    )
)
INSERT INTO tasks (entity_type, entity_id, category, title, assigned_to, due_date, created_by, priority)
SELECT 'lead', l.id, 'lead_followup',
       'Follow up: ' || l.customer_name,
       COALESCE(l.assigned_to,
                (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
                 WHERE p.role='marketing_manager' AND e.is_active LIMIT 1)),
       l.next_followup_date,
       COALESCE(l.assigned_to,
                (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
                 WHERE p.role='marketing_manager' AND e.is_active LIMIT 1)),
       'medium'
FROM leads_needing_task l
WHERE COALESCE(l.assigned_to,
               (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
                WHERE p.role='marketing_manager' AND e.is_active LIMIT 1)) IS NOT NULL;
```

(Dev backfill expected count: 1 — only one active future follow-up exists. Prod count unknown until prod queryable.)

---

## Ask 2 — NOT NULL on `tasks.assigned_to`

Verified 2026-05-02 on dev: `SELECT count(*) FROM tasks WHERE assigned_to IS NULL AND deleted_at IS NULL` returns **0**. The constraint is safe to add immediately on dev. On prod, run the same check inside the migration's transaction; if zero, add the constraint; if non-zero, abort and surface the offending row IDs for triage (per CLAUDE.md never-do — no silent backfilling).

```sql
-- Step 1: defensive backfill (no-op when already zero)
UPDATE tasks t
SET assigned_to = COALESCE(
  -- Prefer project's PM
  (SELECT pr.project_manager_id FROM projects pr WHERE pr.id = t.project_id),
  -- Then lead owner
  (SELECT l.assigned_to FROM leads l WHERE l.id = t.entity_id AND t.entity_type='lead'),
  -- Then oldest active founder (sentinel — visible, not "system")
  (SELECT e.id FROM employees e JOIN profiles p ON p.id=e.profile_id
    WHERE p.role='founder' AND e.is_active LIMIT 1)
)
WHERE t.assigned_to IS NULL AND t.deleted_at IS NULL;

-- Step 2: assert clean state, then enforce
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM tasks WHERE assigned_to IS NULL AND deleted_at IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL: % open tasks still unassigned', v_count;
  END IF;
END $$;

ALTER TABLE tasks ALTER COLUMN assigned_to SET NOT NULL;
```

**Why include soft-deleted rows in the constraint anyway:** because `deleted_at IS NULL` would still need NOT NULL to actually mean "every task has an owner forever." If pre-existing soft-deleted rows are NULL, the constraint application will fail and we'll see the count. Likely-zero scenario; check first via diagnostic.

---

## Ask 3 — Team Tasks view (sales-rep visibility for marketing_manager)

### New page

**Route:** `/sales/tasks`
**Visible to:** `marketing_manager`, `founder` (per `apps/erp/src/lib/auth/roles.ts` — extend the marketing_manager role's `sales` section to include `tasks: 'rw'` if not already present).

**Component shape** — reuses the existing `<TasksTable />` from `apps/erp/src/components/tasks/tasks-table.tsx` but with team-wide loader + an Assignee column (most consumers hide it because they're already filtered to one person).

### Data loader

```ts
// apps/erp/src/lib/sales-team-tasks-queries.ts
export type SalesTeamTaskRow = {
  id: string;
  title: string;
  category: string | null;
  entity_type: 'lead' | 'project';
  entity_id: string;
  customer_name: string;            // resolved via lead OR project join
  assigned_to: string;
  assignee_name: string;            // joined via employees.full_name
  due_date: string | null;
  is_completed: boolean;
  priority: string;
};

export async function getSalesTeamTasks(opts: {
  sortBy?: 'assignee_name' | 'due_date' | 'created_at';
  sortDir?: 'asc' | 'desc';
  includeCompleted?: boolean;
}): Promise<ActionResult<SalesTeamTaskRow[]>> { /* ... */ }
```

Filter clause: `entity_type IN ('lead','proposal') OR (entity_type='project' AND category IN ('payment_followup','payment_escalation'))` — the marketing_manager owns the sales pipeline + payment chasing, but doesn't need to see installation/electrical project tasks.

### UI: sortable Assignee column

The existing data-table sort plumbing ([data-table.tsx:266](apps/erp/src/components/data-table/data-table.tsx:266)) handles column-header-click sorts via URL (`?sort=assignee_name&dir=asc`). Add an `assignee_name` sortable column to the team-tasks table config (this is a separate config from `LEAD_COLUMNS` / `PROPOSAL_COLUMNS` — tasks have their own custom render today).

If extending the existing `<TasksTable />` rather than data-table-driven: add a sort dropdown above the table with three options (Assignee, Due Date, Created), and pass the chosen key to `getSalesTeamTasks()`. URL state via `?sort=…&dir=…` query params for shareable links.

### Why not just modify `/my-tasks` to add a "show team" toggle

Because `/my-tasks` is a personal dashboard widget. A toggle would change its semantics for everyone and complicate role-based default rendering. A separate `/sales/tasks` page is clearer, RLS-isolated, and links discoverable from the sales nav.

---

## Ask 4 — Why Prem can't see project tasks (and what's correct)

**Diagnosis:** Project tasks are typically assigned to PMs, not Prem. `/my-tasks` filters strictly to `assigned_to = me`, so by design Prem doesn't see them there. This is **correct** — `/my-tasks` is "tasks I personally need to do."

**The fix is conceptual, not code:**
- Project tasks Prem cares about (payment chasing, escalations) are already routed to him via the `payment_followup` trigger fallback (migration 094 lookup).
- For broader visibility into the team's project-side workload, the founder-tier `/tasks` page already exists (no `assigned_to` filter). Marketing_manager already sees this per yesterday's spec (Section "Ask 2 — Client name + Status columns").
- New `/sales/tasks` page (Ask 3 above) gives him the sales-flavoured cross-team view.

So no new code is needed for this specific complaint beyond the team-view page already in scope.

---

## Migration 108 — full surface

```sql
-- ============================================================================
-- Migration 108 — Auto-create lead-follow-up tasks + NOT NULL assigned_to
-- Date: 2026-05-02
-- Why: (1) Sales reps' next_followup_date on leads never materializes as a
--      task, so /my-tasks (and the new /sales/tasks team view) is empty for
--      sales-flavoured work. Adding a trigger + backfill closes that loop.
--      (2) Enforce that every task has an assignee — defeats the purpose of a
--      task list otherwise. Dev verified zero unassigned; assertion-gated.
-- ============================================================================

-- (1) Lead follow-up sync function + trigger (see Ask 1 above for full body)

-- (2) Backfill tasks for currently-active leads with future follow-ups

-- (3) Backfill any null assigned_to (defensive — likely no-op)

-- (4) Assertion + NOT NULL constraint on tasks.assigned_to
```

Numbered 108 because dev's last migration is 107 (`block_won_without_proposal`).

---

## Files

**New:**
- `supabase/migrations/108_lead_followup_task_sync.sql`
- `apps/erp/src/lib/sales-team-tasks-queries.ts`
- `apps/erp/src/app/(erp)/sales/tasks/page.tsx`

**Edited:**
- `apps/erp/src/lib/auth/roles.ts` — extend marketing_manager → `sales.tasks: 'rw'` if not already.
- `apps/erp/src/components/tasks/tasks-table.tsx` — add an optional Assignee column (default hidden, shown when `showAssignee={true}` prop set by `/sales/tasks`).
- `apps/erp/src/app/(erp)/sales/_layout-or-nav.tsx` (or wherever the sales nav lives) — add "Team Tasks" link visible to marketing_manager + founder.

After migration applied: regenerate `packages/types/database.ts`.

---

## Acceptance criteria

1. `INSERT INTO leads (... next_followup_date='2026-05-15', assigned_to=<rep>...)` produces exactly one row in `tasks` with `entity_type='lead'`, `category='lead_followup'`, `assigned_to=<rep>`, `due_date='2026-05-15'`, `is_completed=false`.
2. `UPDATE leads SET next_followup_date='2026-05-20'` updates the same task's `due_date`, doesn't create a duplicate.
3. `UPDATE leads SET next_followup_date=NULL` marks the open task `is_completed=true`.
4. `UPDATE leads SET assigned_to=<other_rep>` updates the open task's `assigned_to`.
5. `INSERT INTO tasks (... assigned_to=NULL ...)` raises a NOT NULL violation.
6. As Prem (marketing_manager) on `/sales/tasks`: sees all open tasks where `entity_type='lead'`, sortable by Assignee.
7. As a sales rep on `/my-tasks`: sees only their own follow-up tasks (existing behaviour preserved).
8. Backfill produced expected count (dev: 1; prod TBD post-wake).
9. `pnpm check-types` clean. `pnpm lint` clean. Forbidden-pattern gate clean. `pnpm build` clean.
10. Single commit on `main`, pushed, prod migration applied within 24h of dev.

---

## Risks / open questions

1. **Trigger reentrancy** — if the trigger function ever updates `leads` (it doesn't here), it could loop. Current body only touches `tasks`, so no recursion path.
2. **Lead reassignment churn** — if a lead is bulk-reassigned (CSV import, mass update), every row fires the trigger. For 1k-row imports this is fine (single-row UPDATE per lead); for larger, monitor query time and consider `WHEN (NEW.next_followup_date IS DISTINCT FROM OLD.next_followup_date OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)` predicate.
3. **`leads.assigned_to` may be NULL for legacy rows** — fallback chain handles it (marketing_manager → founder), so trigger never fails. But the fallback assignee may surprise sales reps. Acceptable: it's better than NULL.
4. **Old completed lead-followup tasks** — backfill skips leads that already have an open follow-up task; closed historical tasks for the same lead are left untouched (correct — they reflect past activity).
5. **Marketing_manager's `/sales/tasks` query cost** — 14 open tasks today. With expected growth to ~500 active leads, ~500 tasks. Single index on `(entity_type, is_completed, deleted_at, due_date)` handles it. Add in same migration.

---

## Out of scope

- Per-task SLA / escalation rules (e.g. auto-escalate if `due_date < CURRENT_DATE - 3`). Future spec.
- Push notifications when a task is created or due. Notification module is its own future spec.
- Mobile parity (WatermelonDB sync of tasks). Mobile not yet built.
- Task comments / activity feed — out of current scope; tasks remain single-row records.

---

## Dependencies

- Migration 094 (yesterday) — already applied to dev + prod. Provides `marketing_manager` role + Prem's role assignment.
- `employees`, `profiles`, `leads`, `tasks` tables — all exist.
- `decimal.js` / `NUMERIC(14,2)` not relevant (no money).
- No new env vars.
