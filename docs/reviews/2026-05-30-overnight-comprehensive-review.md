# Comprehensive Overnight Review — 2026-05-30

> Multi-agent review across 6 dimensions: architecture, security, type safety, performance, dead code, test coverage.
> Full per-dimension reports live in `docs/reviews/sections/2026-05-30-*.md`.
> Dispatched 2026-05-30 evening as part of the overnight work batch.

---

## How to read this

Each dimension was reviewed by an independent agent with full repo access (read-only). Each produced a findings doc with severity-tagged entries citing file:line.

The same severity scale is used throughout:
- **CRITICAL** — data loss / security risk / runtime crash on a money path
- **HIGH** — NEVER-DO violation in committed code / silent wrong data / will fail at scale
- **MEDIUM** — drift from documented standards / suboptimal / lint-cheat hiding a real bug
- **LOW** — cleanup / style / micro-optimization

---

## Per-dimension report links

| Dimension | File | Status |
|-----------|------|--------|
| Architecture & coding standards | [`sections/2026-05-30-architecture.md`](sections/2026-05-30-architecture.md) | (filled in below) |
| Security | [`sections/2026-05-30-security.md`](sections/2026-05-30-security.md) | (filled in below) |
| Type safety & schema correctness | [`sections/2026-05-30-types.md`](sections/2026-05-30-types.md) | (filled in below) |
| Performance & database | [`sections/2026-05-30-performance.md`](sections/2026-05-30-performance.md) | (filled in below) |
| Dead code & duplicates | [`sections/2026-05-30-dead-code.md`](sections/2026-05-30-dead-code.md) | (filled in below) |
| Test coverage gaps | [`sections/2026-05-30-test-coverage.md`](sections/2026-05-30-test-coverage.md) | **62 findings — 8 CRITICAL** (covered below) |

---

## Executive summary (filled in once all 6 agents return)

(Top 3-5 cross-cutting themes here.)

---

## Critical findings (cross-dimension)

(Filled in after consolidation.)

---

## Safe fixes applied overnight

(List of fixes I applied directly to the repo, with file:line references. Each is mechanical and has a verifying CI gate.)

### From test coverage review
- **Playwright e2e**: added smoke tests for `/sales/patterns`, `/sales/territories`, `/vendor-bills/review`, `/referrals`, `/hr/benchmarking`, `/admin/rag-debug`, `/p/[token]` (covering findings 40-44 and others) in [`apps/erp/e2e/smoke.spec.ts`](../../apps/erp/e2e/smoke.spec.ts).

### From security review

**CRITICAL fixes (applied — recommend Vivek review tomorrow morning to validate the role list):**
- **Finding #1, #2** (privilege escalation in employee-actions): added `await requireRole(['founder', 'hr_manager'])` to top of `createEmployeeAccount` and `deactivateEmployee` ([apps/erp/src/lib/employee-actions.ts](../../apps/erp/src/lib/employee-actions.ts)). Without this, any authenticated user could POST `{ role: 'founder', email: 'attacker@x.com' }` and own the org, or ban the founder for 100 years. Page-level gate at `/hr/employees/new` was bypassed because server actions are independent HTTP endpoints.

**HIGH fixes (applied):**
- **Finding #4** (no auth on `/api/contacts/search`): added `getUser()` gate; returns 401 if unauthenticated. Defense-in-depth — previously relied entirely on RLS via the cookie-bound server client.
- **Finding #9** (no token length check on `/p/[token]/page.tsx`): added `if (!params.token || params.token.length < 32) notFound();` matching the PDF route's guard.
- **Finding #19** (`emitErpEvent` sends webhook with empty secret when env unset): now early-returns with a loud `console.error` log when `N8N_EVENT_BUS_URL` is set but `N8N_WEBHOOK_SECRET` is missing. Previously the request still left the network (leaking event metadata) before n8n rejected it.

**MEDIUM fixes (applied):**
- **Finding #15** (partner PAN displayed unmasked): wrapped in `maskSensitiveField` on `apps/erp/src/app/(erp)/partners/[id]/page.tsx`. Server-side mask — unmasked value never reaches the browser.
- **Finding #16** (vendor PAN displayed unmasked): same fix on `apps/erp/src/app/(erp)/vendors/[id]/page.tsx`.

**Security fixes NOT applied — need Vivek's call:**
- **Finding #3** (`process-document` Edge Function unauthenticated): the agent's recommended fix breaks the `scripts/extract-existing-documents.ts` backfill. Vivek needs to decide between service-role JWT, function-specific secret, or bearer-required mode.
- **Finding #5** (`PostgREST .or()` filter-injection across 15 files): ~13-file refactor, needs a coordinated pattern change. Tomorrow.
- **Finding #6, #7, #24** (SQL search_path + GRANT TO anon hardening): needs a sweep migration affecting ~30+ SECURITY DEFINER functions. Worth a dedicated migration, not a rushed overnight one.
- **Finding #8** (30-day signed URL TTL on proposal-sent webhook): needs a product decision on how long customers should be able to access the PDF after we send it.
- Plus all 7 of the agent's "Needs Vivek review" entries.

### From architecture review
Read the per-dimension report [`sections/2026-05-30-architecture.md`](sections/2026-05-30-architecture.md) for full 42-finding list. **Not auto-fixed tonight** because most are multi-file refactors:
- NEVER-DO #12 money-in-JS violations in `closure-actions.ts`, `po-actions.ts`, `project-detail-actions.ts`
- New migrations 138/139 regressed on RLS-helper discipline — ~20 policies use raw `EXISTS (SELECT ... profiles WHERE id = auth.uid())` instead of `get_my_role()` (master ref §5.6 says this can infinite-recurse)
- 17 server-action files still using legacy `Promise<{success, error?}>` shape (NEVER-DO #19 spirit)
- `plant_data_readings` (mig 005d) not partitioned (NEVER-DO #16)
- `as any` widespread: 196 occurrences in 31 files
- `getLeadTasks` throws from a 'use server' file (NEVER-DO #19) — single-file fix, can be done in next pass

### From type-safety review

**Applied tonight (1 file edit):**
- **Type-safety finding #2** (CRITICAL — handover PDF wrong columns): fixed `handover-actions.ts:46-67` to use real columns `item_category`/`item_description`/`model` instead of nonexistent `category`/`item_name`. The bug made every customer handover pack PDF render "As per BOM" / "—" / 0 for panel + inverter brand/model regardless of what the BOM actually contained. Verified against dev schema (`item_category` value is `'panel'` singular, not `'panels'`).

**Read the per-dimension report [`sections/2026-05-30-types.md`](sections/2026-05-30-types.md) for full 40-finding list.** Other CRITICAL findings NOT auto-fixed because they need careful testing / are pre-existing in hot money paths:
- `project-step-actions.ts:761-768` inserts to `project_profitability` with 4 nonexistent column names + omits NOT NULL `total_revenue` → every `addCostVariance` fails when no row exists
- 7 files insert `notification_type` and `entity_type` values violating mig 014 CHECK (`closure_approval`, `procurement`, `po_pending_approval`, `po_approved`, `po_rejected`, `rfq_quote_submitted`, `rfq`) → every PO approval and amber-band closure notification silently fails CHECK 23514
- 2 RPCs called via `as never` in `referral-queries.ts:21,29` don't exist (`get_referral_commission_*`) → KPI strip permanently ₹0
- `increment_boq_dispatched_qty` RPC at `project-step-actions.ts:1095` doesn't exist → always falls through to manual JS update
- `get_msme_due_count` exists in mig 028 but not in regenerated `database.ts` → stale typegen
- 196 `as any` casts conceal real schema mismatches (broader than the baseline `from('x' as any)` check)

### From performance review

**Applied tonight (1 migration):**
- **Performance finding #18** (MEDIUM — missing `inverter_id` index on `inverter_poll_failures`): added in [`supabase/migrations/140_2026-05-30-perf-indexes.sql`](../../supabase/migrations/140_2026-05-30-perf-indexes.sql). Existing index was only on `attempted_at DESC` (footer query). Phase 8 polling will scale this table to ~10K rows/day.
- **Performance finding #19** (MEDIUM — missing `tasks(category)` partial index): added in the same migration. Task suggestion scanner filters by category every cron run.

Both indexes applied to dev DB via MCP. Safe additive — no behaviour change.

**Read the per-dimension report [`sections/2026-05-30-performance.md`](sections/2026-05-30-performance.md) for full 30-finding list.** CRITICAL/HIGH NOT fixed:
- CRITICAL: `getProjectPaymentOverview` (`payments-overview-queries.ts:39-176`) — JS aggregation of 360+ projects' payments/POs/expenses via 4 reduce loops. NEVER-DO #12. Needs a `get_project_payment_overview()` SQL RPC.
- CRITICAL: `scanStaleItems` (`task-suggestion-scanner.ts:56,111,167`) — three N+1 `tasks` lookups in the daily AI cron.
- HIGH: `detectAnomalies` (`anomaly-detector.ts:373`) — 350 PVLib HTTP calls per anomaly run at current cohort size.
- HIGH: `record_audit_log`, `rag_query_log`, `lead_activities`, `customer_message_log`, `message_delivery_log` all unpartitioned time-series (NEVER-DO #16).
- HIGH: 5 new `count: 'exact'` introductions on `tasks`/`rag_query_log` that fall outside the forbidden-patterns baseline.

### From dead-code review
*(Status TBD — agent still running. Will append on completion.)*

---

## Findings deferred for Vivek's review (high-value, judgment-call)

(Filled in after consolidation.)

---

## Known follow-up gaps NOT addressed overnight

- **Forbidden-pattern baseline reduction**: baseline currently at 64. Most R13 entries are filtered subset counts where switching to `count: 'estimated'` would hurt accuracy without performance gain. Most R15 entries are inline `createClient` usage in pages doing auth + role checks; the cleanest fix is a shared `requireRole()` helper, but that's a multi-file refactor that needs its own focused pass.
- **`*-actions.ts` ActionResult migration**: only ~5 of ~56 files migrated; rest grandfathered. The test-coverage review surfaced that all 61 are also untested — combined fix is a single sweep that pairs ActionResult + test.

---

## Pre-existing bugs flagged for follow-up

### CRITICAL — `infrastructure/n8n/workflows/00-event-bus-router.json` connections array is off-by-N

Discovered while adding 3 new Switch cases (`lead.win_loss_analysed`, `vendor.bill_ai_approved`, `vendor.bill_ai_rejected`).

The Switch node's rules array has 33 entries (now 36 with the 3 additions). The connections array's `"Route by event"."main"` has 33 entries. Each connection entry maps by INDEX to the Switch's output index. Inspection shows the mapping is correct for indices 0-6 but breaks starting at index 7:
- Rule 7 = `proposal.sent_to_customer` → routes to **`→ 07 PO approved`** (WRONG TARGET — should be `→ 26 Proposal sent to customer` or similar)
- Rule 8 = `purchase_order.approved` → routes to **`→ 09 GRN recorded`** (WRONG)
- Rule 16 = `employee.created` → routes to **`Log unhandled event`** (WRONG)
- All subsequent rules are similarly off-by-one or off-by-multiple

Practical impact: any event emitted at rule indices 7+ likely fires the wrong downstream workflow. Suspect this hasn't bitten production yet because `proposal.sent_to_customer` may not actually be emitted often (Vivek hand-tested it on May 20, but the test path may have bypassed the router).

**Fix path**: rebuild the connections array from scratch in rule-index order, with one connection entry per rule (33 + 3 new = 36 entries) plus one for the `unhandled` fallback at index 36. Apply via `scripts/fix-event-bus-router-connections.ts` so the fix can be verified by checksumming the resulting node-name list against the rules' `outputKey` list.

**Not fixed tonight** because: load-bearing for the production router; needs n8n-end smoke test before activating. Flagged here for a dedicated fix pass.

---

(More findings appear below as agents return.)
