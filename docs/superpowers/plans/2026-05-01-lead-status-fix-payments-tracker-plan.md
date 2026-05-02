# Implementation Plan — Lead Status Fix + Payments Tracker

> Date: 2026-05-01
> Spec: `docs/superpowers/specs/2026-05-01-lead-status-fix-payments-tracker-design.md`
> Executor: Sonnet (subagent)
> Reviewer: Vivek

This plan is written so Sonnet can execute it in order, verifying after each phase. Each phase has a clear "Definition of Done" — do **not** advance until DoD is met. Stop and report back if any step fails or its assumption turns out false.

---

## Pre-flight (Sonnet runs first, no edits)

Before touching anything:

1. Confirm working directory is `C:\Users\vivek\Projects\shiroi-erp`.
2. Confirm branch is `feat/n8n-workflow-scaffolding`. If not on it, **stop and ask** — do not switch branches.
3. Run `pnpm check-types` once to capture the baseline pass state.
4. Re-read these three files in full before editing:
   - `apps/erp/src/components/sales/status-change.tsx`
   - `apps/erp/src/lib/inline-edit-actions.ts`
   - `apps/erp/src/lib/leads-actions.ts`
   And skim:
   - `apps/erp/src/components/payments/payments-nav.tsx`
   - `apps/erp/src/app/(erp)/payments/page.tsx`
   - `apps/erp/src/lib/payments-overview-queries.ts`
5. Confirm dev project ID `actqtzoxjilqnldnacqz` for Supabase MCP calls.

DoD: Sonnet acknowledges the spec, has read the four target files, types are green at baseline.

---

## Phase 1 — Migration 088 (RLS + RPC)

**File**: `supabase/migrations/088_leads_update_rls_and_payment_tracker_rpc.sql`

Two things in one migration (both relate to "fix Prem's day"):

```sql
-- ============================================================================
-- Migration 088 — leads_update RLS hardening + payment-tracker RPC
-- Date: 2026-05-01
-- Why: (a) Prem (sales_engineer) silently failed to update unassigned leads
--      because leads_update only allowed founder/hr_manager/marketing_manager
--      OR assigned_to=self. leads_insert and leads_read both already include
--      sales_engineer; this aligns leads_update with the documented "full
--      access on leads and proposals" role definition.
--      (b) New /payments/tracker page needs an aggregate per-project rollup
--      of invoiced ₹ / sent ₹ / received ₹ / remaining ₹ — done in SQL per
--      NEVER-DO #12 (no money aggregation in JS).
-- ============================================================================

-- (a) RLS: add sales_engineer to leads_update
DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'hr_manager'::app_role,
    'marketing_manager'::app_role,
    'sales_engineer'::app_role
  ])
  OR assigned_to = get_my_employee_id()
);

-- (b) RPC: per-project payment tracker rows
CREATE OR REPLACE FUNCTION get_payment_tracker_rows()
RETURNS TABLE (
  project_id        UUID,
  project_number    TEXT,
  customer_name     TEXT,
  project_status    project_status,
  order_date        DATE,
  order_date_source TEXT,
  completed_date    DATE,
  contracted_value  NUMERIC(14,2),
  total_invoiced    NUMERIC(14,2),
  total_invoice_sent NUMERIC(14,2),
  total_received    NUMERIC(14,2),
  remaining         NUMERIC(14,2),
  days_since_order  INT
)
LANGUAGE sql
STABLE
AS $$
  WITH inv AS (
    SELECT
      project_id,
      SUM(total_amount)                                   AS total_invoiced,
      SUM(total_amount) FILTER (WHERE sent_at IS NOT NULL) AS total_invoice_sent
    FROM customer_invoices
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  pay AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM customer_payments
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  ),
  prop AS (
    SELECT lead_id, MIN(accepted_at)::date AS accepted_at
    FROM proposals
    WHERE status = 'accepted' AND accepted_at IS NOT NULL
    GROUP BY lead_id
  )
  SELECT
    p.id,
    p.project_number,
    p.customer_name,
    p.status,
    COALESCE(p.order_date, prop.accepted_at, p.created_at::date) AS order_date,
    CASE
      WHEN p.order_date    IS NOT NULL THEN 'order'
      WHEN prop.accepted_at IS NOT NULL THEN 'accepted'
      ELSE 'created'
    END AS order_date_source,
    COALESCE(p.commissioned_date, p.actual_end_date) AS completed_date,
    p.contracted_value,
    COALESCE(inv.total_invoiced, 0)     AS total_invoiced,
    COALESCE(inv.total_invoice_sent, 0) AS total_invoice_sent,
    COALESCE(pay.total_received, 0)     AS total_received,
    p.contracted_value - COALESCE(pay.total_received, 0) AS remaining,
    GREATEST(0,
      CURRENT_DATE - COALESCE(p.order_date, prop.accepted_at, p.created_at::date)
    )::int AS days_since_order
  FROM projects p
  LEFT JOIN inv  ON inv.project_id = p.id
  LEFT JOIN pay  ON pay.project_id = p.id
  LEFT JOIN prop ON prop.lead_id   = p.lead_id
  WHERE p.contracted_value > 0
  ORDER BY COALESCE(p.order_date, prop.accepted_at, p.created_at::date) ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_payment_tracker_rows() TO authenticated;
```

**Apply against dev** via Supabase MCP `apply_migration`:
- `name`: `088_leads_update_rls_and_payment_tracker_rpc`
- `query`: full SQL above

**Verify**:
1. `SELECT * FROM pg_policies WHERE tablename = 'leads' AND policyname = 'leads_update';` — `qual` should now contain `sales_engineer`.
2. `SELECT count(*) FROM get_payment_tracker_rows();` — should return ~150 rows (matches `projects` with `contracted_value > 0`).
3. Spot-check: `SELECT * FROM get_payment_tracker_rows() WHERE remaining > 0 ORDER BY days_since_order DESC LIMIT 5;` — sanity-check the oldest unpaid orders look real.

**DoD**: Migration committed at `supabase/migrations/088_…sql`, applied to dev, both verifications pass.

---

## Phase 2 — Regenerate types + strip view FKs

```bash
pnpm --filter @repo/types generate
node scripts/strip-view-fk-entries.mjs
```

**Verify**:
- `packages/types/database.ts` shows `get_payment_tracker_rows` in the `Functions` section.
- `pnpm check-types` still passes.

**DoD**: types regenerated, strip ran, types still green.

---

## Phase 3 — One-shot data fix: flip Prem's role

Single-row UPDATE via Supabase MCP `execute_sql`:

```sql
UPDATE profiles
SET role = 'marketing_manager', updated_at = now()
WHERE id = '4d6fda9c-e1e6-4c51-a3c0-895da22a2fb3'
  AND email = 'prem@shiroienergy.com'
RETURNING id, email, role;
```

The `AND email = ...` is a belt-and-braces guard: if the ID has somehow shifted, the UPDATE no-ops instead of touching the wrong row.

**Verify** in the response: `role = 'marketing_manager'`.

**DoD**: Prem's profile role flipped. Single row affected.

This is **not** committed as a migration (single-row data correction, dev-only). Document it in CHANGELOG only.

---

## Phase 4 — UX hardening: 0-row detection on lead UPDATEs

### 4.1 — `apps/erp/src/components/sales/status-change.tsx`

This is a **client component** that does `supabase.from('leads').update(updates).eq('id', leadId)` directly. Refactor the update path:

- Add `.select('id')` to the chain so Postgres returns the affected rows.
- After the call, check `error` first, then check `data?.length === 0` and surface "Update blocked — you may not have permission, or the lead no longer exists." via the existing toast mechanism.
- Keep the existing happy-path behavior identical.

### 4.2 — `apps/erp/src/lib/inline-edit-actions.ts`

This is a **server action** (`updateCellValue`) used by the data-table inline-edit machinery. It edits multiple entity types (leads, projects, etc.). Apply the same `.select('id')` + length check at the single update site. The improvement helps every entity, not just leads.

Return shape: keep whatever it currently returns on success, but on the new "0 rows affected" branch, return the existing failure shape with `error: 'Update blocked — permission denied or row missing'`.

### 4.3 — `apps/erp/src/lib/leads-actions.ts:bulkChangeLeadStatus`

Apply the same pattern. For bulk updates, `.select('id')` returns the rows that *did* update — if `data.length < leadIds.length`, surface a partial-success message: `Updated X of Y leads — check permissions for the rest`.

**Verify**:
- `pnpm check-types` clean.
- `pnpm lint` clean.
- Hand-test (Sonnet doesn't run preview; flag for Vivek to manually verify): logging in as Prem after the role flip, single status change should now persist; logging in as a `designer` (read-only) should now show "Update blocked" instead of fake success.

**DoD**: 3 files edited, types + lint clean.

---

## Phase 5 — Payments Tracker queries

**File**: `apps/erp/src/lib/payments-tracker-queries.ts` (new)

Implement exactly the shape in the spec. Reminders:

- `const op = '[getPaymentTrackerRows]';` at the top, log on failure with `{ code, message, timestamp }`.
- Numeric coercion via `Number(...)` (RPC returns NUMERIC as string in some Supabase configs).
- `computePaymentTrackerSummary` runs over the already-aggregated rows — it counts buckets and computes averages over project-level totals. This is acceptable: input is project-level rollups, not raw money rows.

For the avg-days-to-last-receipt KPI: the RPC doesn't currently return latest receipt date per project. Compute it client-side from the rows we have *or* extend the RPC to also return `latest_payment_date`. **Decision**: extend the RPC. Cleaner, keeps all aggregation in SQL.

Add to the RPC (insert into the `pay` CTE):
```sql
pay AS (
  SELECT project_id,
         SUM(amount)            AS total_received,
         MAX(payment_date)      AS latest_payment_date
  FROM customer_payments
  WHERE project_id IS NOT NULL
  GROUP BY project_id
),
```

And add to the SELECT:
```sql
pay.latest_payment_date,
```

And to the RETURNS TABLE signature: `latest_payment_date DATE,`.

**Apply this RPC change as part of migration 088** (re-run `apply_migration` with the updated SQL — that's idempotent because the function uses `CREATE OR REPLACE`). Update the spec/plan inline if the migration is already shipped — re-apply with the addition.

Also extend the TS interface `PaymentTrackerRow` with `latest_payment_date: string | null;` and surface it in the summary computation:

```ts
const projectsWithReceipts = rows.filter(r => r.latest_payment_date && r.order_date);
const avgDays = projectsWithReceipts.length === 0 ? null
  : projectsWithReceipts.reduce((sum, r) => {
      const days = differenceInDays(new Date(r.latest_payment_date!), new Date(r.order_date!));
      return sum + Math.max(0, days);
    }, 0) / projectsWithReceipts.length;
```

(Use `date-fns` `differenceInDays` if already in the bundle; fall back to manual `(d1 - d2) / 86400000` if not.)

**DoD**: query file created, types still green, an interactive `pnpm tsx -e 'import("./apps/erp/src/lib/payments-tracker-queries").then(m=>m.getPaymentTrackerRows().then(r=>console.log(r.length)))'` returns ~150 (skip if too cumbersome — page-level test in Phase 7 covers this).

---

## Phase 6 — Tracker page + table component

### 6.1 — `apps/erp/src/components/payments/payments-tracker-table.tsx` (new)

Server-rendered table. Props: `rows: PaymentTrackerRow[]`, `summary: PaymentTrackerSummary`. Render:
- KPI strip (4 cards) using `shortINR` + the summary values.
- Filter badges (Active link components, server-side `searchParams.filter` resolution stays in `page.tsx`).
- Main table with the 10 columns from the spec.
- Days-since-order chip styling: `<= 30` muted; `30–60` amber background `bg-amber-100 text-amber-800`; `>60` red.
- Order date sub-label: small muted text `(order)` / `(accepted)` / `(created)` underneath the date.
- Empty state matches `/payments/page.tsx` pattern.

Reuse `STATUS_LABEL` from `/payments/page.tsx` — extract it to a shared helper `payments-helpers.ts` if not already there, or duplicate it for v1 and accept the duplication. **Default**: extract to `apps/erp/src/components/payments/payments-helpers.ts` and update `page.tsx` to import from there. Tiny refactor, prevents drift.

### 6.2 — `apps/erp/src/app/(erp)/payments/tracker/page.tsx` (new)

Pattern after `/payments/page.tsx`:

```tsx
import { PaymentsNav } from '@/components/payments/payments-nav';
import { PaymentsTrackerTable } from '@/components/payments/payments-tracker-table';
import {
  getPaymentTrackerRows,
  computePaymentTrackerSummary,
  filterPaymentTrackerRows,
} from '@/lib/payments-tracker-queries';

interface Props {
  searchParams: Promise<{ filter?: string }>;
}

export default async function PaymentsTrackerPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = params.filter ?? 'outstanding';
  const allRows = await getPaymentTrackerRows();
  const filtered = filterPaymentTrackerRows(allRows, filter);
  const summary = computePaymentTrackerSummary(allRows); // summary always over the full set
  return (
    <div className="space-y-6">
      <PaymentsNav />
      <PaymentsTrackerTable
        rows={filtered}
        allRows={allRows}
        summary={summary}
        filter={filter}
      />
    </div>
  );
}
```

Where `filterPaymentTrackerRows(rows, filter)` is a small helper in the queries file:

```ts
export function filterPaymentTrackerRows(rows: PaymentTrackerRow[], filter: string): PaymentTrackerRow[] {
  switch (filter) {
    case 'all':              return rows;
    case 'outstanding':      return rows.filter(r => r.remaining > 0);
    case 'awaiting_invoice': return rows.filter(r => r.remaining > 0 && r.total_invoiced < r.contracted_value);
    case 'sent_unpaid':      return rows.filter(r => r.total_invoice_sent > r.total_received);
    case 'order_30d':        return rows.filter(r => r.days_since_order >= 30 && r.remaining > 0);
    case 'order_60d':        return rows.filter(r => r.days_since_order >= 60 && r.remaining > 0);
    default:                 return rows.filter(r => r.remaining > 0);
  }
}
```

### 6.3 — Update `apps/erp/src/components/payments/payments-nav.tsx`

```ts
const TABS = [
  { label: 'Project Payments', href: '/payments' },
  { label: 'Tracker', href: '/payments/tracker' },
  { label: 'Receipts', href: '/payments/receipts' },
];
```

Also: ensure the active-state detection still works for the new route. The existing logic uses `pathname === tab.href` — that's brittle for nested routes but our 3 hrefs don't nest, so it's fine.

**DoD**:
- `pnpm check-types` clean
- `pnpm lint` clean
- `pnpm dev` boots (or skip — Phase 7 confirms via build)

---

## Phase 7 — Verification

1. `pnpm check-types` from repo root — must pass.
2. `pnpm lint` from repo root — must pass with `--max-warnings 0`.
3. `bash scripts/ci/check-forbidden-patterns.sh` — must not regress baseline (66).
4. `pnpm build --filter erp` — must build cleanly.
5. Manually test on dev (Sonnet flags this for Vivek if it can't):
   - As Prem (after role flip), `/sales`, change a status — works.
   - `/payments/tracker` loads, shows projects sorted by oldest order date.
   - Filter badges switch the visible rows.
   - KPI strip shows non-zero numbers.

**DoD**: all CI gates green. Vivek to do the manual login test.

---

## Phase 8 — Documentation

After all code is in:

### 8.1 — `docs/CHANGELOG.md`

Append to the top of the active section:

```markdown
- **2026-05-01 — Lead status fix + Payments Tracker tab.** Prem reported lead-status changes silently failing — root cause: his `profiles.role` was `sales_engineer` but `leads_update` RLS only allowed update when `assigned_to = self`. Three-layer fix: (a) one-shot data correction `profiles.role → marketing_manager` (matches CLAUDE.md / module docs / payment-followup trigger expectations); (b) migration **088** adds `sales_engineer` to `leads_update` (aligns with `leads_insert` / `leads_read` and the documented "full access on leads and proposals" role); (c) `status-change.tsx`, `inline-edit-actions.ts`, and `bulkChangeLeadStatus` now use `.select('id')` + 0-row detection so future RLS-blocked UPDATEs surface "Update blocked" instead of fake success. Migration 088 also ships RPC `get_payment_tracker_rows()` powering a new **Tracker** tab on `/payments`: per-project rollup of order date, status, completed date, contracted ₹, invoiced ₹, sent ₹, received ₹, remaining ₹, days-since-order — sorted oldest-unpaid-first, with KPI strip (total outstanding, ≥30d, ≥60d, avg days order→last receipt) and 6 filter badges. Aggregations entirely in SQL (NEVER-DO #12). Files: `supabase/migrations/088_…sql`, `apps/erp/src/lib/payments-tracker-queries.ts`, `apps/erp/src/app/(erp)/payments/tracker/page.tsx`, `apps/erp/src/components/payments/{payments-tracker-table,payments-nav,payments-helpers}.tsx`. Spec: `docs/superpowers/specs/2026-05-01-lead-status-fix-payments-tracker-design.md`. Plan: `docs/superpowers/plans/2026-05-01-lead-status-fix-payments-tracker-plan.md`.
```

### 8.2 — `docs/CURRENT_STATUS.md`

Update the "Last updated" header date to `May 1, 2026` and add a row to the in-flight table marking this work as ✅ Shipped May 1.

### 8.3 — `docs/modules/sales.md`

Under **Past Decisions & Specs**, append:

```markdown
- **Migration 088** — `leads_update` RLS expanded to include `sales_engineer` (aligns with `leads_insert` / `leads_read` and documented role access). Closes silent-RLS-failure footgun where unassigned leads appeared to update successfully but did not.
```

Under **Known Gotchas**, prepend:

```markdown
- **Silent RLS failure on leads UPDATE** — fixed in `status-change.tsx`, `inline-edit-actions.ts`, and `bulkChangeLeadStatus` to call `.select('id')` and treat a zero-length response as "Update blocked". Without this, Supabase returns success on RLS-blocked UPDATEs and the UI shows a misleading "Saved" toast. Apply this pattern to any new code that updates a lead.
```

### 8.4 — `docs/modules/finance.md`

Under **Screens / Routes**, in the `/payments` bullet list, change:

```markdown
- `/payments` — tabbed (via `payments-nav.tsx`):
  - **Project Payments** — project-level payments tracker. ...
  - **Tracker** — per-project follow-up view for marketing manager: order date, completion date, invoiced ₹, sent ₹, received ₹, remaining ₹, days-since-order, KPI strip + 6 filter badges. SQL RPC `get_payment_tracker_rows()`.
  - **Receipts** — customer payment log (Tier 3, immutable).
  - **Follow-ups** (filter param, not a tab) — `PaymentFollowupsTable` ...
```

Under **RPCs**, append:

```markdown
- `get_payment_tracker_rows()` — per-project rollup of invoiced / sent / received / remaining + order/completion dates + days-since-order (migration 088). Used by `/payments/tracker`.
```

**DoD**: 4 doc files updated.

---

## Phase 9 — Commit + push

Per Vivek's standing instruction (memory: "After each step: update docs, commit, push to main").

But scope here is one logical change-set, not nine separate commits. Sonnet should:

1. Stage all changes.
2. Single commit with message:

```
fix(sales): lead status RLS for sales_engineer + UX 0-row detection

feat(payments): /payments/tracker — per-project follow-up view

- mig 088: leads_update RLS adds sales_engineer; new RPC get_payment_tracker_rows
- one-shot data fix: prem.role sales_engineer -> marketing_manager (dev only)
- 0-row detection in status-change, inline-edit-actions, bulkChangeLeadStatus
- new tracker page + table + queries; payments-nav extended

Reported by Prem. Spec + plan in docs/superpowers/.
```

3. Push to `feat/n8n-workflow-scaffolding`.

**Do not push to main** — this branch already has unpushed-to-main work (per CURRENT_STATUS, the n8n branch awaits review/merge). Stack on top.

**DoD**: commit pushed, working tree clean.

---

## What NOT to do

- Do not regenerate `database.ts` by hand-editing — only via `pnpm --filter @repo/types generate`.
- Do not push to `main`.
- Do not skip the strip-view-fk-entries script (otherwise tsc hits TS2589).
- Do not aggregate money rows in JS — all financial sums go through the RPC.
- Do not touch prod (project `kfkydkwycgijvexqiysc`).
- Do not amend or rewrite prior commits on this branch.
- Do not introduce `as any` in the new query / page / component code.
- Do not bundle drive-by refactors (e.g., fixing the existing `paymentsByProject` JS reduce in `payments-overview-queries.ts`). Stay focused.

---

## If something breaks mid-execution

If types fail, lint fails, build fails, or a verification SQL check returns surprising numbers — **stop**. Report what failed, what you saw, and your hypothesis. Do not proceed to the next phase. Do not commit half-broken code.

If the migration applies but the RPC returns 0 rows — check that `projects.contracted_value > 0` matches reality (`SELECT count(*) FROM projects WHERE contracted_value > 0;`).

If `pnpm check-types` chokes on `Functions.get_payment_tracker_rows`, suspect the strip-view-fk-entries didn't run cleanly — re-run it.
