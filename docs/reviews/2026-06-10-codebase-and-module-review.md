# Codebase + Module-by-Module Review — June 10, 2026

> Full-repo review requested by Vivek: overall assessment + per-module review (code quality vs house standards, UI/UX, speed/scalability at ~10x volume), tied back to the five core business problems. Review only — no code changed.
> Method: docs pass (CLAUDE.md, master reference, all module docs, CURRENT_STATUS) + nine deep code-review passes (app layer, DB layer, packages/CI, and six module groups), with the highest-stakes claims spot-verified by hand.

---

## Part 1 — Repo-wide verdict

**The architecture is right-sized and the database layer is excellent. The recurring weakness is enforcement: the rules are better than the code's adherence to them.**

### What's strong (keep as-is)
- **Docs/process system** — routing table, incident-calibrated NEVER-DO rules, module docs, changelog discipline. Best-in-class for a team this size.
- **Database layer** — RLS helper discipline + regression sweeps (migs 008a/146), parameterized role-gated search RPCs (152–155, 172), verified partition swaps (164–166), `SET search_path` sweep (141), migration headers with rationale.
- **Conventions** — queries/actions split, `ActionResult<T>` (232 usages), Tier 1/2/3 immutability, DB-generated doc numbering, sensitive-field blocklist, `NUMERIC(14,2)` + decimal.js.
- **Self-ratcheting culture** — forbidden-patterns baseline (only goes down), `pnpm build` in CI after a real incident, logs-first debugging rule.
- **Stack** — Supabase + Next 14 + n8n + spare-laptop services is correct for single-tenant at this scale. Do not microservice it. DB-trigger-enforced gates (CEIG, IR-test, sum-to-100%) are correct given multiple write paths.

### Repo-wide issues (ordered)
1. **42 test files exist; CI runs none of them.** `ci.yml` = check-types + lint + forbidden-patterns + build only. The ₹0-Quick-Quote bug (passed for months on fake mocks) is the canonical warning. One-line fix.
2. **~393 `as any` across 78 files** despite NEVER-DO #3/#11 — and the ratchet doesn't measure general `as any`, only `from('x' as any)`. Worst: `projects/[id]/page.tsx:91-262` (~47 casts; `getProject()` is properly typed, so the casts are pure debt).
3. **Documented-but-unfixed known bugs age silently.** From the May 30 review, still open: 7 files inserting `notification_type` values that violate mig 014 CHECK (PO/RFQ/closure notifications silently 23514); n8n `00-event-bus-router.json` connections off-by-N from rule 7 (proposal.sent_to_customer routes to the PO-approved workflow); 15 PostgREST `.or()` filter-injection points. (`addCostVariance`/`project_profitability` was fixed 2026-05-30 — verified gone.)
4. **CURRENT_STATUS.md** is ~40k tokens with a 4,000-word "last updated" paragraph — violates its own snapshot mandate; history belongs in CHANGELOG.
5. **Migration numbering**: 12 duplicate numbers (2×018, 2×019, 2×073…), missing 124, pre-120 migrations non-idempotent (bare `CREATE INDEX`).
6. **37 MB of Zoho Books `.xls` committed under `docs/Zoho data/`** — real financial data in git history; contradicts the GitGuardian lesson and the "no real financial data in dev" principle.
7. **Edge Function adapter drift risk** — `inverter-poll/index.ts` (~1,200 LOC) holds inlined Deno copies of Growatt/Sungrow/FIMER adapters synced only by `// SYNC WITH` comments. No CI drift check.
8. **Process**: direct pushes to main (NEVER-DO #9 deferred); 118 flat files in `scripts/`; the burst-review pile grows faster than it burns down.

---

## Part 2 — Module-by-module

Grading axes: **A** code quality vs house standards · **B** UI/UX for the role using it · **C** speed/scalability at ~10x.

### Sales (incl. proposals/quoting) — strong; one index gap matters most
Money handling is clean here (Decimal.js on BOM totals, pipeline/close-window/expected-orders all via RPCs, `count: 'estimated'`).

- **C — VERIFIED: no index on `leads.expected_close_date`** (no migration creates one). The Closing-This-Week/Month cards and `?closeFrom/closeTo` filter will table-scan at 30k leads. Add `idx_leads_expected_close_date` (consider composite with `status`). Also consider explicit indexes on `leads.channel_partner_id` and `leads.draft_proposal_id`.
- **A** — `as any` in `leads-queries.ts:94` (`filters.segment`), `inline-edit-actions.ts:70-71` (`.from(tableName as any)` — the dynamic-table inline-edit path deserves a typed whitelist), `leads-table.tsx:147`.
- **B** — No real-time phone-uniqueness check on the lead form (duplicate surfaces only as a submit-time DB error; the partial unique index exists, so a debounced check is cheap). Pipeline counts cached 300s can lag right after a stage change — fine, but revalidate the tag on stage-change mutations.
- **C** — `/sales` does 9 parallel queries before leads fetch — acceptable; keep an eye on it.

**Suggestions (priority):** (1) add expected_close_date index; (2) sweep the 3 `as any` sites + type the inline-edit table whitelist; (3) debounced phone check on lead form; (4) revalidate pipeline-summary tag on stage change.

### Design — works; failure modes are too quiet
- **A/B** — `design-queries.ts:78-85`: failed child loads (survey, price book) log server-side but render nothing to the user; if price_book fails, the BOM picker is just empty. Return per-source errors and show a load-issues banner.
- **B** — No "request survey update" escape hatch when survey data is stale; designer context lives on `leads.design_notes` (good) but there's no nudge path back to the surveyor.
- **C** — Price book (~250 rows) fetched on every workspace load; cache 1h or add a Last-Updated badge. `getLead()` + `getDesignWorkspaceData()` can run in `Promise.all`.

**Suggestions:** (1) surface data-load errors in the workspace; (2) parallelize the two top-level fetches; (3) cache price book reads; (4) "survey looks stale → notify surveyor" action (n8n event).

### Projects — the flagship module needs its types back
- **A — `projects/[id]/page.tsx:91-262`: ~47 `(project as any)` casts** on the most-used page in the ERP, plus an inline Supabase call for primary contact (lines 92-98, NEVER-DO #15). `getProject()` infers correctly — define/return the row type and delete the casts; move the contact resolve into `projects-queries.ts`.
- **A** — ~169 `as any` across project lib files (stepper queries, BOQ actions) — same root cause, mechanical fix.
- **C** — N+1s: `getBoiState()` (stepper-queries:125-135) does project-then-employee lookups → one JOIN; `getStepSurveyData()` (:46-72) double-fetches → single query on `lead_site_surveys`. Verify a `(status, created_at)` index on `projects` for the list page.
- **B** — Completion-checklist rollback (`completion-checklist.tsx:56-72`) has no confirmation and no audit of who un-completed a milestone — these tick-boxes feed completion % which gates payment milestones; add confirm + audit log. Stepper error states are generic "Failed to Load" — include error codes/Sentry breadcrumbs.
- ✅ Old `addCostVariance`/`project_profitability` bug: already removed (2026-05-30). Not open.

**Suggestions:** (1) type the detail page (kill all 47 casts); (2) confirm+audit on completion rollback; (3) fix the two stepper N+1s; (4) structured stepper errors; (5) verify projects list index.

### Liaison — correct model, missing pagination
- ✅ `get_liaison_summary()` aggregates in SQL; partial index on `awaiting_client_details`; role-gating correct (PM read-only via `readOnly` prop); CEIG visibility logic now correct post-mig 115.
- **C** — `getAllNetMeteringApplications()` returns **all rows, no limit** — the one unpaginated list that will hurt first at 10x. Add limit + pagination.
- **C** — `liaison-actions.ts:70-96`: event emission re-queries project + NMA serially; combine.

**Suggestions:** (1) paginate `/liaison`; (2) batch the event-emit fetches.

### Purchase / Procurement — strongest security posture; worst money-math violation
- ✅ Vendor portal: admin client + per-request token re-validation, expiry checks, fire-and-forget audit logging that never blocks mutations. Three-way-match data model solid (mig 123 reconciliation view exists).
- **A — VERIFIED: `po-actions.ts:82-84` computes subtotal/GST/total with native-float `.reduce()` and PERSISTS them to `purchase_orders`.** This is the most consequential NEVER-DO #12 violation in the repo (stored money, not display). The same totals logic is duplicated in `rfq-actions.ts` (PO generation from awards) and `procurement-actions.ts:60-68`. Fix once: a `fn_recalc_po_totals(po_id)` SQL function (or DB trigger), called from all three.
- **A** — `rfq-actions.ts` (1,243 LOC) is mostly justified by domain complexity, but the duplicated totals/approval logic should be extracted. `as unknown as` casts at po-actions:371, rfq-actions:162; `as any` at procurement-queries:260.
- **C** — Vendor portal token validation runs 4-6 sequential queries per page load → collapse into one `fn_validate_rfq_invitation_token(token)` RPC. Summary cards on `/procurement` count by filtering all rows in JS → SQL counts. `getPurchaseOrder()` 4-level nested join is payload-heavy.
- **B** — MSME Day-40 alert is a dashboard card only — no proactive notification despite the master-reference alert table specifying one. Wire an n8n daily job (and log sends to `procurement_audit_log` for the tribunal trail). Add per-item match-status (PO→DC→GRN qty) on PO detail. No rate limiting on the vendor-portal token route (brute-force enumeration); add per-IP limits.

**Suggestions:** (1) SQL-side PO totals (fix + dedupe, all three files); (2) MSME Day-40 proactive alert via n8n; (3) single-RPC vendor-portal token validation + rate limit; (4) three-way-match status column on PO detail; (5) SQL counts for procurement summary cards.

### Inventory — sound model, two ledger gaps
- **A/B** — `inventory_cut_records` and `stock_pieces.current_length_m` are independent ledgers (documented gotcha): a cut logged on the Materials tab doesn't decrement the stock piece. Bridge with an optional FK + synchronous decrement — this is the warranty-chain module, the ledgers must agree.
- **C** — `search_inventory_stock_pieces` hardcodes `p_limit: 1000` with no pagination UI; realistic to exceed within 2-3 years. Parameterize + paginate.
- **B** — Low-stock is a dashboard card only — same pattern as MSME; wire a (deduped, 7-day) n8n notification. `allocateToProject()` doesn't write to `procurement_audit_log` — add for serial→allocation traceability.
- **C** — `getLowStockCutLengths()` filters thresholds in JS after pulling all active rows — push the WHERE into the RPC.

**Suggestions:** (1) bridge cut-records ↔ stock_pieces; (2) paginate stock RPC; (3) low-stock notification; (4) audit-log allocations.

### Finance — architecturally the best app-layer module; precision nits
- ✅ Immutability verified: no update/delete paths on customer invoices/payments; vendor bills state-machine only; no `deleted_at` on financial tables. `getProjectPaymentOverview` JS-aggregation flagged in May was fixed by mig 145 (RPC). Founder cash dashboard: `is_invested` prominent, 600s `unstable_cache` with tag revalidation, e-invoice GST math fully Decimal.js with 15 vitest cases.
- **A** — `finance-actions.ts:293` `} as any)` on the `vendor_payments` insert — likely masking schema drift on a financial write path; regenerate types and fix properly.
- **A** — `payments-overview-queries.ts:118-120`: expected-this-week/month KPIs summed with native `+` while neighbouring code (95-111) uses Decimal — finish the job.
- **C** — `/invoices` and `/vendor-bills` lists appear unpaginated; `get_msme_due_count` RPC failure silently renders 0 (a compliance number should fail loudly, not show a wrong zero).
- **B** — MSME list has no inline "record payment" quick action (drill into `/vendors/[id]` each time).

**Suggestions:** (1) fix the `as any` insert; (2) Decimal the two KPI reduces; (3) paginate invoices/vendor-bills; (4) loud failure for MSME count; (5) inline pay action.

### Expenses — fine; small hardening
- `updateExpense` accepts raw `number` — coerce via `new Decimal(amount).toFixed(2)` on input. Paginate `/expenses`. Field-level error feedback on rejection.

### O&M — fundamentals verified solid; aggregation hot-spots
- ✅ Verified: frontend only queries `_hourly`/`_daily` rollups (never raw readings); unpartitioned `plant_data_readings` was dropped in mig 150; credentials pgcrypto-encrypted with role-gated decrypt RPCs — plaintext never reaches client components or logs; bulk-approve is sequential to preserve LEGACY numbering.
- **C** — `amc-actions.ts:489-530` `getAllAmcData`: per-contract visit loops + client-side grouping (O(N²)) → one GROUP BY query; add pagination.
- **C** — `/om/profitability` re-aggregates KPIs in JS from an unpaginated RPC → window-function totals in the RPC.
- **C** — Ticket search uses unindexed ILIKE on title → GIN/trigram index when ticket volume grows.
- **A** — `import-review-actions.ts:11,29,47`: `(supabase.rpc as any)` — type the 5 import RPCs properly.
- **B** — Import-review: per-row PasswordField lacks the copy button plant-monitoring has → extract one shared `password-reveal-field.tsx`; 50/page over 593 rows is 12 page-loads of pure friction → 100-150/page. Mig 159's approve cascade rolls back atomically but logs no per-step trail — fine for now, add step audit if retry-after-partial-failure becomes common.
- **Resilience** — anomaly detector has no retry/backoff on PVLib timeouts; failures suppress expected-kWh and can mute auto-tickets.

**Suggestions:** (1) SQL-side AMC stats + pagination; (2) profitability KPIs in RPC; (3) type the import RPCs; (4) shared password-reveal component + bigger import pages; (5) ticket search index; (6) PVLib retry.

### HR — security verified; one rendering wall ahead
- ✅ Verified: May-30 privilege-escalation fixes hold (`createEmployeeAccount`/`deactivateEmployee` gate `['founder','hr_manager']`, founder-only founder creation); compensation double-gated (app + DB RLS); zero sensitive values in logs; leave approval atomic via RPC (mig 136); `SensitiveField` masked-by-default with `select-none`.
- **C** — Attendance grid mounts ~1,550 interactive client cells (50 emp × 31 days) with no virtualization — works at 50 employees, will degrade at 100+. Virtualize rows (or render cells read-only until clicked) when headcount grows.
- **B** — `/hr/leave/all` doesn't show `rejected_reason` inline (already selected by the query — just render it).
- **C** — Attendance CSV builds client-side; fine below ~5k rows.

**Suggestions:** (1) plan grid virtualization at 100+ headcount; (2) show rejection reasons inline; (3) keep payroll-export path server-side as volume grows.

### Contacts — good bones; pre-import debt to clear
The Google/iPhone import will take this from ~hundreds to 10k+ rows; clear these before, not after:
- **A** — 6× `as any` in `contacts-actions.ts` (40, 84, 122, 134, 349) — type with `Tables['contacts']['Insert']` etc.
- **C** — TODO S10 (`contacts-queries.ts:33-40`): `search_contacts` returns full rows + nested relations when list callers need id/name/company — trim the RPC shape (~50-70% payload cut) before import.
- **A** — `contacts.owner_id` set on activities but never on contact create — pick a rule (default to current user) and apply it before RLS ever depends on it.
- **Security** — `/api/contacts/search` is auth-gated (May-30 fix verified) but unlimited — add per-user rate limiting (contact-book enumeration is exactly the "knowledge walks out with people" risk inverted). Its catch block silently returns `[]` — log it.
- **B** — No in-app merge/dedup UI; required anyway by the planned fuzzy-match import spec — build it as part of that work, not separately.

**Suggestions (pre-import checklist):** (1) trim search RPC; (2) type the actions; (3) rate-limit + log the search API; (4) settle owner_id; (5) merge UI with the import feature.

---

## Part 3 — Cross-module themes & suggested order

**Themes** (same root causes repeating):
- **T1 — Stored-money float math**: po-actions (persisted!), rfq-actions, procurement-actions; Decimal gaps in payments-overview, expenses input. One SQL-totals fix covers the worst of it.
- **T2 — `as any` debt concentrated in ~6 files** (projects detail page, import-review RPCs, contacts actions, finance insert, inline-edit) — one sweep + a ratchet rule prevents regression.
- **T3 — Unpaginated lists**: liaison, invoices, vendor-bills, expenses, stock pieces, AMC contracts, profitability.
- **T4 — Dashboard-only alerts** where the spec demands proactive ones: MSME Day-40, low-stock.
- **T5 — Quiet failures**: design workspace loads, MSME count→0, contacts search catch, stepper "Failed to Load".
- **T6 — Two-ledger drift**: cut-records vs stock_pieces.

**Suggested batches** (each one session, CI-gated, in this order):
1. **Correctness & money**: SQL PO totals (T1) + finance `as any`/Decimal gaps + notification CHECK violations (May-30 leftover) + event-bus router rebuild.
2. **CI & ratchet**: add `pnpm test` to ci.yml; ratchet rules for `as any` count and action throws; migration duplicate-number check.
3. **Type-safety sweep** (T2): projects detail page first, then import-review, contacts, inline-edit whitelist.
4. **Scale guards** (T3 + indexes): expected_close_date index; paginate liaison/invoices/vendor-bills/stock/AMC; AMC + profitability SQL aggregation; vendor-portal single-RPC validation.
5. **Proactive alerts & UX polish** (T4/T5): MSME + low-stock n8n jobs; design/stepper error surfacing; leave rejection reasons; shared password-reveal; completion-rollback confirm+audit.
6. **Pre-contacts-import package**: search RPC trim, rate limit, owner_id, merge UI (with the import spec).

Repo hygiene to schedule independently: Zoho `.xls` out of git, CURRENT_STATUS.md diet, migration renames, `scripts/` foldering, adapter drift check.
