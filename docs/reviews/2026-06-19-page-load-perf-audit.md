# Page-Load Performance Audit & Suggested Changes

**Date:** 2026-06-19
**Scope:** Server-side data-fetch cost of every ERP page (`apps/erp/src/app/(erp)/**`).
**Method:** Static analysis of each page's render-path fetches (layout + page + the `*-queries.ts`/`*-actions.ts` they call) cross-checked against live measurements on the **dev** Supabase instance (`actqtzoxjilqnldnacqz`): `EXPLAIN (ANALYZE, BUFFERS)`, `pg_class` row estimates, `pg_indexes`, `pg_extension`, RPC bodies.
**Environment caveat:** dev is a CPU/RAM-starved ~1 GB instance (see `memory/project_dev_db_perf_throttle.md`). Absolute timings will be lower on a bigger box, but the *structural* findings (round-trip count, waterfalls, auth duplication) are environment-independent.

---

## TL;DR — one disease, many symptoms

No list/detail query I measured is individually heavy. Every one executes in **4–33 ms warm**. Pages feel slow because each one:

1. fires **8–15 separate Supabase round-trips**,
2. **2–4 of which are network calls to the auth server** (`auth.getUser()`),
3. arranged in **sequential waterfalls** rather than parallel batches,
4. against an instance that keeps evicting its catalog cache → each query repeatedly pays **57–68 ms of cold *planning*** on top of its few-ms execution.

Measured proof of (4): `projects` (95 columns, 14 indexes) — execution **4–10 ms**, planning **57–68 ms cold / 1.5 ms warm**. `leads` (19 indexes) — execution **33 ms**, planning **63 ms cold**.

**So the highest-leverage work is global, not per-page.** Fix the cross-cutting causes (Part 1) and almost every page gets faster at once. Part 2 is the per-page detail; Part 3 is the prioritised worklist.

All work below is **dev-only** until a prod window is green-lit (`memory/project_dev_only_no_prod.md`).

---

## Execution status (updated 2026-06-19)

Worked across two parallel sessions. **Done + pushed:**
- **[G1]** request-scoped session cache (`getAuthUser`/`getSessionContext` split) — the per-render `auth.getUser()` storm deduped across ~25 pages; the only place an `unstable_cache`/module-scope memo would bleed sessions, so guarded by NEVER-DO #22.
- **[G2]** `pg_trgm` + 14 GIN search indexes + `idx_tasks_milestone_id` (mig 190).
- Projects sub-route guards → `getProjectHeader` (drops the module's heaviest query from 5 routes); `/sales` list `getLeads` folded into the parallel batch + redundant closing-window scan dropped.
- Correctness: `getEmployeeCompensation` self-view restored (compared `profiles.id` to `employees.id` → dead branch).
- Structural dedup: payment **and** invoice action merges (canonical + thin wrappers, regression-tested — the payment one preserves the n8n commission emit via an explicit `notify` flag, master-ref §4.19); 5 employee-dropdown helpers → 1; label maps centralized.
- **`/procurement/orders` pagination + dashboard counts (mig 192).** `getPurchaseOrders` was a bare `.limit(100)` showing 100 of ~2,046 POs (correctness bug); now selects the ~7 displayed columns with `count:'estimated'` + `.range()`, returns `{rows,total}`, and the page has a filter-preserving pager. The purchase dashboard's three status KPIs (which shared that capped fetch and so also undercounted) now come from new SECURITY-INVOKER RPC `get_purchase_order_status_counts` — one `COUNT(*) FILTER` pass over the full table (NEVER-DO #12/#13/#25). Verified on dev: 2,046 POs, counts pending 77 / active 20 / pending-deliveries 20.
- **`createDraftDetailedProposal` write-during-render fixed (NEVER-DO #24).** Both `leads/[id]/proposal` (re-exported by `sales/[id]/proposal`) and `design/[leadId]` no longer auto-create the draft during render — the INSERT (and the `proposal.requested` n8n event that WhatsApps the design head) now fires only from an explicit `StartDetailedProposalButton` click → `router.refresh()` reveals the BOM editor. Vivek signed off on the explicit-button UX (vs. DB-level idempotency). No migration; the button shows in exactly the stages auto-create used to.

- **[G6] bom-review + data-quality count clusters → summary RPCs (mig 194).** `/bom-review` replaced 3 `count:exact` on ~24.7k `proposal_bom_lines` rows + a `data_flags` count + an unbounded `item_category` JS tally with one `get_bom_review_summary()` pass (verified on dev: 24,699 = 24,683 with-rate + 16 no-rate, + per-category breakdown). `/data-quality` replaced 6 `count:exact` (`data_flags` ×3 + `leads`/`projects`/`proposals` verified ×3) with `get_data_quality_summary()`. Both SECURITY INVOKER; `database.ts` regenerated in-commit.
- **`getProject` embed-trim.** After the sub-route swap, the Details tab is `getProject`'s only caller and reads scalar columns only — so its 5 nested embeds (milestones+components, delay_log+joins, change_orders+joins, 2 employee joins) were dropped → `SELECT *`. Removes the module's heaviest embed fan-out from the detail page.

**Still open (focused pass — these are real refactors, NOT quick edits):**
- **[G5] lazy-load eager dialog/dropdown data.** Bigger than it looks: the "eager" lists usually feed *both* a closed dialog *and* the table/page — e.g. `/tasks` passes its 478-project list to `CreateTaskDialog` **and** `TasksTable`'s per-row edit; also `/om/inverters` (1,000 projects + creds), `/om/amc` (~700 + employees), `/price-book` (3 facet scans), `/sales/[id]/proposal` (full `price_book`). Each needs *both* consumers rewired to fetch on-open — it touches core create/edit flows, so it deserves a dedicated pass rather than a rushed edit.
- **Remaining JS-money→RPC ([G6]):** `getProjectFinancials` (projects detail — 3 parallel reads + JS reduce), the reconciliation page, `/om/profitability` totals, `/procurement` list `getPurchaseRequests`.
- **`SELECT *` trims + NEVER-DO #15 inline-query moves:** `/qc-gates`, `/daily-reports`, and `getMSMEAlertPOs` (push the `is_msme` filter into SQL).

---

## Part 1 — Global fixes (do these first; each touches many pages)

These are referenced as `[G1]`…`[G6]` in the per-page sections.

### [G1] Request-memoize `auth.getUser()` / `getUserProfile()` — **biggest single win**
`supabase.auth.getUser()` is a **network round-trip to the GoTrue auth server** (~100–300 ms). The middleware (`packages/supabase/src/middleware.ts:51`) does one on every request; its own comment says *"getUser() contacts the Auth server."* Then the `(erp)` layout (`auth.ts` `requireAuth`/`getUserProfile`) does another, and **every** role helper does its own again: `getUserProfile`, `getCallerRole`, `getCurrentUserRole`, `requireRole`, `getMyViews`, `getExpenseKPIs`, `getEmployeeCompensation`.

Observed duplication: `/hr/[id]` and `/hr/employees/[id]` resolve the profile **3×**; `/sales/[id]` tabs do it 2–3×; `/dashboard` re-fetches in each sub-dashboard.

**Change:** wrap the identity resolver in React `cache()` so it runs **once per request** and is shared by every caller in that render; thread the resolved `{ userId, role, employeeId, profile }` into helpers/components instead of re-calling. `cache()` dedupes within a single server render pass.

```ts
// auth.ts
import { cache } from 'react';
export const getSessionContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();   // the ONE network call
  if (!user) return { userId: null, role: null, employeeId: null, profile: null };
  // single combined lookup (or two cached ones) instead of N scattered re-fetches
  const { data: profile } = await supabase.from('profiles')
    .select('id, role, full_name').eq('id', user.id).maybeSingle();
  return { userId: user.id, role: profile?.role ?? null, profile, employeeId: /* … */ };
});
```
Then `getUserProfile`, `getCallerRole`, `getCurrentUserRole`, `requireRole`, `getMyViews`, `getExpenseKPIs` all call `getSessionContext()` instead of their own `getUser()`.
**Bonus:** `getCallerRole` (`project-detail-actions.ts:78`) currently also issues an `employees` query that most callers don't use (only `role` is consumed) — drop it from the role-only path. It's the 3-RTT auth prefix on the bom/materials/performance/certificates/documents tabs.
**Impact:** removes 1–3 network round-trips from ~25 pages. **Risk:** low (no behaviour change). **Effort:** one helper + mechanical call-site edits.

### [G2] Install `pg_trgm` + GIN indexes — fixes every search box
`pg_trgm` is **not installed** (confirmed: only `pg_cron, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp, vector`). Every search box does `col ILIKE '%term%'` (leading wildcard) which **cannot use a B-tree** → sequential scan. Measured: `/contacts` search = **32 ms seq scan** (reads all 1,390 rows to return 29) and is also exact-`COUNT(*) OVER()`-ed.

**Change (one migration):**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY idx_contacts_name_trgm  ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_contacts_phone_trgm ON contacts USING gin (phone gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_contacts_email_trgm ON contacts USING gin (email gin_trgm_ops);
-- repeat for companies(name,city,gstin), leads(customer_name,phone), price_book(item_description,brand,vendor_name),
-- projects(project_number,customer_name), tasks(title)
```
Affects search on: `/contacts`, `/companies`, `/sales`, `/projects`, `/price-book`, `/procurement`, `/procurement/orders`, `/expenses`, `/tasks`, `/activities`.
**Impact:** turns every search seq-scan into an index scan. **Risk:** low. **Effort:** one migration (+ regen types is not needed — no schema columns change).

### [G3] Upsize the dev compute instance
The 57–68 ms cold-planning measured on every query is the starved instance evicting catalog cache. This is the largest single wall-clock lever for dev specifically and is already on record. Not a code change — an infra decision.

### [G4] Kill the "auth-gate then fetch" waterfall pattern
Many pages `await requireRole()/getUserProfile()` **alone**, then start their data `Promise.all`. The gate result only decides a redirect; the data fetch rarely depends on it. After `[G1]` makes the gate cheap, also **fold independent fetches into one `Promise.all`** so the gate isn't a serial pre-stage. (Pages: `/hr`, `/hr/leave`, `/om/inverters`, `/om/profitability`, `/procurement/requisitions`, `/cash/orphan-invoices`, `/expenses`, `/sales` list, `/sales/[id]` layout.)

### [G5] Stop fetching dialog/dropdown data eagerly
Several pages fetch large option lists on **every** load even though the dialog/combobox is closed by default: `/om/inverters` (1,000 projects), `/om/amc` (~700 projects), `/sales/[id]/proposal` & `/price-book` (entire `price_book`), `/tasks` & `/activities` (478 projects). **Change:** load these on dialog-open (client fetch / server action) or behind the combobox, not on first paint.

### [G6] Replace `count: 'exact'` on large tables + JS money aggregation
- `count: 'exact'` on big tables (NEVER-DO #13): `/bom-review` (3× over `proposal_bom_lines` = 24,656 rows, **56 ms each** measured), `/data-quality` (7×, incl. `leads`/`proposals` ~1.3 k). Use `count: 'estimated'` or a single `GROUP BY … COUNT(*) FILTER(…)` RPC. *(The PM-dashboard exact counts hit `tasks`=233 + tiny O&M tables — leave them, low impact.)*
- JS money aggregation (NEVER-DO #12): PM dashboard (`Decimal.reduce` over money), `/procurement` list, `/sales/[id]/payments`, `/procurement/reconciliation`, `/msme-compliance`. Push into a SQL RPC.

**One reassuring negative finding:** the recent migration 188/189 index drops were verified **safe** — every FK/filter column flagged in this audit still has a supporting index. Not a regression source.

---

## Part 2 — Per-page suggested changes

Format per page: **Load today** (round-trips / `getUser` count / parallel-vs-waterfall) → **What's heavy** → **Suggested changes**.

---

## SALES / LEADS
> The user's "leads page" is **`/sales`** — middleware 307-redirects `/leads` → `/sales`. **Only `leads/page.tsx` + `leads/loading.tsx` are dead** (the list view, now unreachable). The rest of `leads/**` is **live**: `/sales/[id]`, its 5 tabs, and `/sales/new` are thin `export { default } from '../../leads/[id]/…'` re-exports of the `leads/**` files (verified 2026-06-19) — deleting them breaks the entire sales-detail experience. To "clean up", **invert** the re-export (make `sales/**` the real files and `leads/**` the redirect) — a refactor, not a delete.

### `/sales` (the leads list)
- **Load today:** ~11 round-trips, 1 `getUser` (via `getMyViews`), **2-stage waterfall** — a 9-way `Promise.all` (`sales/page.tsx:105`) then `getLeads` awaited *separately* (`:158`).
- **What's heavy:**
  - `getLeads` (`leads-queries.ts:56`) is the heaviest query (28 cols × 3 embeds × 50 rows) yet it's **serialized after** 9 other fetches it doesn't depend on (on the default load). Measured warm 33 ms / cold-plan 63 ms.
  - `getLeadsClosingBetween` (`leads-pipeline-queries.ts:71`) re-scans `leads` for the *week* window purely to use `.length` — but `getPipelineCloseWindow` (`:42`) already returns that count for the same window. Redundant scan.
  - `getInternalReferrers` + `getReferralPartners` both scan `channel_partners` with near-identical filters (2 round-trips → 1).
  - `getMyViews` (`views-actions.ts:7`) is the page's only `getUser`.
- **Suggested changes:**
  1. **Fold `getLeads` into the Stage-1 `Promise.all`** for the common path (no `referrer=internal_all`). Branch only when `referrerIds` is actually needed. ~halves the critical path. *(The dead `leads/page.tsx` already had the correct single-`Promise.all` shape.)*
  2. Drop `getLeadsClosingBetween`; derive the week count from the existing week `getPipelineCloseWindow` result (`.leadCount`).
  3. Apply `[G1]` (getMyViews shares the cached session) and `[G2]` (leads trgm for the search RPC).
  4. `getLeadStageCounts` is already `unstable_cache`(30 s) + SQL RPC — leave it.

### `/sales/[id]` (lead/project detail — **every tab pays the layout cost**)
- **Load today:** layout = **6 sequential awaits** + 1 `getUser`, then the tab's own fetches. `getLead` (`SELECT *`) is re-fetched in the layout **and** in every tab.
- **What's heavy:**
  - `leads/[id]/layout.tsx` runs `getLead → getUserProfile → computeMargin? → leadHasProject? → leadHasProposal → leadHasDetailedProposal?` as six serial `await`s though all are independent given `lead`.
  - `getLead` (`leads-queries.ts:192`, `SELECT *`) fetched in layout (`:26`) and again in the tab (details `:17`, activities, files, tasks, payments, proposal). Same row, 2× per view.
  - `computeMargin` (`closure-actions.ts:48`) is itself 3 serial round-trips for `closure_soon`/`negotiation` leads.
- **Suggested changes:**
  1. Fetch `getLead` **once** in the layout, pass it to children (or wrap `getLead` in `cache()` so the tab's call is free).
  2. `Promise.all` the layout's 4 independent boolean checks (`leadHasProject`, `leadHasProposal`, `leadHasDetailedProposal`, `computeMargin`).
  3. Apply `[G1]`.

### `/sales/[id]/proposal`
- **Load today:** ~9 round-trips. **What's heavy:** the `leads` table is read **3×** in one batch (`getLead`, `leadMetaRes`, and `currentPartnerRes`'s IIFE); the **entire active `price_book`** is pulled for the BOM picker; and `createDraftDetailedProposal` — **a write — runs during page render** for draft-less Path-B leads.
- **Suggested changes:** (1) collapse the 3 `leads` reads to 1; (2) `[G5]` lazy-load `price_book` behind the picker; (3) ✓ **done** — draft-creation write moved out of render into the explicit `StartDetailedProposalButton`.

### `/sales/[id]/files`, `/tasks`, `/payments`, `/activities`
- `files`: a **2nd `getUser`** (`getUserProfile` at `files/page.tsx:32`) on top of the layout's; 5 serial awaits; per-document `createSignedUrl` fan-out. → `[G1]`, parallelize, batch signed-URL calls.
- `tasks`: **inline `supabase.auth.getUser()` + `employees` lookup in the page** (`tasks/page.tsx:17`, also NEVER-DO #15) — a 2nd/3rd getUser run serially before the `Promise.all`. → `[G1]`, move to a query file.
- `payments`: 4-deep waterfall + **`.reduce()` summing money in JS** (`payments/page.tsx:68`, NEVER-DO #12). → parallelize after `getLead`; move the sum to an RPC.
- `activities`: unbounded `getLeadActivities` (`leads-queries.ts:209`, no limit). → add `.limit()`/pagination.

### `/sales/tasks`
- **What's heavy:** `getSalesTeamTasks` (`sales-team-tasks-queries.ts:47`) — unbounded full scan of `tasks` with `.or()`, then a 3-wave sequential enrichment. → bound it, parallelize the two enrichment queries, `[G2]` for the `.or()`.

### Clean here: `/proposals` (RPC-backed), `/proposals/new`, `/sales/patterns`, `/sales/territories` (only the `[G1]` getUser dup).

---

## PROJECTS

### `/projects/[id]` — Details tab (the original complaint)
- **Load today:** ~11 round-trips, **2 `getUser`** (middleware + `getCallerRole`). `projects` row read **3×** (layout header, `getProject`, `getProjectFinancials`).
- **What's heavy:**
  - `getProject` (`projects-queries.ts:150`) = `SELECT *` over **95 columns** + **3 embeds** (`project_milestones(*, project_completion_components(*))`, `project_delay_log`, `project_change_orders`) that the Details tab **never renders** (empty in dev today; real cost in prod).
  - `getCurrentUserRoleForProject` → `getCallerRole` (`project-detail-actions.ts:78`) = `getUser` + `profiles` + `employees`, **3 serial round-trips**, the long pole of the `Promise.all`.
  - `getProjectFinancials` (`:481`) re-reads the `projects` row (`contracted_value` already in `getProject`'s `*`) + sums money in JS (NEVER-DO #12).
- **Suggested changes:**
  1. `[G1]` — collapses the 2nd `getUser` + the profiles/employees lookups.
  2. Trim `getProject` to the ~40 scalar columns the boxes use; **drop the 3 embeds** (the milestones/delays/change-orders tabs fetch their own).
  3. Drop the redundant `projects` read in `getProjectFinancials`; move its BOQ/expense sums into a SQL RPC.
  4. `cache()` a `getProjectCore(id)` so the layout header + page share one read.

### `/projects` (list)
- **Load today:** measured warm **10 ms** / cold-plan **57 ms**. `getProjects` (`projects-queries.ts:51`) is well-built — explicit cols, `count: 'estimated'`, `.range()`, search via `search_projects_lite` RPC, lean embeds.
- **Suggested changes:** nothing query-specific. Benefits from `[G1]`, `[G3]`, `[G2]` (the search RPC's trgm).

### `/projects/[id]/{change-orders, delays, milestones, qc, reports}` (sub-routes) — **highest-value projects fix**
- **Load today:** each = layout's `getProjectHeader` + **`getProject(id)`** + a narrow child query, parallel.
- **What's heavy:** all five sub-routes call **`getProject(id)`** (`projects-queries.ts:150` — `SELECT *` 95 cols + the 3 deep nested embeds: `project_milestones(*, project_completion_components(*))`, `project_delay_log(*,…)`, `project_change_orders(*,…)`) **just to validate existence or read one field** (e.g. change-orders only needs `contracted_value`). Then each *also* runs a narrow query (`getProjectChangeOrders`/`getProjectDelays`/`getProjectMilestones`/`getProjectQCInspections`/`getProjectReports`) that **re-fetches the very child rows `getProject` already embedded** — a double-fetch of the mega-query.
- **Suggested changes:** replace `getProject(id)` with `getProjectHeader(id)` (the layout already loaded it — `cache()` it and these become free) for the existence/field check, and keep only the sub-route's specific narrow query. **Single highest-value projects change** — removes the heaviest query in the module from 5 routes.

### `/projects/[id]` — Step tabs (survey/bom/boq/delivery/execution/actuals/qc/liaison/commissioning/amc/materials/completion/certificates/performance/documents)
- **Structure (good):** `page.tsx` tab-gates (`if (activeTab !== 'details') return <TabContent>`), so only the active tab's component fetches — already lazy. Layout's `getProjectHeader` (`projects-queries.ts:125`, ~14 cols) is the lean model the sub-routes above should follow.
- **What's heavy (per tab):**
  - **#boq** (high) — 9–11 round-trips: **3 redundant `projects`-row reads** in one render (`getStepBomData` proposal_id / `getBoiState` / `getProjectHeader`), **JS money aggregation** of BOQ totals + category subtotals (`step-boq.tsx:144`, NEVER-DO #12), `getApprovedSiteExpenses` JS `.reduce()` sum (`project-stepper-queries.ts:248`), `getStepBoqData` `SELECT *`, plus `getUserProfile` auth hop for a PDF-button name.
  - **#bom** (high) — `getItemSuggestions` pulls **≤2,000 `project_boq_items` rows + 500 price-book rows** and dedupes in JS on every render; **N×`getBoiItems`** fan-out (one query per BOI version); `getCallerRole` 3-RTT auth hop.
  - **#documents** (high) — ~7-way parallel fan-out, several multi-hop (`getStepDeliveryData` double-`SELECT *`+embed, `getStepSurveyData` ~90-col row, `getHandoverPack` DB+blob+parse, 3-RTT `getCallerRole`), a duplicated `lead_id` read, and an unbounded **N-signed-URL + storage `.list(500)` tail**.
  - **#execution** — `getStepExecutionData` has a `count: 'exact'` head query on `daily_site_reports` (`project-stepper-queries.ts:323`) + two embed-heavy `tasks` selects (correct `project_tasks_*_fkey` hints).
  - **#completion** — `getMilestoneProgressData` runs the completion RPC **and** re-derives the same ratios in JS; its 4th query `tasks … WHERE milestone_id IN (…)` hits an **unindexed `tasks.milestone_id`** (confirmed — seq scan; cheap at 233 rows today, add the index before prod scale).
  - **#actuals / #delivery** — both re-read `project_boq_items` with `SELECT *` (same rows as #boq) + JS money `.reduce()` (actuals).
  - **#amc** — sequential waterfall: `getStepAmcData` then a redundant `projects.select('commissioned_date')` (already in the layout header).
  - **#materials / #certificates / #performance** — each gated behind `getCallerRole` (3-RTT, incl. an **unused `employees` read**); certificates runs it as a *waterfall before* the data query (`page.tsx:301`, no `Promise.all`). **#performance** correctly hits the daily **rollup** (NEVER-DO #16 respected); its Decimal sums are energy, not money.
  - **#survey / #commissioning / #liaison** — wide single-row reads (survey ~90 cols, commissioning ~35 cols), otherwise fine; liaison's PM path adds a role-gate waterfall.
- **Suggested changes:** `[G1]` (and drop `getCallerRole`'s unused `employees` read); fetch the `projects` row once per render (share via `cache()`); move BOQ/expense money sums into SQL RPCs; bound `getItemSuggestions` / `getStepDeliveryData`; add `idx_tasks_milestone_id`; `Promise.all` the certificates/amc waterfalls.

### `/data-review/projects`
- **Clean:** both fetches are RPCs (`get_project_review_counts`, `search_projects_for_review` with `p_limit/p_offset` + inline `total_count`). No issues; cost is inside the RPCs.

---

## PROCUREMENT (heaviest module by query shape)

### `/procurement/project/[projectId]`
- **Load today:** 3-stage waterfall, ~10+ round-trips. **What's heavy:** `getRfqComparisonData` (`rfq-queries.ts:255`) has an **N+1 loop** (one `rfq_invitations` query per RFQ) then 4 more serial queries; `getPurchaseDetail`'s PO sub-query is `SELECT *`; full data for all 5 tabs fetched regardless of `?tab=`.
- **Suggested changes:** replace the N+1 with a single `rfq_invitations` query keyed by `rfq_id IN (…)`; parallelize the 3 outer stages; `[G1]`; tab-gate the per-tab fetches.

### `/bom-review`
- **Load today:** 6 **fully sequential** queries. **What's heavy:** 3× `count: 'exact'` over **`proposal_bom_lines` (24,656 rows; 56 ms each measured)** + an unbounded `item_category` full-table scan to build category chips + a 4th exact count on `data_flags`.
- **Suggested changes:** one `GROUP BY` RPC returning `{total, with_rate, no_rate, category_counts}` in a single pass; `Promise.all` the remaining reads. **Best per-query win in the ERP.**

### `/procurement` (list)
- **What's heavy:** `getPurchaseRequests` (`procurement-queries.ts:124`) — after the 50 paged projects, fires **2 unbounded `.in(projectIds)` queries** (`project_boq_items`, `purchase_orders`) and sums in JS per project; 3 internal queries are sequential.
- **Suggested changes:** push the per-project BOQ/PO totals into a SQL RPC (`GROUP BY project_id`); parallelize.

### `/procurement/orders` — ✓ **Done (mig 192)**
- **What's heavy:** `getPurchaseOrders` (`:301`) = `SELECT *` + embeds + **`.limit(100)` with no pagination** → **silently shows only 100 of 2,041 POs** (correctness bug, not just perf).
- **Suggested changes:** add `count: 'estimated'` + `.range()` pagination; select the ~7 displayed columns. **Shipped:** trimmed select + `{rows,total}` pagination + a pager; dashboard counts moved to the `get_purchase_order_status_counts` RPC (see Execution status).

### `/procurement/requisitions`, `/procurement/reconciliation/[projectId]`
- Both: `getUserProfile` serial gate before the data fetch (`[G1]`+`[G4]`). Reconciliation also has JS `.reduce()` sums the RPC could return.

### `/deliveries`, `/price-book`
- `/price-book`: 3 **unbounded `price_book` scans** for filter facets (categories/brands/vendors) + `SELECT *` list + 3-col ILIKE search. → one `GROUP BY` facet RPC; `[G2]`; `[G5]`.

---

## FINANCE (mostly clean — money correctly in RPCs)

### `/cash`
- **Load today:** 7 round-trips. **What's heavy:** reducible double `getExpectedPayments(7)` + `(30)` (7-day ⊂ 30-day); `OrphanBanner` fetch not in the page `Promise.all` (serial tail); two full-company aggregate RPCs on one page; unbounded `getOverdueInvoices` / `getAllProjectPositions` (project-bounded ~478).
- **Suggested changes:** call `getExpectedPayments(30)` once and derive the 7-day slice; fold `OrphanBanner` data into the page batch (or accept the streamed cost).

### `/expenses`
- **What's heavy:** 2 **inline `supabase.from()` reads** *after* the `Promise.all` (`expenses/page.tsx:55-69`) — serial **and** NEVER-DO #15; `getExpenseKPIs` (`expenses-queries.ts:219`) does a hidden `getUser` + profiles + employees sub-sequence.
- **Suggested changes:** move the 2 inline reads into the `Promise.all` (and into a query file); `[G1]` for `getExpenseKPIs`.

### `/msme-compliance`
- **What's heavy:** `getMSMEAlertPOs` (`procurement-queries.ts:373`) = `SELECT *` + 2 embeds + unbounded, then **filters `is_msme` in JS**. → push `is_msme` into the SQL filter; select needed cols; bound it.

### Clean: `/payments`, `/payments/tracker` (except unbounded `getPaymentScheduleFollowUps` 2-level embed + JS status filter → push filter to SQL), `/payments/receipts`, `/payments/reconciliation`, `/invoices`. All RPC-backed, `count: 'estimated'`.

---

## HR

### `/hr/[id]` and `/hr/employees/[id]`
- **What's heavy:** profile resolved **3×** per render — `requireRole` + `CompensationView` (`compensation-view.tsx:26`) + `getEmployeeCompensation` (`hr-queries.ts:135`) each call `getUserProfile()` → **3 serial `getUser` network hops (~300–900 ms)**.
- **Suggested changes:** `[G1]` is the whole fix — resolve once, pass `{role, profile}` into `CompensationView` and `getEmployeeCompensation`. *(Also: `getEmployeeCompensation`'s `profile.id === employeeId` self-check compares `profiles.id` to `employees.id` — the known footgun; the branch is dead. Correctness, not perf.)*

### `/hr` (dashboard) & `/hr/employees`
- `getEmployees` (`hr-queries.ts:20`) is unbounded (all employees, active+inactive) with an `employee_certifications` embed that `/hr/employees` **fetches and discards**. → slim, boundable list; drop the cert embed on `/hr/employees`; parallelize the role gate (`[G4]`).

### `/hr/certifications`
- Unbounded full-table cert scan + embed + sort, **inline query** in the page, no role gate. → move to a query file, paginate, verify RLS.

### `/hr/benchmarking`
- `force-dynamic` (uncached) + opaque `get_salary_benchmark_report` RPC. → consider `unstable_cache`; EXPLAIN the RPC.

---

## O&M / LIAISON

### `/om/amc`
- **What's heavy:** `getAllAmcData` (`amc-actions.ts:445`) — 2 sequential queries: `om_contracts` (≤200) then **unbounded `om_visit_schedules .in(contract_ids)`** + a **JS rollup** of visits per contract; plus 3 overlapping project lists (~700 rows) + employees fetched for a **closed** dialog.
- **Suggested changes:** one `get_amc_with_stats` RPC (contracts + visit rollup via `GROUP BY`/lateral); `[G5]` lazy-load the dialog's project/employee lists.

### `/om/inverters`
- `getCurrentUserRole` (`inverters-queries.ts:10`) serial gate (`[G1]`/`[G4]`); `getAllProjectsForInverters` pulls **1,000 projects for a closed dialog** (`[G5]`); `listInverters` (`:46`) unbounded (fine at ~50 today).

### `/om/profitability`
- Serial role gate + `force-dynamic` + opaque `get_om_profitability` RPC over a 90-day window + JS `.reduce()` of money totals the RPC could return. → `[G1]`/`[G4]`; EXPLAIN the RPC; return totals from SQL.

### `/qc-gates`, `/daily-reports`
- Both: single bounded query (`.limit(100)`) but `SELECT *` on wide rows + **inline query** (NEVER-DO #15). → select the ~6–7 displayed columns; move to a query file. Otherwise cheap.

### Redirects (no cost): `/om`, `/liaison/net-metering`.

---

## CONTACTS / COMPANIES / REFERRALS

### `/contacts` (list)
- **What's heavy:** `search_contacts` RPC (mig 167) — **leading-wildcard ILIKE seq scan** (measured 32 ms over 1,390 rows) + `COUNT(*) OVER()` exact total per page + a per-row correlated `jsonb_agg` over `contact_company_roles` (50 subqueries/page); plus `getMyViews` dup `getUser`.
- **Suggested changes:** `[G2]` (trgm on name/phone/email — the big one); switch the window-count to estimated or accept it post-trgm; `[G1]`.

### `/companies` (list)
- Same seq-scan + exact-count + `getUser` dup pattern, **no embed** so lighter; `companies`=56 rows so low impact today. → `[G2]`, `[G1]`.

### `/contacts/[id]`, `/companies/[id]`
- `getEntityActivities` (`contacts-queries.ts:218`) = 2 sequential queries + **unbounded `.in(activityIds)`** with `SELECT *`; detail embeds are unbounded relationship pulls (`getCompany` returns all linked contacts). → bound the activities `.in()`/add limit; select needed cols.

### `/referrals`, `/referrals/partners/[id]`
- Well-bounded (`.limit()`, `count: 'estimated'`). Only minor avoidable internal sequential waterfalls (`getReferralKpis` 3 serial → `Promise.all`).

---

## DASHBOARDS & CROSS-CUTTING

### `/dashboard` (PM variant) — worst dashboard
- **What's heavy:** `getPMDashboardData` (`pm-queries.ts:78`) — **`Decimal.reduce()` over money** (NEVER-DO #12), a duplicate `projects` scan (`getOverdueProjectsForPM` re-selects the PM's projects), the **uncached** `get_projects_without_today_report` (Founder uses the cached wrapper), + profile `getUser` dup. *(Its 6× `count:'exact'` hit `tasks`=233 + tiny O&M tables — low impact, leave them.)*
- **Suggested changes:** move the money sum to the RPC; reuse one project scan; switch to the cached report wrapper; `[G1]`.

### `/data-quality`
- **What's heavy:** **7× `count: 'exact'`** — incl. 3 on `leads`/`projects`/`proposals` (verified-record counts) every load. → one RPC returning all counts via `COUNT(*) FILTER(WHERE …)`; `get_data_flag_summary` already returns most of it.

### `/reconciliation`
- **What's heavy:** 3 **unbounded full-table selects** (`projects` + `project_reconciliation` 465 + `recon_sheet_projects` 264) joined + all summary stats computed in JS; full row set also shipped to the client. → a summary RPC for the KPIs; paginate the row set.

### `/dashboard` (Founder)
- Heavy by fan-out (~15 RT) but **well-engineered**: cached aggregation RPCs + parallel, no exact-count, no JS money. Only real costs: the profile `getUser` dup (`[G1]`) + unbounded `getZohoSyncHealth` JS filter (`dashboard-queries.ts:110` → 2-bucket `GROUP BY` RPC).

### `/tasks`, `/activities`
- Both pull **478 projects** for a closed dialog/combobox (`getActiveProjects` `tasks-actions.ts:309`; `getProjectOptionsForActivities` limit 500). → `[G5]`. List queries themselves are clean (`count: 'estimated'`, `.range()`, correct `project_tasks_*_fkey` hints).

### Clean: `/command-center`, `/tasks/[id]`, `/settings` (minor `listAllUsers` getUser dup), `/ask` (one exact count on the growing `rag_query_log` → estimated).

---

## Part 3 — Prioritised worklist

### P0 — global, fixes many pages at once
- [ ] **[G1]** `cache()` the session/profile resolver; thread it into all role helpers. *(touches ~25 pages)*
- [ ] **[G2]** `pg_trgm` extension + GIN indexes on searched columns. *(one migration; every search box)*
- [ ] **[G3]** Dev compute upsize. *(infra; the cold-plan 57–68 ms)*

### P1 — high-value, scoped per page
- [ ] `/sales` list: fold `getLeads` into the parallel batch; drop redundant `getLeadsClosingBetween`.
- [ ] `/sales/[id]` layout: fetch `getLead` once; `Promise.all` the 4 boolean checks.
- [ ] `/projects/[id]` detail: trim `getProject` (drop 3 embeds, `SELECT` ~40 cols); collapse the 3 `projects` reads; financials → RPC.
- [ ] `/projects/[id]/{change-orders,delays,milestones,qc,reports}`: replace the `getProject(id)` mega-fetch existence-guard with `getProjectHeader`; drop the duplicate child query. **Removes the module's heaviest query from 5 routes.**
- [ ] `/projects/[id]#boq` + `#bom` + `#actuals` + `#delivery`: fetch the `projects` row once (`cache()`); move BOQ/expense money sums to a SQL RPC; bound `getItemSuggestions` (≤2,000 BOQ rows) and `getStepDeliveryData` (`SELECT *`).
- [ ] `/bom-review`: 3 exact counts + category scan → one `GROUP BY` RPC.
- [x] `/procurement/orders`: paginate (fix silent 100-of-2,041 truncation). **Done — mig 192** (also moved the dashboard's PO status KPIs to a `COUNT(*) FILTER` RPC).
- [ ] **[G5]** lazy-load dialog/dropdown data: `/om/inverters`, `/om/amc`, `/sales/[id]/proposal`, `/price-book`, `/tasks`, `/activities`.
- [ ] `/data-quality`: 7 exact counts → one RPC.

### P2 — cleanups
- [ ] `/procurement/project/[projectId]`: fix `getRfqComparisonData` N+1.
- [ ] Remaining JS money aggregation → RPC: PM dashboard, `/procurement` list, `/sales/[id]/payments`, `/msme-compliance`, `/om/profitability`.
- [ ] `SELECT *` trims: `qc-gates`, `daily-reports`, `getPurchaseOrders`, `getMSMEAlertPOs`.
- [ ] NEVER-DO #15 inline-query moves: `/sales/[id]/tasks`, `/expenses`, `/hr/certifications`, `/qc-gates`, `/daily-reports`, `/tasks/[id]`.
- [ ] `/reconciliation`: summary RPC + paginate.
- [ ] Delete **only** the genuinely-dead `leads/page.tsx` + `leads/loading.tsx` (the list, unreachable post-redirect). **Do NOT delete `leads/[id]/**` or `leads/new/**`** — `/sales/[id]`, its 5 tabs, and `/sales/new` re-export them (verified 2026-06-19; a wholesale delete breaks sales-detail). Inverting the re-export is a separate refactor.
- [ ] `CREATE INDEX idx_tasks_milestone_id ON tasks(milestone_id)` — completion tab currently seq-scans (cheap at 233 rows; add before prod scale).
- [ ] Drop `getCallerRole`'s unused `employees` read (folded into `[G1]`).

---

## Appendix — measured evidence (dev)

| Fact | Value |
|---|---|
| `pg_trgm` installed? | **No** (only pg_cron, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp, vector) |
| `projects` | 478 rows, **95 columns, 14 indexes**; list query exec 10 ms / **plan 57 ms cold** |
| `projects` detail `getProject` | exec 4 ms / **plan 68 ms cold / 1.5 ms warm** |
| `leads` | 1,271 rows, **19 indexes**; list query exec 33 ms / **plan 63 ms cold** |
| `proposal_bom_lines` | **24,656 rows**; `count(*)` = **56 ms** (×3 on `/bom-review`) |
| `purchase_orders` | **2,041 rows** (`/procurement/orders` shows only 100) |
| `contacts` | 1,390 rows; ILIKE search = **32 ms seq scan** |
| `proposals` | 1,363 · `customer_payments` 1,148 · `project_boq_items` 797 · `project_reconciliation` 465 · `recon_sheet_projects` 264 · `tasks` 233 · `companies` 56 · `inverters` 50 |
| RPCs `get_lead_stage_counts`, `get_pipeline_close_window` | clean `STABLE` SQL aggregates (good) |
| mig 188/189 index drops | **verified safe** — all flagged FK/filter columns still indexed |
| `tasks` indexes | assigned_to, due_date, project_id, category, (entity_type,entity_id) — **no `milestone_id` index** (completion tab seq-scans; cheap at 233 rows) |
| `getProject(id)` reuse | called by 5 sub-routes (change-orders/delays/milestones/qc/reports) as an existence-guard — the module's heaviest query, each then re-fetches the embedded children |

*Generated 2026-06-19. Diagnosis-only; no code changed. Per the no-prod rule, all remediation is dev-first.*
