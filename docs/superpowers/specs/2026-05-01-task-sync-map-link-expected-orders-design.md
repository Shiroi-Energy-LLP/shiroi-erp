# Task-Sync + Map Link + Expected Orders/Payments — Design

> Date: 2026-05-01
> Reporter: Vivek (with Prem feedback)
> Author: Claude (Opus, planning) → Sonnet (overnight execution + commit to main)

## Context

Four asks bundled into one overnight ship:

1. **Bug**: Task list on Prem's `/my-tasks` is missing tasks visible elsewhere (e.g. `/tasks`, `/payments?filter=followups`).
2. **UX**: Wherever the universal tasks table renders (esp. for marketing manager), it must surface client name + task status as explicit columns.
3. **Feature**: Lead form needs an optional `map_link` field, surfaced in lead detail + design workspace; copied to project on lead-won.
4. **Feature**: `/dashboard` and `/cash` need new cards showing Expected Orders (this week / month — customer + kWp + ₹) and Expected Payments (this week / month — project + milestone + ₹ + date).

All four ship in one go on `main` overnight, with explicit founder approval to push without per-step review.

---

## Ask 1 — Tasks "missing" from Prem's list

### Diagnosis (verified)

- Marketing-relevant pages (`/tasks` global view, `/payments?filter=followups`) do **not** filter by `assigned_to` — they show every task in the relevant category. Prem sees them.
- `/my-tasks` filters strictly to `assigned_to = my_employee_id`. Anything not assigned to Prem doesn't appear.
- Trigger `create_payment_followup_tasks` (mig 052) assigns to *the first active `marketing_manager` employee*, falling back to `project_manager_id` if none. Until **today (May 1, 2026)**, no `marketing_manager` employee existed (Prem's `profiles.role` was `sales_engineer`). So every existing payment-follow-up task was assigned to a PM, not Prem.

### Fix (single migration 089, two effects)

```sql
-- (a) Backfill: re-assign all open payment_followup + payment_escalation tasks to Prem.
WITH prem AS (
  SELECT e.id AS employee_id
  FROM employees e
  JOIN profiles  p ON p.id = e.profile_id
  WHERE p.role = 'marketing_manager' AND e.is_active = TRUE
  ORDER BY e.created_at ASC
  LIMIT 1
)
UPDATE tasks
SET assigned_to = (SELECT employee_id FROM prem)
WHERE category IN ('payment_followup', 'payment_escalation')
  AND is_completed = FALSE
  AND deleted_at IS NULL
  AND assigned_to IS DISTINCT FROM (SELECT employee_id FROM prem);
```

The `WITH prem AS (…)` lookup means this works without hard-coding Prem's UUID — if anyone else becomes a `marketing_manager`, they'll be picked instead, deterministically (oldest active marketing_manager wins).

The trigger itself doesn't need changing — it already does the right thing now that Prem is a `marketing_manager`. New tasks created from today onwards will go to him directly.

### Test

After applying migration 089:
```sql
SELECT count(*) FROM tasks
WHERE category IN ('payment_followup','payment_escalation')
  AND is_completed = FALSE AND deleted_at IS NULL
  AND assigned_to = (SELECT id FROM employees WHERE profile_id = '4d6fda9c-e1e6-4c51-a3c0-895da22a2fb3');
```
Should be > 0 and roughly equal to total open follow-up tasks.

Then login as Prem → `/my-tasks` should now show the previously-missing tasks.

---

## Ask 2 — Client name + Status columns on the tasks table

### Current state

- `apps/erp/src/components/tasks/tasks-table.tsx` is the universal `<tbody>` for tasks. Renders 10 columns. Already has:
  - "Project Name" column showing `projectInfo.customer_name` (renamed but not relabeled — header reads "Project Name" but value is the client's name).
  - "Status" column with an Open/Closed toggle (`TaskStatusToggle`).
- The `<thead>` lives in the parent that imports `TasksTable` — most likely `apps/erp/src/app/(erp)/tasks/page.tsx`. Sonnet will locate and update.
- For tasks where `entity_type = 'lead'` (no linked `project_id`), the Client column currently renders `—`.

### Fix

1. **Header rename**: change the "Project Name" `<th>` label to **"Client"** (the value is already the customer name).
2. **Resolve client for lead-only tasks**: extend the data loader to LEFT JOIN `leads` when `entity_type = 'lead' AND project_id IS NULL`, so those tasks show `leads.customer_name` instead of `—`. Implementation: include both `project:projects(...)` and `lead:leads(customer_name)` in the Supabase select; render `projectInfo?.customer_name ?? leadInfo?.customer_name ?? '—'` in the cell.
3. **Status column header**: ensure the `<th>` clearly reads **"Status"** (currently undocumented in the file — Sonnet to confirm + relabel if needed).
4. **No changes** to the toggle UI itself — Open / Closed already conveys task state.

### Where the table is used

- `/tasks` — global tasks list (marketing_manager sees this in their "Projects (R/O)" section per `roles.ts:108`).
- Any other consumer of `TasksTable` benefits identically (one-component fix).

The `/payments?filter=followups` view uses a different component (`PaymentFollowupsTable`) which already shows project + customer. **Out of scope for this batch** — skip touching it.

---

## Ask 3 — Map link on leads

### Schema

Migration 089 adds:

```sql
ALTER TABLE leads
  ADD COLUMN map_link TEXT NULL;

COMMENT ON COLUMN leads.map_link IS
  'Optional Google Maps URL for the customer site. Used by sales, design, and project ops.';
```

Mirrors `projects.location_map_link` (mig 033) deliberately — same semantic, same nullability, same downstream consumers.

### UI surfaces (3 sites)

1. **Lead create / edit form** (`apps/erp/src/components/leads/lead-form.tsx`):
   - New text input "Google Maps Link (optional)" placed below the address fields.
   - Light client-side validation: if non-empty, must start with `https://` and contain one of `maps.google.`, `goo.gl/maps`, or `maps.app.goo.gl`. Friendly error otherwise. Empty stays valid (optional field).
   - Plumb through `createLead` / `updateLead` in `apps/erp/src/lib/leads-actions.ts`.

2. **Lead detail "Contact Info" card** (`apps/erp/src/app/(erp)/sales/[id]/page.tsx` and the legacy `leads/[id]/page.tsx`):
   - Render "View on map ↗" as an `<a target="_blank" rel="noopener noreferrer">` when `map_link` is set; hide row when null.

3. **Design workspace** (`apps/erp/src/app/(erp)/design/[leadId]/page.tsx`):
   - Add a "Site Location" line inside the "Site Survey Summary" card: customer's address + (if `map_link` set) "Open in Maps ↗" link.
   - Designer doesn't edit the map link — read-only consumption.

### Lead-won → project copy

Find the `create_project_from_accepted_proposal` trigger (the function that spawns a project on `proposals.status = 'accepted'`). Add a single line so the new project inherits the lead's map link:

```sql
NEW.location_map_link := COALESCE(NEW.location_map_link, l.map_link);
```

(or equivalent — Sonnet to read the existing function and slot in the assignment correctly). This means a project's `location_map_link` defaults from the lead's `map_link` if not set explicitly. Existing logic that already populates `location_map_link` is preserved by `COALESCE`.

### Validation rationale

- **Optional**: yes — Vivek confirmed.
- Don't enforce hostname strictly — users sometimes paste shortened links or third-party map services. Loose match (must look like a maps URL OR plain `https://...`) is enough; the worst case is a broken link, which is repaired in <30s.

---

## Ask 4 — Expected Orders + Expected Payments cards

Two new dashboard cards, each shown on **`/dashboard`** (founder-default route — marketing_manager falls through to `FounderDashboard` per `dashboard/page.tsx:44-45`) and **`/cash`** (cash-flow management context). Same component, two render sites.

### Card A: Expected Orders

Two-section card titled **"Expected Orders"**:

- **This Week** subsection — leads with `expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`.
- **This Month** subsection — leads with `expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30` *(includes "this week" rows; visually deduped by sort order — week items appear first).*

Filtered to `status IN ('negotiation', 'closure_soon')` (the late-funnel buckets — leads that are realistically about to land). `lost`, `on_hold`, `won` excluded. `deleted_at IS NULL`.

**Each row**: customer name (clickable → `/sales/[id]`) · estimated kWp · ₹ value (`base_quote_price` || derived `estimated_size_kwp × 60000`) · expected close date · close probability % chip.

**Sort**: `expected_close_date ASC NULLS LAST, base_quote_price DESC NULLS LAST`.

**Footer**: "View all in negotiation →" → `/sales?filter=negotiation` (or wherever the existing pipeline filter lives).

### Card B: Expected Payments

Two-section card titled **"Expected Payments"**:

- **This Week** — payment milestones whose computed expected date falls in `[today, today+7]`.
- **This Month** — same with `[today, today+30]`.

Computed expected date per milestone:

```
expected_payment_date =
  CASE pps.due_trigger
    WHEN 'on_proposal_acceptance' THEN p.order_date + (pps.due_days_after_trigger || ' days')::interval
    WHEN 'on_project_start'        THEN p.actual_start_date + (pps.due_days_after_trigger || ' days')::interval
    WHEN 'on_project_completion'   THEN p.commissioned_date + (pps.due_days_after_trigger || ' days')::interval
    ELSE NULL
  END
```

Skip rows where the trigger date is NULL (project hasn't started, or hasn't completed yet for the relevant milestone). Skip rows already received (the project's `total_received` ≥ cumulative sum up to and including this milestone — to be implemented in SQL).

**Each row**: project number (clickable → `/projects/[id]`) · customer name · milestone name · ₹ amount · expected payment date · "days from now" chip.

**Sort**: `expected_payment_date ASC, amount DESC`.

**Footer**: "View payment tracker →" → `/payments/tracker`.

### Data layer

Migration 089 also adds two SQL functions (NEVER-DO #12 — keep date arithmetic in the DB):

```sql
CREATE OR REPLACE FUNCTION get_expected_orders(window_days INT)
RETURNS TABLE (
  lead_id           UUID,
  customer_name     TEXT,
  status            lead_status,
  estimated_size_kwp NUMERIC(10,2),
  base_quote_price  NUMERIC(14,2),
  derived_value     NUMERIC(14,2),
  expected_close_date DATE,
  close_probability INT,
  days_until        INT
)
LANGUAGE sql STABLE AS $$
  SELECT
    l.id,
    l.customer_name,
    l.status,
    l.estimated_size_kwp,
    l.base_quote_price,
    COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000) AS derived_value,
    l.expected_close_date,
    l.close_probability,
    GREATEST(0, l.expected_close_date - CURRENT_DATE)::int AS days_until
  FROM leads l
  WHERE l.status IN ('negotiation','closure_soon')
    AND l.deleted_at IS NULL
    AND l.expected_close_date IS NOT NULL
    AND l.expected_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
  ORDER BY l.expected_close_date ASC NULLS LAST,
           COALESCE(l.base_quote_price, l.estimated_size_kwp * 60000) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_expected_orders(INT) TO authenticated;

CREATE OR REPLACE FUNCTION get_expected_payments(window_days INT)
RETURNS TABLE (
  project_id            UUID,
  project_number        TEXT,
  customer_name         TEXT,
  milestone_name        TEXT,
  milestone_order       INT,
  amount                NUMERIC(14,2),
  expected_payment_date DATE,
  days_until            INT
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      p.id            AS project_id,
      p.project_number,
      p.customer_name,
      pps.milestone_name,
      pps.milestone_order,
      pps.amount,
      CASE pps.due_trigger
        WHEN 'on_proposal_acceptance' THEN p.order_date         + (pps.due_days_after_trigger || ' days')::interval
        WHEN 'on_project_start'       THEN p.actual_start_date  + (pps.due_days_after_trigger || ' days')::interval
        WHEN 'on_project_completion'  THEN p.commissioned_date  + (pps.due_days_after_trigger || ' days')::interval
        ELSE NULL
      END::date AS expected_payment_date,
      pps.amount AS milestone_amount
    FROM projects p
    JOIN proposals pr             ON pr.lead_id = p.lead_id AND pr.status = 'accepted'
    JOIN proposal_payment_schedule pps ON pps.proposal_id = pr.id
    WHERE p.contracted_value > 0
  ),
  with_received AS (
    SELECT b.*,
           COALESCE((SELECT SUM(amount) FROM customer_payments cp WHERE cp.project_id = b.project_id), 0) AS total_received,
           SUM(b.milestone_amount) OVER (PARTITION BY b.project_id ORDER BY b.milestone_order) AS cumulative_through_milestone
    FROM base b
  )
  SELECT
    project_id, project_number, customer_name, milestone_name, milestone_order,
    amount, expected_payment_date,
    GREATEST(0, expected_payment_date - CURRENT_DATE)::int AS days_until
  FROM with_received
  WHERE expected_payment_date IS NOT NULL
    AND expected_payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + window_days
    AND total_received < cumulative_through_milestone   -- skip already-paid milestones
  ORDER BY expected_payment_date ASC, amount DESC;
$$;

GRANT EXECUTE ON FUNCTION get_expected_payments(INT) TO authenticated;
```

**Deduplication**: the "this month" subsection includes rows from "this week". Render-time de-duping in the component (just two RPC calls — `(7)` and `(30)` — and intersect/exclude in JS for display).

### Files

**New**:
- `apps/erp/src/lib/dashboard-expected-queries.ts` — `getExpectedOrders(windowDays)`, `getExpectedPayments(windowDays)`.
- `apps/erp/src/components/dashboard/expected-orders-card.tsx`
- `apps/erp/src/components/dashboard/expected-payments-card.tsx`

**Edited**:
- `apps/erp/src/app/(erp)/dashboard/founder-dashboard.tsx` — wire in both cards (right-column placement, near `PendingApprovals` and `PipelineSummary`).
- `apps/erp/src/app/(erp)/cash/page.tsx` — render the same `ExpectedPaymentsCard` between the KPI strip and the project-cash-positions table. (Skip `ExpectedOrdersCard` on /cash — orders are sales context, payments are cash-flow context.)

---

## Migration 089 — full surface

```sql
-- ============================================================================
-- Migration 089 — Task backfill + leads.map_link + expected orders/payments
-- Date: 2026-05-01
-- Why: (1) Existing payment-followup tasks were assigned to PMs (no
--      marketing_manager existed at trigger-fire time) — backfill to Prem.
--      (2) Add map_link to leads (parallel to projects.location_map_link).
--      (3) Two new RPCs power Expected Orders + Expected Payments dashboard
--      cards (per NEVER-DO #12, all date arithmetic stays in the DB).
-- ============================================================================

-- (1) Backfill payment-followup tasks
WITH prem AS (
  SELECT e.id AS employee_id
  FROM employees e
  JOIN profiles  p ON p.id = e.profile_id
  WHERE p.role = 'marketing_manager' AND e.is_active = TRUE
  ORDER BY e.created_at ASC
  LIMIT 1
)
UPDATE tasks
SET assigned_to = (SELECT employee_id FROM prem)
WHERE category IN ('payment_followup', 'payment_escalation')
  AND is_completed = FALSE
  AND deleted_at IS NULL
  AND assigned_to IS DISTINCT FROM (SELECT employee_id FROM prem)
  AND (SELECT employee_id FROM prem) IS NOT NULL;

-- (2) leads.map_link
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS map_link TEXT NULL;

COMMENT ON COLUMN leads.map_link IS
  'Optional Google Maps URL for the customer site. Used by sales, design, and project ops.';

-- (3a) RPC: expected orders
CREATE OR REPLACE FUNCTION get_expected_orders(window_days INT)
RETURNS TABLE (...) LANGUAGE sql STABLE AS $$ ... $$;

GRANT EXECUTE ON FUNCTION get_expected_orders(INT) TO authenticated;

-- (3b) RPC: expected payments
CREATE OR REPLACE FUNCTION get_expected_payments(window_days INT)
RETURNS TABLE (...) LANGUAGE sql STABLE AS $$ ... $$;

GRANT EXECUTE ON FUNCTION get_expected_payments(INT) TO authenticated;

-- (4) Update create_project_from_accepted_proposal trigger to copy lead.map_link
--     into project.location_map_link. Surgical edit — Sonnet reads the function
--     body, slots in COALESCE in the appropriate location.
```

The trigger update is read-modify-write. Sonnet will:
1. `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'create_project_from_accepted_proposal'`
2. Identify where `location_map_link` is currently assigned (or where the project row is being constructed).
3. Add `COALESCE(<current>, l.map_link)` so existing behavior is preserved and the lead's map link only fills in when the existing source is NULL.

---

## Risks / open questions

1. **Trigger function name** — assumed `create_project_from_accepted_proposal`. Sonnet to verify with `pg_proc` query first; rename per actual identifier.
2. **`leads.customer_name` field** — verified existing on the leads Row (per Sonnet's exploration). Used both for the new map-link form and for the tasks-table client resolution.
3. **Marketing-manager dashboard fallthrough** — current `/dashboard/page.tsx` switch goes `default → FounderDashboard`. So Prem sees the founder dashboard, including these new cards. Acceptable for now; if Vivek wants a separate marketing dashboard later, extract into a new role-specific component.
4. **`/cash` placement** — adding a card to a page already dense with KPIs and tables. Place between summary cards and the project table; if it visually crowds, fall back to a collapsed-by-default `<details>` block. Sonnet to use judgment.
5. **No test harness** — Playwright smoke tests aren't wired into CI yet. Verification rests on `pnpm check-types`, `pnpm lint`, and the forbidden-pattern gate plus a successful `pnpm build`.

---

## Out of scope

- A dedicated `/marketing` page (Vivek explicitly said "just add columns").
- Mandatory map-link enforcement (optional only).
- Per-role variations of the dashboard cards.
- Editing map links in the design workspace (designers consume read-only).
- Backfill of `leads.map_link` from existing `projects.location_map_link`. Map links going forward only — the column is empty for existing rows.

---

## Acceptance criteria

1. After migration 089: at least one open `payment_followup` or `payment_escalation` task is assigned to Prem (verifiable via SQL).
2. As Prem on dev, `/my-tasks` shows the previously-missing tasks.
3. `/tasks` page shows a "Client" column header (renamed from "Project Name") and the value is populated for both project-linked and lead-linked tasks.
4. `/sales/new` form has a "Google Maps Link (optional)" input with permissive validation; saves and round-trips.
5. `/sales/[id]` Contact Info shows a clickable "View on map ↗" when set.
6. `/design/[leadId]` Site Survey Summary card shows the link.
7. When a lead is won and the project is auto-created, the project's `location_map_link` equals the lead's `map_link` (when the project doesn't already have its own).
8. `/dashboard` (as founder or marketing_manager) renders Expected Orders + Expected Payments cards with non-zero items where data exists.
9. `/cash` renders the Expected Payments card.
10. `pnpm check-types` clean. `pnpm lint` clean. Forbidden-pattern gate not regressed.
11. Single commit on `main`, pushed, `erp.shiroienergy.com` redeployed.
