# Implementation Plan — Task Sync + Map Link + Expected Orders/Payments

> Date: 2026-05-01
> Spec: `docs/superpowers/specs/2026-05-01-task-sync-map-link-expected-orders-design.md`
> Executor: Sonnet (general-purpose), overnight, autonomous
> Authorized: Vivek — commit to `main`, push, no per-step review

This plan is for end-to-end overnight execution. Work the phases in order. Stop and abort the run if any verification gate fails — do not paper over a failure.

---

## Pre-flight (don't skip)

1. Confirm working directory: `C:\Users\vivek\Projects\shiroi-erp`.
2. Confirm branch: `main`. **If not on `main`, stop and abort.** Do not switch branches.
3. `git status` — confirm working tree clean (the spec + plan + `.superpowers/` are the only untracked items; OK).
4. Run `pnpm check-types` once to capture green baseline.
5. Read these files in full before editing:
   - `apps/erp/src/components/tasks/tasks-table.tsx`
   - `apps/erp/src/app/(erp)/tasks/page.tsx` (parent that renders the table header)
   - `apps/erp/src/components/leads/lead-form.tsx`
   - `apps/erp/src/lib/leads-actions.ts` (createLead / updateLead)
   - `apps/erp/src/app/(erp)/sales/[id]/page.tsx`
   - `apps/erp/src/app/(erp)/leads/[id]/page.tsx` (legacy detail)
   - `apps/erp/src/app/(erp)/design/[leadId]/page.tsx`
   - `apps/erp/src/app/(erp)/dashboard/founder-dashboard.tsx`
   - `apps/erp/src/app/(erp)/cash/page.tsx`
   - `apps/erp/src/lib/payments-overview-queries.ts` (pattern reference)
   - `apps/erp/src/lib/dashboard-queries.ts` and any cached-dashboard-queries.ts
6. Run this Supabase MCP query and save its output (you'll reference it in Phase 1):
   ```sql
   SELECT pg_get_functiondef(oid) AS source
   FROM pg_proc
   WHERE proname IN ('create_project_from_accepted_proposal', 'fn_create_project_from_accepted_proposal');
   ```
7. Confirm Prem's employee row exists and is active:
   ```sql
   SELECT e.id, e.full_name, e.is_active, p.role
   FROM employees e
   JOIN profiles p ON p.id = e.profile_id
   WHERE p.id = '4d6fda9c-e1e6-4c51-a3c0-895da22a2fb3';
   ```
   Expected: `role = 'marketing_manager'`, `is_active = TRUE`. **If not, stop and abort** — the backfill won't work.

---

## Phase 1 — Migration 089

**File**: `supabase/migrations/089_task_backfill_map_link_expected_rpcs.sql`

Compose the migration with these sections in order:

1. **Backfill payment-follow-up tasks** to Prem (or whoever the oldest active marketing_manager is). Use the `WITH prem AS (...)` pattern from the spec.
2. **`ALTER TABLE leads ADD COLUMN IF NOT EXISTS map_link TEXT`** + COMMENT.
3. **CREATE OR REPLACE FUNCTION `get_expected_orders(window_days INT)`** — full body from the spec.
4. **CREATE OR REPLACE FUNCTION `get_expected_payments(window_days INT)`** — full body from the spec.
5. **GRANT EXECUTE** on both RPCs to `authenticated`.
6. **Trigger update** — copy `lead.map_link` to `project.location_map_link`:
   - Pull the function definition you saved in pre-flight step 6.
   - Find the INSERT or NEW assignment in `create_project_from_accepted_proposal`.
   - Locate `location_map_link`. If absent, add it. If present, wrap it with `COALESCE(<existing-source>, l.map_link)` where `l` is the leads alias used in the function body.
   - Re-emit the entire `CREATE OR REPLACE FUNCTION ... AS $$ ... $$;` block in the migration.
   - **Critical**: do not silently change other behavior in the trigger. Re-paste verbatim, only adjusting the `location_map_link` line.

**Apply** via Supabase MCP `apply_migration` against project `actqtzoxjilqnldnacqz`:
- `name`: `089_task_backfill_map_link_expected_rpcs`

**Verify** (run via `execute_sql`):
```sql
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='leads' AND column_name='map_link') AS map_link_added,
  (SELECT count(*) FROM pg_proc WHERE proname='get_expected_orders') AS rpc_orders,
  (SELECT count(*) FROM pg_proc WHERE proname='get_expected_payments') AS rpc_payments,
  (SELECT count(*) FROM tasks WHERE category IN ('payment_followup','payment_escalation')
    AND is_completed=false AND deleted_at IS NULL
    AND assigned_to = (SELECT id FROM employees WHERE profile_id='4d6fda9c-e1e6-4c51-a3c0-895da22a2fb3')) AS prem_open_tasks;
```

All four numbers > 0 (the third may be exactly 1 — same column count). `prem_open_tasks` should be a meaningful number (>= 1).

Spot-check the RPCs:
```sql
SELECT count(*) FROM get_expected_orders(7);   -- this week's expected orders
SELECT count(*) FROM get_expected_orders(30);  -- this month's
SELECT count(*) FROM get_expected_payments(7);
SELECT count(*) FROM get_expected_payments(30);
```

Numbers may be 0 (data-dependent). What matters is that the queries don't error.

**DoD**: migration committed at the path, applied to dev, all four checks pass, no SQL errors.

---

## Phase 2 — Type regen + strip view FKs

```bash
pnpm --filter @repo/types generate
node scripts/strip-view-fk-entries.mjs
pnpm check-types
```

**DoD**: `database.ts` shows `Functions.get_expected_orders` and `Functions.get_expected_payments`; `Tables.leads.Row` includes `map_link: string | null`; `pnpm check-types` clean.

---

## Phase 3 — Tasks table: Client + Status columns

### 3.1 — Identify the parent

Find every consumer of `TasksTable` from `apps/erp/src/components/tasks/tasks-table.tsx`:
```bash
grep -rn "TasksTable" apps/erp/src/
```

Primary consumer is `apps/erp/src/app/(erp)/tasks/page.tsx`. Read its `<thead>` block.

### 3.2 — Update the data loader

Find the query that loads tasks (likely `getTasks` or similar in `apps/erp/src/lib/tasks-queries.ts` or inline in the page). Extend the Supabase select to include both project AND lead joins:

```ts
.select(`
  id, title, description, category, priority, due_date, is_completed, completed_at,
  remarks, entity_type, entity_id, project_id, assigned_to,
  project:projects!tasks_project_id_fkey(project_number, customer_name),
  lead:leads(customer_name)         // when entity_type='lead' AND entity_id maps to leads.id
`)
```

The `lead` join is by FK if available. If `tasks.entity_id` doesn't have an FK to `leads.id`, do a manual second-pass enrichment in JS: collect `lead` entity_ids, fetch them in a second query, build a `Map`, attach `lead_customer_name` to each task. (Keep aggregation rules in mind: this is a row-by-row enrichment, not money math — JS is fine.)

### 3.3 — Update the `<thead>` in `tasks/page.tsx`

Rename the existing "Project Name" `<th>` label to **"Client"**. Confirm "Status" `<th>` exists with that exact label; if not, add/rename. Order suggestion: keep existing order, just relabel.

### 3.4 — Update the `<tbody>` cell rendering in `tasks-table.tsx`

In the existing "Project Name → customer" cell:
```tsx
const clientName = projectInfo?.customer_name ?? task.lead?.customer_name ?? null;
return clientName ? (
  <Link href={projectInfo ? `/projects/${task.project_id}` : `/sales/${task.entity_id}`}
        className="text-p-600 hover:underline font-medium">
    {clientName}
  </Link>
) : (
  <span className="text-n-400">—</span>
);
```

When the task is lead-linked, link to the sales detail; when project-linked, link to project. Otherwise dash.

### 3.5 — Verify

`pnpm check-types` and `pnpm lint` clean. Open `/tasks` in dev (`pnpm dev`) — confirm:
- "Client" header.
- Lead-linked tasks show the lead's customer name + link to `/sales/[id]`.
- Project-linked tasks unchanged.

**DoD**: types + lint clean.

---

## Phase 4 — Map link (form + detail + design + actions)

### 4.1 — Lead form

`apps/erp/src/components/leads/lead-form.tsx`:

- Add `map_link?: string` to the form's input type.
- Render a labeled `<input type="url" name="map_link">` below the address fields. Helper text: "Google Maps URL (optional)".
- Light client-side validation (run before submit, only when non-empty):
  ```ts
  if (mapLink && mapLink.trim()) {
    if (!/^https?:\/\//i.test(mapLink)) return "Map link must start with https://";
    // permissive: don't enforce hostname; show success even on goo.gl/maps, maps.app.goo.gl, maps.google.*, plain coordinates
  }
  ```
- Plumb the field through to the create/update server actions.

### 4.2 — Lead actions

`apps/erp/src/lib/leads-actions.ts`:

- `createLead(input)` — accept and persist `map_link`.
- `updateLead(input)` — accept and persist `map_link`.
- Use the regenerated `Database['public']['Tables']['leads']['Insert']`/`Update` types — no `as any`.

### 4.3 — Lead detail page

`apps/erp/src/app/(erp)/sales/[id]/page.tsx` — the Contact Info section. Add a row:

```tsx
{lead.map_link && (
  <div className="text-sm">
    <span className="text-n-500">Site location:</span>{' '}
    <a href={lead.map_link} target="_blank" rel="noopener noreferrer" className="text-p-600 hover:underline">
      View on map ↗
    </a>
  </div>
)}
```

If the legacy `apps/erp/src/app/(erp)/leads/[id]/page.tsx` still serves any view (per modules/sales.md it 307-redirects, but check), apply the same.

### 4.4 — Design workspace

`apps/erp/src/app/(erp)/design/[leadId]/page.tsx` — Site Survey Summary card. Add the same "Open in Maps ↗" link pattern. Designer doesn't edit; read-only consumption.

Adjust the lead query that feeds this page to include `map_link` in the select.

### 4.5 — Verify

`pnpm check-types` clean. Manual smoke test:
- Create a new lead with a Google Maps URL — saves successfully.
- View lead detail — link appears, opens in new tab.
- View design workspace for that lead — link appears.
- Edit lead, change map link — round-trips.

**DoD**: types + lint clean.

---

## Phase 5 — Dashboard cards (Expected Orders + Expected Payments)

### 5.1 — Query layer

**File**: `apps/erp/src/lib/dashboard-expected-queries.ts` (new)

```ts
import { createClient } from '@repo/supabase/server';

export interface ExpectedOrderRow {
  lead_id: string;
  customer_name: string;
  status: string;
  estimated_size_kwp: number | null;
  base_quote_price: number | null;
  derived_value: number;
  expected_close_date: string;
  close_probability: number | null;
  days_until: number;
}

export async function getExpectedOrders(windowDays: number): Promise<ExpectedOrderRow[]> {
  const op = '[getExpectedOrders]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_expected_orders', { window_days: windowDays });
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    throw new Error(`Failed to load expected orders: ${error.message}`);
  }
  return (data ?? []).map((r: any) => ({
    lead_id: r.lead_id,
    customer_name: r.customer_name,
    status: r.status,
    estimated_size_kwp: r.estimated_size_kwp !== null ? Number(r.estimated_size_kwp) : null,
    base_quote_price: r.base_quote_price !== null ? Number(r.base_quote_price) : null,
    derived_value: Number(r.derived_value),
    expected_close_date: r.expected_close_date,
    close_probability: r.close_probability,
    days_until: r.days_until,
  }));
}

// same shape for ExpectedPaymentRow + getExpectedPayments
```

### 5.2 — Card components

**File**: `apps/erp/src/components/dashboard/expected-orders-card.tsx` (new) — server component, accepts pre-loaded `weekRows: ExpectedOrderRow[]` and `monthRows: ExpectedOrderRow[]`. Renders two collapsible-style sections with rows:

- Customer (clickable to `/sales/[id]`)
- kWp
- ₹ value (use `shortINR(derived_value)`)
- Expected close date (`formatDate`)
- Probability % chip

Empty section state: muted "No orders expected this week" / "this month".

Footer: "View all in negotiation →" `<Link>` to `/sales` (or whatever filter param triggers the negotiation view).

**File**: `apps/erp/src/components/dashboard/expected-payments-card.tsx` (new) — same pattern with payment-row fields. Footer: "View payment tracker →" → `/payments/tracker`.

For "month minus week" deduplication: compute `monthOnlyRows = monthRows.filter(m => !weekRows.some(w => w.lead_id === m.lead_id))` (or analogous for payments) and pass that as the "This Month" subset. Or just render Month as the full set with This Week's items visually flagged at the top — Sonnet's call.

### 5.3 — Dashboard wiring

**File**: `apps/erp/src/app/(erp)/dashboard/founder-dashboard.tsx`

- Import `ExpectedOrdersCard` and `ExpectedPaymentsCard`.
- In the existing `Promise.all` data fetch (or add one if not present), call `getExpectedOrders(7)` + `getExpectedOrders(30)` + `getExpectedPayments(7)` + `getExpectedPayments(30)`.
- Place the two cards in the right column (alongside `ClosureApprovalsPanel`, `PendingApprovals`, `PipelineSummary`). Sonnet to read the existing layout and slot them in without disrupting it.

### 5.4 — Cash page wiring

**File**: `apps/erp/src/app/(erp)/cash/page.tsx`

- Import `ExpectedPaymentsCard` only (Vivek's call: payments on cash, orders on dashboard).
- Place between the KPI summary cards and the project-cash-positions table.
- Reuse the same query helpers (`getExpectedPayments(7)` and `getExpectedPayments(30)`).

### 5.5 — Verify

`pnpm check-types`, `pnpm lint`, `pnpm build --filter erp` all clean. Open `/dashboard` and `/cash` on dev — confirm cards render with non-empty content where data exists.

**DoD**: all checks pass.

---

## Phase 6 — Final verification

```bash
pnpm check-types
pnpm lint
bash scripts/ci/check-forbidden-patterns.sh   # baseline 64 — must not regress
pnpm build --filter erp
```

If any of these fail: stop. Do not commit. Diagnose, fix, retry.

---

## Phase 7 — Documentation

### 7.1 `docs/CHANGELOG.md` — append entry at the top:

```markdown
- **2026-05-01 (overnight) — Task sync + Map link + Expected Orders/Payments.** Migration 089: backfilled all open `payment_followup`/`payment_escalation` tasks to Prem (no `marketing_manager` employee existed when prior tasks were created — they fell through to PMs); added `leads.map_link TEXT` (mirrors `projects.location_map_link` from mig 033, optional); added RPCs `get_expected_orders(window_days)` and `get_expected_payments(window_days)` for the new dashboard cards; updated `create_project_from_accepted_proposal` trigger to default `project.location_map_link` from `lead.map_link` via COALESCE. UI: `/tasks` now shows "Client" column (renamed from "Project Name") with lead-linked task resolution; `/sales/new` + `/sales/[id]` + `/design/[leadId]` surface the new map link with a "View on map ↗" external link; `/dashboard` (founder + marketing_manager) gains Expected Orders + Expected Payments cards with this-week / this-month subsections; `/cash` gains the Expected Payments card between KPIs and project positions. Reported by Prem (task sync, marketing-page columns) + Vivek (map link, expected orders/payments). Files: `supabase/migrations/089_task_backfill_map_link_expected_rpcs.sql`, `apps/erp/src/lib/dashboard-expected-queries.ts`, `apps/erp/src/components/dashboard/{expected-orders-card,expected-payments-card}.tsx`, plus form/detail/design surfaces. Spec: `docs/superpowers/specs/2026-05-01-task-sync-map-link-expected-orders-design.md`. Plan: `docs/superpowers/plans/2026-05-01-task-sync-map-link-expected-orders-plan.md`.
```

### 7.2 `docs/CURRENT_STATUS.md`

- Update the "Last updated" header line to mention this overnight ship.
- Add a row at the top of the in-flight table marking it ✅ Shipped May 1.
- Update Migration state: dev now at `089` (was `088`).

### 7.3 `docs/modules/sales.md`

- Under **Past Decisions & Specs**, append:
  ```markdown
  - **Migration 089** — `leads.map_link` added (optional Google Maps URL); backfill payment-follow-up tasks to marketing_manager; RPCs for Expected Orders / Expected Payments; trigger update to copy `lead.map_link` → `project.location_map_link` on lead-won.
  ```
- Under **Key Tables**, on the `leads` line, add `map_link` to the columns list.

### 7.4 `docs/modules/finance.md`

- Under **Screens / Routes**, add to `/dashboard` and `/cash` the new cards.
- Under **RPCs**, append:
  ```markdown
  - `get_expected_orders(window_days INT)` — list of leads in `negotiation`/`closure_soon` with `expected_close_date` in the next N days; powers Expected Orders dashboard card (mig 089).
  - `get_expected_payments(window_days INT)` — list of payment milestones whose computed expected date falls in the next N days; skips already-paid milestones; powers Expected Payments card on `/dashboard` and `/cash` (mig 089).
  ```

---

## Phase 8 — Commit + push

Single commit on `main`. Use HEREDOC for the message:

```bash
git add \
  supabase/migrations/089_task_backfill_map_link_expected_rpcs.sql \
  packages/types/database.ts \
  apps/erp/src/components/tasks/tasks-table.tsx \
  apps/erp/src/app/\(erp\)/tasks/page.tsx \
  apps/erp/src/lib/leads-actions.ts \
  apps/erp/src/components/leads/lead-form.tsx \
  apps/erp/src/app/\(erp\)/sales/\[id\]/page.tsx \
  apps/erp/src/app/\(erp\)/design/\[leadId\]/page.tsx \
  apps/erp/src/lib/dashboard-expected-queries.ts \
  apps/erp/src/components/dashboard/expected-orders-card.tsx \
  apps/erp/src/components/dashboard/expected-payments-card.tsx \
  apps/erp/src/app/\(erp\)/dashboard/founder-dashboard.tsx \
  apps/erp/src/app/\(erp\)/cash/page.tsx \
  apps/erp/src/lib/tasks-queries.ts \
  docs/CHANGELOG.md \
  docs/CURRENT_STATUS.md \
  docs/modules/sales.md \
  docs/modules/finance.md \
  docs/superpowers/specs/2026-05-01-task-sync-map-link-expected-orders-design.md \
  docs/superpowers/plans/2026-05-01-task-sync-map-link-expected-orders-plan.md
```

(adjust file list to actual files touched — Sonnet to enumerate via `git status` first; do **not** stage `.superpowers/` or other untracked folders).

```bash
git commit -m "$(cat <<'EOF'
feat: task sync + map link + expected orders/payments

Migration 089:
- Backfill payment-followup/escalation tasks to marketing_manager
  (Prem) — they fell through to PMs when no marketing_manager
  existed at trigger-fire time
- Add leads.map_link (optional, mirrors projects.location_map_link)
- Trigger update: lead.map_link → project.location_map_link on win
- New RPCs: get_expected_orders(window_days) +
  get_expected_payments(window_days) — date arithmetic in SQL

UI:
- /tasks: rename "Project Name" → "Client"; resolve client name for
  lead-linked tasks (not just project-linked)
- /sales/new + /sales/[id] + /design/[leadId]: map link surfaces
- /dashboard: new Expected Orders + Expected Payments cards
  (this week + this month)
- /cash: Expected Payments card between KPIs and positions table

Reported by Prem (task sync, marketing columns) + Vivek (map link,
dashboard cards). Authorized to push to main overnight.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

git push origin main
```

**Verify push succeeded** by checking the response. If it fails, stop, report.

---

## Phase 9 — Post-push verification

After push:

1. `git log --oneline -3` — confirm commit landed.
2. Check Vercel deployment via:
   ```bash
   sleep 60   # let Vercel pick up the push
   curl -sI https://erp.shiroienergy.com/dashboard | grep -E "x-vercel|x-matched|location"
   curl -s -o /dev/null -w "HTTP %{http_code}\n" -L https://erp.shiroienergy.com/payments/tracker
   ```
   Expect `307 → /login` (or `200`) — anything in the 200/300 range means Vercel served the build.
3. `gh run list --branch main --limit 2` — confirm CI green.

---

## Stop conditions

Stop and report (don't push, don't continue):

- Pre-flight verification fails (Prem's role isn't `marketing_manager`, branch isn't `main`, etc.).
- `pg_proc` lookup of `create_project_from_accepted_proposal` returns 0 rows. Search for the actual function name (`fn_create_project_from_accepted_proposal`, `auto_create_project_from_proposal`, etc.) and confirm before applying.
- Migration apply errors.
- Type-regen drops or breaks an existing field.
- `pnpm check-types`, `pnpm lint`, or `pnpm build --filter erp` fails.
- Forbidden-pattern gate regresses past baseline 64.
- Push fails (e.g. ahead/behind state).

When stopping, report the failure inline so Vivek can read it and decide.

---

## What NOT to do

- Do not regenerate `database.ts` by hand-editing.
- Do not add `as any` in new code.
- Do not aggregate money in JS — both new RPCs do it in SQL; query helpers just shape rows.
- Do not touch prod (`kfkydkwycgijvexqiysc`).
- Do not amend or rewrite prior commits.
- Do not bundle drive-by refactors (e.g. fixing pre-existing `as any` elsewhere). Stay focused.
- Do not skip the trigger update — it's the link between Ask 3 and the projects module.
- Do not add per-role variations of the dashboard cards. Founder + marketing_manager (which falls through to FounderDashboard) see the same content; that's the intended state.
- Do not push to main from a different branch — push only from `main` after merging directly into it.
