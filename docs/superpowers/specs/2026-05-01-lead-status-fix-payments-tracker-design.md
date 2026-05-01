# Lead Status Fix + Payments Tracker — Design

> Date: 2026-05-01
> Branch (target): `feat/n8n-workflow-scaffolding` (current) or fresh feature branch — Vivek to decide
> Reporter: Prem (marketing manager)
> Author: Claude (Opus, planning) → Sonnet (execution)

## Context

Two reports landed together from Prem:

1. **Bug**: "Trying to change the status of leads, but it does not change."
2. **Feature ask**: "A separate payments tab for following up all of the payments. List the date of order, date of completion (or major timeline dates from projects), whether the invoice has been raised and given, amount remaining."

Both ship together because they live in adjacent surfaces (sales / payments) and both unblock Prem's daily workflow.

---

## Issue 1 — Lead status silently fails for Prem

### Root cause (confirmed against dev DB)

| Layer | State |
|---|---|
| Prem's profile row | `role = 'sales_engineer'` (id `4d6fda9c-e1e6-4c51-a3c0-895da22a2fb3`) |
| `leads_update` RLS | `(get_my_role() IN ('founder','hr_manager','marketing_manager')) OR (assigned_to = get_my_employee_id())` |
| Result | Prem can update leads only when he's `assigned_to`. For all other leads, Postgres returns 0 rows with **no error**. Supabase client treats this as success, the toast renders "Saved", but the row was never updated. |

This is the well-known Supabase RLS silent-failure footgun: a row-blocked UPDATE is indistinguishable from a successful UPDATE that matched no rows, unless the client requests the changed row back via `.select()` and checks the returned array length.

There are also two separate misalignments uncovered along the way:

1. **Data drift**: every doc, trigger, and role-routing rule (`create_payment_followup_tasks`, `apps/erp/src/lib/roles.ts`, modules/sales.md, CLAUDE.md) treats Prem as `marketing_manager`. The `marketing_manager` role was added in migration 052 specifically for him. But his `profiles.role` was never flipped from the original `sales_engineer`. So the system is half-routing him through marketing_manager paths (digests, follow-up assignments, sidebar nav) and half through sales_engineer paths (RLS).
2. **Policy inconsistency**: `leads_insert` includes `sales_engineer` (migration 002a + 052), `leads_read` includes `sales_engineer`, but `leads_update` does not. Per modules/sales.md, sales_engineer "full access on leads and proposals" — the UPDATE policy is the outlier.

### Fix — three layers

**Layer A — data correction (one-shot UPDATE, not a migration):**

```sql
UPDATE profiles
SET role = 'marketing_manager', updated_at = now()
WHERE id = '4d6fda9c-e1e6-4c51-a3c0-895da22a2fb3';
```

This is a single row, run once, against dev. We track it in CHANGELOG, not as a migration (consistent with how prior single-row data fixes have been handled). No prod equivalent yet — Prem doesn't exist on prod.

**Layer B — RLS hardening (migration 088):**

```sql
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
```

Aligns with `leads_insert` and `leads_read`. Future sales engineers won't trip the same silent failure. Idempotent (DROP IF EXISTS).

**Layer C — UX fix (defense in depth):**

Both lead-status update paths currently treat 0-row-affected as success:

- `apps/erp/src/components/sales/status-change.tsx` — client-side `supabase.from('leads').update(updates).eq('id', leadId)` then checks `error` only.
- `apps/erp/src/lib/inline-edit-actions.ts` — server action `updateCellValue` does the same.

Both should be hardened to detect "RLS-blocked / not found" and surface a clear error. Pattern:

```ts
const { data, error } = await supabase
  .from('leads')
  .update(updates)
  .eq('id', leadId)
  .select('id'); // forces returning the affected rows

if (error) return { success: false, error: error.message };
if (!data || data.length === 0) {
  return { success: false, error: 'Update blocked — you may not have permission, or the lead no longer exists.' };
}
```

Apply the same shape to `inline-edit-actions.ts` (any entity it touches — leads, projects, etc. all benefit).

Bulk path (`leads-actions.ts:bulkChangeLeadStatus`) gets the same `.select('id')` treatment.

### Test scope

- Manual: as Prem, change the status of an unassigned lead — toast should now succeed (after Layer A flips his role).
- Manual: log in as a fresh sales_engineer (test account if available), change a lead's status — succeeds (after Layer B).
- Manual: simulate the silent-failure case (e.g., a finance user trying to update) — toast surfaces "Update blocked" instead of the bogus success (Layer C).
- Existing Playwright `e2e/smoke.spec.ts` should still pass.

---

## Issue 2 — Payments Tracker tab

### Goals

Give Prem a single screen to drive his payment-collection follow-ups: which orders are open, what's been invoiced, what's been sent, what's still owed, and how old each one is.

### Non-goals

- Not replacing `/payments` (Project Payments) — that view is the finance/P&L lens (project value, invested, P&L). The new tab is the **collection workflow lens**.
- Not building per-milestone editing — Prem reads here, edits on `/projects/[id]?tab=payments` and `/invoices`.
- Not a dashboard. Per-row detail. KPI strip is for orientation only.

### UX

**Route**: `/payments/tracker`

**Sidebar nav**: already exposes `/payments` — Prem reaches the new tab through the existing PaymentsNav.

**Updated `payments-nav.tsx` tabs**:

```ts
const TABS = [
  { label: 'Project Payments', href: '/payments' },
  { label: 'Tracker', href: '/payments/tracker' },     // ← new
  { label: 'Receipts', href: '/payments/receipts' },
];
```

**KPI strip (4 cards)**:

| Card | Computation |
|---|---|
| Total Outstanding | SUM(remaining) across all rows where remaining > 0 |
| Outstanding ≥30d | SUM(remaining) where order_date ≤ today − 30d AND remaining > 0 |
| Outstanding ≥60d | SUM(remaining) where order_date ≤ today − 60d AND remaining > 0 |
| Avg days order → last receipt | AVG(latest_payment_date − order_date) for projects with at least one receipt |

**Filter badges (single-select, query param `?filter=…`)**:

- All
- Outstanding (default — `remaining > 0`)
- Awaiting next invoice (`remaining > 0 AND total_invoiced < contracted_value`)
- Sent unpaid (`total_sent > total_received`)
- Order ≥30d
- Order ≥60d

**Table columns** (one row per project, sorted by `order_date ASC NULLS LAST` so oldest unpaid floats up):

| # | Column | Source / formula |
|---|---|---|
| 1 | Project / Customer | `project_number` (mono small) + `customer_name`; clickable → `/projects/[id]` |
| 2 | Order Date | `COALESCE(projects.order_date, proposals.accepted_at::date, projects.created_at::date)` — labelled `(order)`, `(accepted)`, or `(created)` underneath in muted xs text so Prem knows the source |
| 3 | Status | `STATUS_LABEL[projects.status]` (reuse the map already in `/payments/page.tsx`) |
| 4 | Completed | `COALESCE(projects.commissioned_date, projects.actual_end_date)` — em dash if neither set |
| 5 | Contract ₹ | `projects.contracted_value` |
| 6 | Invoiced ₹ | `SUM(customer_invoices.total_amount) WHERE project_id = p.id` |
| 7 | Sent ₹ | `SUM(customer_invoices.total_amount) WHERE project_id = p.id AND sent_at IS NOT NULL` |
| 8 | Received ₹ | `SUM(customer_payments.amount) WHERE project_id = p.id` |
| 9 | Remaining ₹ | `contracted_value − total_received` (red bold if > 0) |
| 10 | Days since order | `today − order_date` — amber chip ≥30, red chip ≥60 |

Aggregate amounts (₹) chosen over fraction counts per founder review — prefer "Invoiced ₹15L of ₹20L contract" over "2/4 milestones invoiced" because the rupee figure surfaces under-invoicing risk directly.

**No "Action" column for v1** — clicking the project row navigates to `/projects/[id]` where invoice/payment actions already live. Avoid duplicating buttons across screens.

**Empty state**: `EmptyState` with `DollarSign` icon, "No projects match this filter" — same pattern as the existing Overview.

### Data layer

**New SQL RPC `get_payment_tracker_rows()`** in migration 088 (alongside the RLS fix):

```sql
CREATE OR REPLACE FUNCTION get_payment_tracker_rows()
RETURNS TABLE (
  project_id UUID,
  project_number TEXT,
  customer_name TEXT,
  project_status project_status,
  order_date DATE,
  order_date_source TEXT,                 -- 'order' | 'accepted' | 'created'
  completed_date DATE,
  contracted_value NUMERIC(14,2),
  total_invoiced NUMERIC(14,2),
  total_invoice_sent NUMERIC(14,2),
  total_received NUMERIC(14,2),
  remaining NUMERIC(14,2),
  days_since_order INT
)
LANGUAGE sql
STABLE
AS $$
  WITH inv AS (
    SELECT
      project_id,
      SUM(total_amount)                                  AS total_invoiced,
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
      WHEN p.order_date IS NOT NULL THEN 'order'
      WHEN prop.accepted_at IS NOT NULL THEN 'accepted'
      ELSE 'created'
    END AS order_date_source,
    COALESCE(p.commissioned_date, p.actual_end_date) AS completed_date,
    p.contracted_value,
    COALESCE(inv.total_invoiced, 0)        AS total_invoiced,
    COALESCE(inv.total_invoice_sent, 0)    AS total_invoice_sent,
    COALESCE(pay.total_received, 0)        AS total_received,
    p.contracted_value - COALESCE(pay.total_received, 0) AS remaining,
    GREATEST(0,
      CURRENT_DATE - COALESCE(p.order_date, prop.accepted_at, p.created_at::date)
    )::int AS days_since_order
  FROM projects p
  LEFT JOIN inv  ON inv.project_id  = p.id
  LEFT JOIN pay  ON pay.project_id  = p.id
  LEFT JOIN prop ON prop.lead_id    = p.lead_id
  WHERE p.contracted_value > 0
  ORDER BY COALESCE(p.order_date, prop.accepted_at, p.created_at::date) ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_payment_tracker_rows() TO authenticated;
```

Aggregates run in SQL (NEVER-DO #12 compliant). Indexes already exist on `customer_invoices.project_id`, `customer_payments.project_id`, `projects.contracted_value > 0` filtering scans the projects-with-money slice.

**New query function** `getPaymentTrackerRows()` in `apps/erp/src/lib/payments-tracker-queries.ts`:

```ts
import { createClient } from '@repo/supabase/server';

export interface PaymentTrackerRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  project_status: string;
  order_date: string | null;
  order_date_source: 'order' | 'accepted' | 'created';
  completed_date: string | null;
  contracted_value: number;
  total_invoiced: number;
  total_invoice_sent: number;
  total_received: number;
  remaining: number;
  days_since_order: number;
}

export async function getPaymentTrackerRows(): Promise<PaymentTrackerRow[]> {
  const op = '[getPaymentTrackerRows]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_payment_tracker_rows');
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    throw new Error(`Failed to load payment tracker: ${error.message}`);
  }
  return (data ?? []).map((row: any) => ({
    project_id: row.project_id,
    project_number: row.project_number,
    customer_name: row.customer_name,
    project_status: row.project_status,
    order_date: row.order_date,
    order_date_source: row.order_date_source,
    completed_date: row.completed_date,
    contracted_value: Number(row.contracted_value),
    total_invoiced: Number(row.total_invoiced),
    total_invoice_sent: Number(row.total_invoice_sent),
    total_received: Number(row.total_received),
    remaining: Number(row.remaining),
    days_since_order: row.days_since_order,
  }));
}

export interface PaymentTrackerSummary {
  total_outstanding: number;
  outstanding_30d: number;
  outstanding_60d: number;
  avg_days_to_last_receipt: number | null;
}

export function computePaymentTrackerSummary(rows: PaymentTrackerRow[]): PaymentTrackerSummary {
  // straightforward aggregations on already-aggregated rows (no money-row .reduce — already SQL-aggregated)
}
```

The `compute*Summary` runs over already-aggregated tracker rows (one per project), not raw money rows. Same pattern as `computePaymentsSummary` in `payments-overview-queries.ts`, which is acceptable because the input is already a project-level rollup.

**Page**: `apps/erp/src/app/(erp)/payments/tracker/page.tsx`

Server component. Server-side filter resolution off `searchParams.filter`. Renders `PaymentTrackerTable`.

**Component**: `apps/erp/src/components/payments/payments-tracker-table.tsx`

Client-friendly server-rendered table (matches the pattern of `payments/page.tsx`). Days-since chips in amber/red. Empty state. No interactivity beyond row → project link.

### Role access

`marketing_manager`, `founder`, `finance` — all already have `/payments` in `roles.ts`. No nav change required for `marketing_manager` or `founder`. Confirm `finance` sees the new tab too (it should — same nav).

### Performance

- One RPC call → ~150 projects with money. Sub-second.
- Tracker is a low-frequency screen (Prem opens 1–2× per day). No caching needed for v1; revisit if perf complaint surfaces.
- Indexes already in place on `customer_invoices.project_id`, `customer_payments.project_id`, `proposals.lead_id`.

---

## Risks / open questions

1. **Prem's profile role flip** ripples through `roles.ts` sidebar. Confirm: after the flip, Prem sees the marketing_manager nav (Sales / Design / Liaison / Payments / etc.). Already that's the intended state, but worth a manual login test post-deploy.
2. **`commissioned_date` vs `actual_end_date`** — sparse on most projects right now (the field-tracking discipline is uneven). The "Completed" column will frequently render `—`. Acceptable for v1; flag for later if Prem asks "why is completion blank".
3. **`order_date` source label** — adds complexity (3-way COALESCE). If Vivek finds this noisy, simplify to just `order_date OR accepted_at` (drop `created_at`) and label all source-mixed rows uniformly. v1 keeps the labels for transparency.
4. **No prod migration of Prem's data fix yet** — single-row data correction lives only on dev. Prod doesn't have his profile yet. When the prod cutover happens, follow CHANGELOG breadcrumb.

---

## Out of scope for this batch

- WhatsApp template "weekly outstanding digest for marketing_manager" (would consume tracker rows). Add to n8n Tier 2 later.
- Per-milestone invoice timeline view (drill-down). v1 row click → `/projects/[id]` where this already exists.
- Reconciling the existing Project Payments overview's NEVER-DO #12 violation (`paymentsByProject` JS reduce). Pre-existing; not in this batch.
- Updating `inline-edit-actions.ts` for entities other than `leads` (the same silent-failure pattern affects every entity it touches). v1 fixes the helper for all callers since the change is single-file; no per-entity work.

---

## Files touched (rollup)

**New files:**
- `supabase/migrations/088_leads_update_rls_and_payment_tracker_rpc.sql`
- `apps/erp/src/app/(erp)/payments/tracker/page.tsx`
- `apps/erp/src/components/payments/payments-tracker-table.tsx`
- `apps/erp/src/lib/payments-tracker-queries.ts`

**Edited:**
- `apps/erp/src/components/payments/payments-nav.tsx` — add Tracker tab
- `apps/erp/src/components/sales/status-change.tsx` — `.select('id')` + 0-row check
- `apps/erp/src/lib/inline-edit-actions.ts` — same pattern, applies to every entity it edits
- `apps/erp/src/lib/leads-actions.ts` — same pattern in `bulkChangeLeadStatus`
- `packages/types/database.ts` — regenerated after migration 088
- `docs/CHANGELOG.md` — append entry
- `docs/CURRENT_STATUS.md` — note ship
- `docs/modules/sales.md` — note RLS fix in Past Decisions
- `docs/modules/finance.md` — add Tracker tab to Screens / Routes

**Data ops (run once, dev only):**
- One-shot SQL: flip Prem's profile role to `marketing_manager`.

---

## Acceptance criteria

1. Prem (after role flip) opens `/sales`, double-clicks a status badge on any lead, picks a new status — toast says "Saved", row updates, refresh confirms.
2. Same scenario as above on `/sales/[id]` Details page via the StatusChange dropdown — works.
3. A user without UPDATE permission attempting the same gets a clear "Update blocked" error toast (manually verifiable by temporarily testing as a `designer`-role user, or by reading the new code path).
4. `/payments/tracker` loads, shows ~150 project rows sorted by oldest order date, with the 10 columns above populated. KPI strip shows non-zero numbers.
5. Each filter badge changes the visible rows correctly.
6. `pnpm check-types` clean. `pnpm lint` clean. Forbidden-patterns gate not regressed.
