# Performance & DB Review — 2026-05-30

> Read-only review covering N+1 queries, missing indexes, `count: 'exact'` on
> large tables, JS-side money aggregation, sequential RPCs that should be
> parallel, time-series tables missing partitioning, over-fetching, missing
> pagination, expensive triggers, and uncached long-running operations.
>
> Reviewer: Claude (Opus 4.7) — performance lens, single agent.
> Scope: full `apps/erp/src` + `supabase/migrations/` (focus on 117–139).
> Scale assumption: 50 users, 1100+ leads, 360+ projects, several K POs / invoices / payments.
> Phase 8 inverter polling at 5-min cadence is the largest near-future volume driver.

## Executive summary

**The biggest performance debt is JavaScript-side money aggregation on the
Payments Overview page.** `getProjectPaymentOverview()` (apps/erp/src/lib/payments-overview-queries.ts:39)
fetches every contracted project, then issues four follow-up `.in('project_id', ids)`
queries pulling all customer_payments + purchase_orders + expenses + proposal
schedules, and then runs four `for…of` accumulators in JS to roll up money.
At 360 projects × dozens of payments/POs/expenses each, this returns 10K+ rows
on every page load and violates NEVER-DO #12. Should be a single
`get_project_payment_overview` SQL RPC.

**The second-biggest issue is three N+1 loops in AI cron jobs.** `scanStaleItems`
(apps/erp/src/lib/ai/task-suggestion-scanner.ts:56,111,167) does one `tasks` lookup per
candidate ticket/project/lead — a daily cron that scales linearly with backlog.
`detectAnomalies` (apps/erp/src/lib/ai/anomaly-detector.ts:373) does one
`getProjectDailyKwh` query per connected project, then `lookbackDays` (default 7)
PVLib HTTP calls per project — 50 connected projects × (1 query + 7 PVLib calls)
= 50 queries + 350 HTTP calls per anomaly run. `generateCustomerCheckinsForWeek`
(apps/erp/src/lib/customer-outreach-actions.ts:89) checks `customer_outreach_queue`
once per commissioned project (500+ queries each Monday). And `task-suggestions/run/route.ts:146`
re-queries the founder employee row inside the per-row loop instead of hoisting once.

**The third concern is partitioning.** Only `inverter_readings` (mig 050) is
partitioned. `record_audit_log` (mig 006c — "immutable forever, never deleted",
fires on every Tier 1 UPDATE), `lead_activities`, `customer_message_log`,
`procurement_audit_log`, `message_delivery_log`, and `rag_query_log` are all
ever-growing logs without `PARTITION BY RANGE`. NEVER-DO #16 explicitly calls
for declarative partitioning from day 1 on time-series.

**Smaller issues:** five `count: 'exact'` introductions outside the baseline
(`sales-queries`, `designer-queries`, `hr-dashboard-queries`, `ai/task-suggestion-cap`,
`ai/knowledge-qa-rate-limit`, `bom-review/page.tsx`, `data-quality/page.tsx`,
`tasks-queries`); `bom-review/page.tsx` fetches every BOM row just to count
categories in JS; `inverter_poll_failures` has no `inverter_id` index;
`tasks(category)` filter has no supporting index; `getSalesTeamTasks` has no
`LIMIT`. The HR dashboard pulls every certification then JS-filters for
"expiring in 30 days" instead of doing the date math in SQL.

## Findings

| # | Severity | Area | Where | What |
|---|----------|------|-------|------|
| 1 | CRITICAL | Money | `apps/erp/src/lib/payments-overview-queries.ts:39-176` | JS aggregation of 360+ projects' payments/POs/expenses; 5 queries → 4 JS reduce loops; NEVER-DO #12 |
| 2 | CRITICAL | N+1 | `apps/erp/src/lib/ai/task-suggestion-scanner.ts:56,111,167` | 3 nested `tasks` lookups per scanned entity in the daily cron |
| 3 | HIGH | N+1 | `apps/erp/src/lib/ai/anomaly-detector.ts:373-396` | Per-project loop with `lookbackDays × project` PVLib HTTP calls + 1 DB query each |
| 4 | HIGH | N+1 | `apps/erp/src/lib/customer-outreach-actions.ts:89-126` | Per-project `customer_outreach_queue` lookup; runs every Monday cron |
| 5 | HIGH | N+1 | `apps/erp/src/app/api/task-suggestions/run/route.ts:146-152` | Founder lookup inside per-row loop; cap-check also per-row |
| 6 | HIGH | N+1 | `apps/erp/src/lib/rfq-queries.ts:273-284` | Per-RFQ `rfq_invitations` lookup in `getRfqComparisonData` |
| 7 | HIGH | Money | `apps/erp/src/lib/project-detail-actions.ts:301-348` | `getProjectFinancials` does 3 fetches then 2 JS reduce on BOQ + expenses; every project detail load |
| 8 | HIGH | Partition | `supabase/migrations/006c_audit_triggers.sql:42-72` | `record_audit_log` ("immutable, never deleted") not partitioned — fires on every Tier 1 UPDATE |
| 9 | HIGH | Partition | `supabase/migrations/138_wave1_rag_and_supporting_tables.sql:123-139` | `rag_query_log` will grow per /ask query × all users — not partitioned |
| 10 | HIGH | count: 'exact' | `apps/erp/src/lib/ai/task-suggestion-cap.ts:18-24` | `count: 'exact'` on `tasks` filtered by `LIKE '[AI] %'`; called in per-row loop in run route |
| 11 | HIGH | count: 'exact' | `apps/erp/src/lib/ai/knowledge-qa-rate-limit.ts:60-64` + `apps/erp/src/app/(erp)/ask/page.tsx:30` | `count: 'exact'` on `rag_query_log` — runs per /ask invocation, table grows unbounded |
| 12 | HIGH | Over-fetch | `apps/erp/src/app/(erp)/bom-review/page.tsx:23-66` | 4 `count: 'exact'` on `proposal_bom_lines` + full table scan just to count categories in JS |
| 13 | MEDIUM | count: 'exact' | `apps/erp/src/lib/sales-queries.ts:57,77,85` | 3 `count: 'exact'` on `leads` (1100+ rows) — new to baseline |
| 14 | MEDIUM | count: 'exact' | `apps/erp/src/lib/designer-queries.ts:79,86` | 2 `count: 'exact'` on `proposals` — new to baseline |
| 15 | MEDIUM | count: 'exact' | `apps/erp/src/lib/hr-dashboard-queries.ts:57,63` | 2 `count: 'exact'` on `employees` + `leave_requests` |
| 16 | MEDIUM | count: 'exact' | `apps/erp/src/app/(erp)/data-quality/page.tsx:51-64` | 6 `count: 'exact'` on `data_flags` + `leads` + `projects` + `proposals` |
| 17 | MEDIUM | Over-fetch | `apps/erp/src/lib/hr-dashboard-queries.ts:74-78` | Pulls every certification with `expiry_date NOT NULL`, JS-filters to next-30-days |
| 18 | MEDIUM | Missing index | `supabase/migrations/050_inverter_telemetry.sql:320-330` | `inverter_poll_failures` lacks an `inverter_id` index |
| 19 | MEDIUM | Missing index | tasks table | `tasks(category)` has no index; `task-suggestion-scanner` filters by it after `entity_type`+`entity_id` |
| 20 | MEDIUM | Missing LIMIT | `apps/erp/src/lib/sales-team-tasks-queries.ts:47-66` | `getSalesTeamTasks` has no `.limit()` — pulls every sales-domain task |
| 21 | MEDIUM | Missing LIMIT | `apps/erp/src/lib/tasks-queries.ts:75-80` | `getProjectsWithTasks` pulls 2000 rows just to dedupe project IDs in JS |
| 22 | MEDIUM | Partition | `supabase/migrations/002a_leads_core.sql:217-246` | `lead_activities` not partitioned (modest scale today, but daily growth) |
| 23 | MEDIUM | Partition | `supabase/migrations/129_customer_message_log.sql:5-23` | `customer_message_log` not partitioned (daily WhatsApp drip volume) |
| 24 | MEDIUM | Partition | `supabase/migrations/007c_whatsapp_tracking.sql` | `message_delivery_log` not partitioned (every outbound WhatsApp logged) |
| 25 | MEDIUM | Money | `apps/erp/src/lib/partners-queries.ts:336-337` | JS reduce on `consultant_commission_payouts.net_amount` (small now, scales with partners) |
| 26 | LOW | Over-fetch | `apps/erp/src/lib/dashboard-queries.ts:110-119` | `getZohoSyncHealth` pulls full rows where `status IN (...)` — should be 3 estimated counts |
| 27 | LOW | Embed split | `apps/erp/src/lib/pdf/project-pdf-data.ts:64-72` | `survey` block does 2 sequential awaits — could be a single embed |
| 28 | LOW | Heavy embed | `apps/erp/src/lib/projects-queries.ts:100-126` | `getProject()` `SELECT *` with 4 nested embeds; runs on every project detail page load |
| 29 | LOW | Missing LIMIT | `apps/erp/src/lib/site-report-queries.ts:23-41` | `getProjectReports` returns all reports (could hit 100-200 for long projects) |
| 30 | LOW | Sequential | `apps/erp/src/lib/projects-queries.ts:86-94` (in `projects/[id]/page.tsx:87-93`) | Primary contact fetch is sequential after the main `Promise.all`; could be inside it |

## Detail

### 1. CRITICAL — `getProjectPaymentOverview` JS aggregation
**Caller:** `apps/erp/src/lib/payments-overview-queries.ts:39-176`
**Why:** Loads all projects with `contracted_value > 0` (currently 360+), then
fires four batched `.in('project_id', ids)` queries against `customer_payments`,
`purchase_orders`, `expenses`, and `proposals.proposal_payment_schedule`. Each
returns potentially thousands of rows. Then 4 JS `for…of` loops aggregate
amounts into Maps keyed by project_id. NEVER-DO #12 violation.
**At scale:** 360 projects × ~10 payments/POs/expenses each = 10K+ rows pulled
into a Node process on every page load.
**Fix:** Single SQL RPC `get_project_payment_overview()` returning the per-row
shape directly. Pattern already exists for `get_payment_tracker_rows`
(payments-tracker-queries.ts) which the team got right.

### 2. CRITICAL — Three N+1 loops in `scanStaleItems`
**Caller:** `apps/erp/src/lib/ai/task-suggestion-scanner.ts:56,111,167`
**Why:** Three nearly-identical loops (one per entity type) each issue one
`tasks` query per parent row to check "no open follow-up task exists." Daily
cron — runs unattended.
**At scale:** If the scan turns up ~80 stale tickets + 50 stale projects +
30 stale leads (typical), that's 160 single-row queries per cron run.
**Fix:** Replace the loop with a single LEFT JOIN / anti-join. For tickets:

```sql
SELECT t.id, t.title, ..., NULL AS existing_task
FROM om_service_tickets t
LEFT JOIN tasks tk ON tk.entity_type = 'service_ticket'
                  AND tk.entity_id = t.id
                  AND tk.is_completed = FALSE
                  AND tk.deleted_at IS NULL
WHERE t.status = 'open' AND t.severity IN ('critical','high')
  AND t.created_at < NOW() - INTERVAL '3 days'
  AND t.closed_at IS NULL
  AND tk.id IS NULL;
```
Or expose as RPC `get_stale_entities_needing_followup()`.

### 3. HIGH — N+1 in `detectAnomalies`
**Caller:** `apps/erp/src/lib/ai/anomaly-detector.ts:373-396`
**Why:** For each project in cohort: 1 `getProjectDailyKwh` (which itself does
2 queries — inverter IDs + readings), then `lookbackDays` (default 7) calls to
PVLib microservice (HTTP). 50 connected projects = 50 inverter queries + 50
readings queries + 350 PVLib HTTP calls per cron.
**Fix (DB side):** Single query fetching all inverter daily rollups for the
cohort in one go, group by project_id in SQL. **Fix (PVLib side):** Batch
PVLib API to accept a list of `(lat, lng, system_size_kwp, date_from, date_to)`
inputs, or cache the daily expected per (lat, lng, system_size_kwp) bucket.

### 4. HIGH — N+1 in `generateCustomerCheckinsForWeek`
**Caller:** `apps/erp/src/lib/customer-outreach-actions.ts:89-126`
**Why:** For every commissioned project (likely 200+ now, 500+ at year end),
the Monday cron checks `customer_outreach_queue` for a row in the last 90 days.
**Fix:** Single anti-join. Pre-fetch the set of `(project_id)` with a recent
outreach into a Set, then iterate. Or do the entire "due check-ins" calculation
in SQL — date-window + anti-join + interval matching can all be one query.

### 5. HIGH — Hoist founder lookup in task-suggestions route
**Caller:** `apps/erp/src/app/api/task-suggestions/run/route.ts:146-152`
**Why:** `SELECT id FROM employees WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1`
runs INSIDE the `for (let i = 0; i < insertedRows.length; i++)` loop. Same
result on every iteration.
**Fix:** Hoist before the loop. Also the cap-check at line 83 is per-user;
pre-compute the daily cap usage Map for all distinct assignees once, then
look up locally in the loop.

### 6. HIGH — N+1 in `getRfqComparisonData`
**Caller:** `apps/erp/src/lib/rfq-queries.ts:273-284`
**Why:** Iterates `rfqRows` (up to 10 RFQs), then for each issues a separate
`rfq_invitations` query just to find "the first RFQ with a submitted invitation."
**Fix:** Single query: `LEFT JOIN rfq_invitations ON status='submitted'`, then
in JS pick the first RFQ whose join returned rows.

### 7. HIGH — `getProjectFinancials` JS aggregation
**Caller:** `apps/erp/src/lib/project-detail-actions.ts:301-348`
**Why:** Fetches all BOQ items + all approved expenses for the project, then
JS-reduces `total_price` and `amount`. Runs on every project detail page load.
NEVER-DO #12.
**Fix:** Single RPC `get_project_financials(p_project_id UUID)` returning
the 6-field result row. Three SUM/COUNT queries in SQL.

### 8. HIGH — `record_audit_log` not partitioned
**Schema:** `supabase/migrations/006c_audit_triggers.sql:42-72`
**Why:** Comment says "Immutable — Tier 3. Never deleted." Stores JSONB before
and after snapshots on every Tier 1 UPDATE. At 50 staff × 10-20 UPDATEs/day on
Tier 1 tables = ~250-500 rows/day → 100K+/year. After 3 years VACUUM and
ANALYZE on the parent index will become painful.
**Fix:** `PARTITION BY RANGE (changed_at)` monthly, same pattern as
`inverter_readings` (mig 050). Add pg_cron job to create next month's partition
on the 28th. Existing data: rebuild as partitioned table via SWAP rename.

### 9. HIGH — `rag_query_log` not partitioned
**Schema:** `supabase/migrations/138_wave1_rag_and_supporting_tables.sql:123-139`
**Why:** Every /ask question inserts a row. Used for rate limiting via
`count: 'exact'` (see finding #11) and audit. Will accumulate forever.
**Fix:** `PARTITION BY RANGE (created_at)` monthly. Plus retention: drop
partitions older than 90 days unless needed for billing/audit.

### 10. HIGH — `count: 'exact'` on `tasks` filtered by LIKE in a loop
**Caller:** `apps/erp/src/lib/ai/task-suggestion-cap.ts:18-24` →
called per row in `apps/erp/src/app/api/task-suggestions/run/route.ts:83`
**Why:** `.like('title', '[AI] %')` cannot use any existing index. Triggers a
full-heap scan filtered to last 24h. With `tasks` growing into thousands,
this becomes slow. Also `count: 'exact'` is the wrong tool for "fewer than 5"
checks.
**Fix:**
- Add a generated column `is_ai_suggested BOOLEAN GENERATED ALWAYS AS (title LIKE '[AI] %') STORED`
  with a partial index on `(assigned_to, created_at) WHERE is_ai_suggested`.
- Or store the AI sentinel as a dedicated `category = 'ai_suggested'` value and
  index `(assigned_to, category, created_at)`.
- Use `count: 'estimated'` (or even just `.limit(PER_USER_DAILY_CAP+1)` and
  read `.length`) since the question is "is count >= 5", not the exact value.

### 11. HIGH — `count: 'exact'` on `rag_query_log` for every /ask
**Caller:** `apps/erp/src/lib/ai/knowledge-qa-rate-limit.ts:60-64` +
`apps/erp/src/app/(erp)/ask/page.tsx:30`
**Why:** Runs per call. Table grows linearly with /ask usage. `idx_rag_query_log_caller`
exists on `(caller_id, created_at DESC)` so the row scan is index-driven, but
`count: 'exact'` always reads every matching row.
**Fix:** Use `count: 'estimated'` for the "have you used < 30" check (a couple
of rows off won't matter). Or maintain a per-user-per-day counter table /
Redis-style counter that an INSERT trigger increments.

### 12. HIGH — `bom-review/page.tsx` over-fetches + 4 exact counts
**Caller:** `apps/erp/src/app/(erp)/bom-review/page.tsx:23-66`
**Why:**
- Lines 23-35: 3 `count: 'exact'` on `proposal_bom_lines` (likely thousands of rows).
- Line 38-42: another `count: 'exact'` on `data_flags`.
- Lines 45-53: pulls ALL `proposal_bom_lines.item_category` rows just to count by category in JS.
**Fix:** Single RPC `get_bom_review_summary()` returning total, with_rate,
no_rate, flagged_count, and category counts (a single GROUP BY) in one trip.

### 13. MEDIUM — Sales dashboard `count: 'exact'` on leads
**Caller:** `apps/erp/src/lib/sales-queries.ts:57,77,85`
**Why:** Three `count: 'exact'` queries on `leads` (1100+ rows) — new
introductions not in the baseline. The forbidden-patterns baseline R13 list
was meant to cap at the existing pm-queries + finance entries.
**Fix:** Switch to `count: 'estimated'`. Or merge all three counts into the
existing `get_lead_stage_counts` RPC by adding `month_start` and `qualified`
filters.

### 14. MEDIUM — Designer dashboard `count: 'exact'` on proposals
**Caller:** `apps/erp/src/lib/designer-queries.ts:79,86`
**Why:** Two `count: 'exact'` on `proposals` (currently a few hundred rows but
trending to thousands).
**Fix:** `count: 'estimated'`. Or push to a new RPC
`get_designer_kpi_counts(p_employee_id, p_since)`.

### 15. MEDIUM — HR dashboard `count: 'exact'`
**Caller:** `apps/erp/src/lib/hr-dashboard-queries.ts:57,63`
**Why:** `count: 'exact'` on `employees` (50 rows — fine) and `leave_requests`
(growing). The leave_requests one will become slow over years.
**Fix:** `count: 'estimated'` on `leave_requests`. `employees` is small enough
that exact is OK forever.

### 16. MEDIUM — Data quality page: 6 `count: 'exact'`
**Caller:** `apps/erp/src/app/(erp)/data-quality/page.tsx:51-64`
**Why:** 3 on `data_flags`, 3 on `leads`/`projects`/`proposals` with
`.not('data_verified_at', 'is', null)`. The `data_verified_at` column likely
has no index.
**Fix:** Move all summary KPIs into the existing `get_data_flag_summary` RPC
so it returns total/unresolved/resolvedWeek/verifiedCount in one trip. Or at
minimum switch to `count: 'estimated'`. Index on `leads(data_verified_at) WHERE data_verified_at IS NOT NULL` if the count must be exact.

```sql
CREATE INDEX idx_leads_data_verified ON leads (data_verified_at)
  WHERE data_verified_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_projects_data_verified ON projects (data_verified_at)
  WHERE data_verified_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_proposals_data_verified ON proposals (data_verified_at)
  WHERE data_verified_at IS NOT NULL;
```

### 17. MEDIUM — HR dashboard pulls every certification
**Caller:** `apps/erp/src/lib/hr-dashboard-queries.ts:74-78` (filter at line 114)
**Why:** Loads all `employee_certifications` with `expiry_date NOT NULL`,
then JS-filters via `isCertificationExpiringSoon` to "next 30 days". With
50 employees × 3-5 certs = 150-250 rows — currently small but the date math
belongs in SQL.
**Fix:** Add `.lte('expiry_date', new Date(Date.now() + 30*86400000).toISOString().split('T')[0])`
and `.gte('expiry_date', today)` to the query. Index already exists
(`idx_certifications_expiry` mig 005a).

### 18. MEDIUM — Missing index `inverter_poll_failures(inverter_id)`
**Schema:** `supabase/migrations/050_inverter_telemetry.sql:320-330`
**Why:** The table has only `idx_inverter_poll_failures_recent (attempted_at DESC)`.
At Phase 8 cadence (5-minute polling × hundreds of inverters), poll failures
during transient outages can spike to thousands. Any "show me failures for
inverter X" query will seq-scan.
**Fix:**
```sql
CREATE INDEX idx_inverter_poll_failures_inverter
  ON inverter_poll_failures (inverter_id, attempted_at DESC);
```

### 19. MEDIUM — Missing index `tasks(category)`
**Caller:** `apps/erp/src/lib/ai/task-suggestion-scanner.ts:118,174`
**Why:** Queries do `.eq('entity_type', 'project').eq('category', 'project_followup').eq('entity_id', X)`.
The partial `idx_tasks_entity` on `(entity_type, entity_id) WHERE entity_id IS NOT NULL AND is_completed=FALSE AND deleted_at IS NULL`
covers part of this, but the planner still needs to heap-filter on category.
With multiple categories per entity it's fast for now; will degrade.
**Fix:** Extend the partial entity index to include category:
```sql
CREATE INDEX idx_tasks_entity_category
  ON tasks (entity_type, entity_id, category)
  WHERE entity_id IS NOT NULL AND is_completed = FALSE AND deleted_at IS NULL;
```
Then drop the existing `idx_tasks_entity`.

### 20. MEDIUM — `getSalesTeamTasks` no LIMIT
**Caller:** `apps/erp/src/lib/sales-team-tasks-queries.ts:47-66`
**Why:** OR-filter on entity_type+category combos but no `.limit()` and no
pagination. With `tasks` growing into thousands of historical rows (especially
once `includeCompleted=true`), the response payload bloats.
**Fix:** Default `.limit(500)` and add a `page` parameter for paginated mode.

### 21. MEDIUM — `getProjectsWithTasks` over-fetches for dedup
**Caller:** `apps/erp/src/lib/tasks-queries.ts:75-80`
**Why:** Pulls up to 2000 task rows joined to projects, then dedupes in JS.
Used by the `/tasks` page filter dropdown.
**Fix:** Single RPC or distinct query:
```sql
SELECT DISTINCT p.id, p.project_number, p.customer_name
FROM projects p
WHERE EXISTS (
  SELECT 1 FROM tasks t
  WHERE t.project_id = p.id AND t.deleted_at IS NULL
)
ORDER BY p.customer_name;
```
Or `.select('project_id').not('project_id', 'is', null).is('deleted_at', null)` (no embed) and dedupe IDs first, then a single follow-up `.in('id', ids)` against projects.

### 22-24. MEDIUM — Multiple time-series tables not partitioned
**Schemas:**
- `supabase/migrations/002a_leads_core.sql:217-246` — `lead_activities`
- `supabase/migrations/129_customer_message_log.sql:5-23` — `customer_message_log`
- `supabase/migrations/007c_whatsapp_tracking.sql:38-100` — `message_delivery_log`

**Why:** NEVER-DO #16: "Never store time-series data in a regular table —
declarative partitioning from day 1." Each of these tables grows monotonically
with operational volume:
- `lead_activities`: 1100 leads × ~8 lifetime activities + ongoing 5-10/day
- `customer_message_log`: every WhatsApp drip step (F1 sequences)
- `message_delivery_log`: every outbound WhatsApp template send

Today they're modest (single thousands). In 2-3 years they'll hit
100K-1M rows. VACUUM/ANALYZE pain at that point requires offline maintenance.
**Fix (do now):** `PARTITION BY RANGE` on the natural date column
(`activity_date`, `created_at`, `n8n_sent_at`), monthly partitions, pg_cron
creates next month on the 28th, drop raw partitions older than 12 months
unless retention rules say otherwise. Mig 050 has the template — copy it.

### 25. MEDIUM — `partners-queries` JS reduce on commission payouts
**Caller:** `apps/erp/src/lib/partners-queries.ts:336-337`
**Why:** Pulls `net_amount` from `consultant_commission_payouts` filtered by
partner and status, then JS-reduces. Today's payouts are few but with active
channel partner program this grows.
**Fix:** Two RPC calls (or one returning both):
```sql
CREATE OR REPLACE FUNCTION get_partner_commission_summary(p_partner_id UUID)
RETURNS TABLE (pending_sum NUMERIC, paid_ytd_sum NUMERIC) ...
```

### 26. LOW — `getZohoSyncHealth` fetches full rows
**Caller:** `apps/erp/src/lib/dashboard-queries.ts:110-119`
**Why:** `.select('status').in('status', ['pending', 'syncing', 'failed'])`
returns one row per matching record. Currently small but if sync ever stalls
this could be thousands.
**Fix:** Three parallel `count: 'estimated', head: true` queries (one per
status), or a single RPC.

### 27. LOW — Sequential awaits in `project-pdf-data.ts` survey block
**Caller:** `apps/erp/src/lib/pdf/project-pdf-data.ts:64-72`
**Why:** Block first awaits `projects.lead_id`, then awaits `lead_site_surveys`.
**Fix:** Single embed `survey:lead_site_surveys!projects_lead_id_fkey(*)` or
chain via PostgREST nested select.

### 28. LOW — `getProject()` heavy embed
**Caller:** `apps/erp/src/lib/projects-queries.ts:100-126`
**Why:** `SELECT *` on `projects` + 4 nested embeds (employees ×2, milestones
with components, delay_log with employees+milestones, change_orders with
preparer+approver). Runs on every project detail page load. Returns a wide row
because `SELECT *`.
**Fix:** Narrow the top-level select to columns actually consumed by the
page header and boxes. The full `select '*'` is wasteful given the detail
page also already calls `getProjectFinancials`, `getProjectMilestones`, etc.
separately when needed.

### 29. LOW — `getProjectReports` no LIMIT
**Caller:** `apps/erp/src/lib/site-report-queries.ts:23-41`
**Why:** Returns every daily report for a project. Long-running projects
(3-6 months) can accumulate 90-180 reports.
**Fix:** Default `.limit(50)` with pagination, or `.range(0, 49)` and "Load
more" UI.

### 30. LOW — Primary contact fetch sequential
**Caller:** `apps/erp/src/app/(erp)/projects/[id]/page.tsx:87-93`
**Why:** Issues a `contacts` lookup after the main `Promise.all` finishes,
adding a sequential round-trip. Conditional on `primary_contact_id` being set,
which it isn't for most projects yet — so impact is small now.
**Fix:** Include in the outer `Promise.all`, with `null` returned when no
contact link exists (early return inside the promise).

## Cross-cutting notes

### N+1 patterns to watch — full list
The codebase has 13+ `for…of` loops in `apps/erp/src/lib/ai/` and the migration
loops are mostly fine (CPU-only, not DB-bound). The ones flagged above are the
ones with a `supabase.from(...)` or HTTP call inside. Other loops worth a
defensive read but not flagged today:
- `anomaly-orchestrator.ts:55-62` — proper chunking, uses `Promise.all`. OK.
- `briefing-kpis.ts:207, 244, 259, 269` — local Map building from already-fetched data. OK.
- `vendor-bill-draft-creator.ts:292` — fuzzy match loop on small candidate set. OK.
- `win-loss-analyser.ts:218, 242, 253, 272` — analysis loops, mostly local. The
  `272-296` loop does `await retrieve(...)` per won-lead — minor N+1 for the
  RAG call but capped at 5 by `slice(0, 5)`.

### Indexes that look fine
The recent migrations (117-139) generally do add an index in the same file
when they add a filterable column. Notable green-light examples:
- mig 131: `idx_referral_payouts_partner/status/lead`, `idx_channel_partners_portal_token` (unique)
- mig 130: `idx_invoices_e_invoice_status` partial
- mig 139: `idx_leads_ai_score` partial, `idx_qc_findings_pending_review` partial,
  `idx_anomaly_unresolved` partial, `idx_vendor_bills_ai_pending` partial
- mig 138: `rag_chunks_embedding_hnsw` (vector), `idx_rag_query_log_caller`,
  `idx_voice_report_awaiting` partial
- mig 127: `idx_milestone_photos_project`, `idx_customer_outreach_status` partial

### Caching is solid
`apps/erp/src/lib/cached-dashboard-queries.ts` correctly wraps the expensive
aggregation RPCs in `unstable_cache` with sensible TTLs and tag-based
invalidation. Use this pattern for any new dashboard KPI.

### Triggers — no obvious "recompute summary on every UPDATE" bugs
The Apr `refresh_project_cash_position` regression (mig 080+081 fix) is the
only one of that class still in living memory. New triggers (mig 131
`fn_auto_create_referral_payout` after fix in mig 134) are lightweight
conditional inserts.

## Recommended fix ordering

| Order | Group | Effort | Why this order |
|-------|-------|--------|----------------|
| 1 | Critical money + N+1 (#1, #2, #4, #5, #7) | 1-2 days | Page-load impact today; mostly SQL RPC refactors |
| 2 | count: 'exact' on growing tables (#10, #11) | Half day | Hot-path / called per request; cap them now before they bite |
| 3 | Index gaps (#18, #19) | 15 min each | One migration; runs before scale arrives |
| 4 | bom-review consolidation (#12) | Half day | Single page rewrite + RPC |
| 5 | Anomaly detector PVLib batching (#3) | 1 day | Phase 8 prereq |
| 6 | Partitioning rollout (#8, #9, #22-24) | 2-3 days | Background work; do before next major data event |
| 7 | All MEDIUMs (#13-#17, #20, #21, #25) | 1-2 days | Triage; some can land with the related feature next visit |
| 8 | LOWs | As-touched | Pure cleanup |

## Process notes

Two patterns to enforce going forward:

1. **A new server action that needs aggregated money MUST be an RPC.** The
   default that landed several times (`getProjectFinancials`,
   `getProjectPaymentOverview`, `bom-review/page.tsx` summary, `partners-queries`)
   was "fetch rows, JS reduce." The codebase's good RPCs
   (`get_payment_tracker_rows`, `get_company_cash_summary_v2`,
   `get_lead_stage_counts`) show the team knows the pattern — it's a habit
   problem on new code.

2. **Any `for…of` with `await supabase.from(...)` inside is a smell.** The
   one-liner mental check: "Can this be a `.in('id', ids)` or an embed or a
   LEFT JOIN?" — usually yes. The three N+1s in `task-suggestion-scanner.ts`
   are textbook examples that would be caught by a lint rule (e.g. ESLint
   no-await-in-loop with a Supabase context check).

*Reviewed 2026-05-30.*
