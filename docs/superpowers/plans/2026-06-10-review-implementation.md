# Fable Review Implementation Plan — June 10, 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan batch-by-batch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work through every actionable finding in the two June-10 review docs (`docs/reviews/2026-06-10-codebase-and-module-review.md` and `…-deep-review-security-ops-data.md`, currently in PR #6) and land the fixes, in a safe, CI-gated, review-checkpointed sequence.

**Architecture:** The review is ~30+ findings across many *independent* subsystems (money-math, deps/CVE, type-safety, CI, scale, alerts, a11y, security, DR/DPDP). Per the writing-plans Scope Check, this is not one feature — it is a program of work. This document is the master roadmap: it maps **every** finding to a location, a fix approach, a verification, and an **owner**, grouped into batches. Each batch is one (or a few) CI-gated sessions ending in a Vivek review. Batches 0–1 are detailed to step level; Batches 2–6 and the sweeps are at finding→approach→verify level and get step-expanded when we reach them (deliberate phased detail — not placeholders).

**Tech Stack:** Next.js 14 + TS · Supabase Postgres (RLS, SECURITY DEFINER RPCs, declarative partitions, pg_cron) · Deno edge functions · n8n · decimal.js / NUMERIC(14,2) · vitest · Sentry.

---

## Conventions for this program

**Owner legend:**
- **[C]** — Claude implements end-to-end (code + local CI gates + commit/push to main + CHANGELOG/module-doc).
- **[C→dev]** — Claude writes the SQL/code; the change includes a numbered migration that **Vivek applies to dev** (the de-facto live system) and Claude regenerates `database.ts` in the same commit. No prod until Vivek green-lights a window (standing rule — `project_dev_only_no_prod`).
- **[C→n8n]** — Claude edits the workflow JSON; **Vivek pushes to live n8n** (`pnpm tsx scripts/push-n8n-workflows.ts`) and activates via the UI. Claude never pushes n8n.
- **[V]** — Vivek-only: destructive, infra, credential, or org/process. Claude may prepare a runbook but does not execute.
- **[DECIDE]** — needs a Vivek decision before any code is correct.

**Hard rules carried through every batch:** run all four CI gates locally and read their real stdout before pushing (`pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh && pnpm build`); money in SQL/decimal.js never JS floats; no `as any`; regen `database.ts` in the same commit as any schema change; one CHANGELOG line per batch.

**Two findings were already retracted by the review itself** (verified against the live DB) and are **out of scope**: the `leads.expected_close_date` "missing index" (it exists — `idx_leads_expected_close`) and the n8n event-bus router "off-by-N" (wiring is correct). Do not re-implement these.

---

## Recommended sequence

| Batch | Theme | Owner mix | Why here |
|------|-------|-----------|----------|
| **0** | Security quick wins (code) | [C] | Fast, high-consequence, low-risk: an unpatchable-CVE parser on an untrusted-upload path, a one-line SSRF bump, PII-to-Sentry exposure, a real secret in a test fixture. |
| **1** | Correctness & money | [C], [C→dev] | The only **persisted** float-math money bug in the repo (NEVER-DO #12) + silently-failing notification inserts. Correctness before everything. |
| **2** | CI & ratchet | [C] | Make "green" mean something (42 test files, 0 run; suite is currently RED) before the big sweeps land on top of it. |
| **3** | Type-safety sweep | [C] | ~393 `as any`; flagship `projects/[id]/page.tsx` (~47 casts). Mechanical once the ratchet (Batch 2) guards regression. |
| **4** | Scale guards | [C], [C→dev] | Unpaginated lists, JS aggregation, RLS perf hygiene — all bite at ~10x, none urgent today. |
| **5** | Proactive alerts & UX | [C], [C→n8n] | MSME/low-stock alerts the spec demands; quiet-failure surfacing; a11y. |
| **6** | Pre-contacts-import package | [C] | Trim/rate-limit/owner_id/merge-UI — do as part of the contacts-import feature, not before. |
| **R** | Vivek runbook | [V], [DECIDE] | Git-history purge + rotation, DR, escrow, PII-encryption decision, proposal-fate, DPDP. Runs in parallel; some items gate the cutover, not my batches. |

**Gating notes:** Batch 2's "add `pnpm test` to CI" step depends on fixing the 4 red suites *within* Batch 2. The Vivek-runbook git-history purge and the Zoho-`.xls`-out-of-history hygiene item are the same `git filter-repo` operation — bundle them. Everything else is independently shippable.

---

## Part A — Vivek runbook (parallel; [V] / [DECIDE])

These are surfaced first because two of them (git-history purge, DR) are the highest-severity items in the whole review and are **not mine to execute**. Claude will, on request, produce a step-by-step runbook for each; Claude will not run destructive/infra/credential operations autonomously.

- **R1 [V] — Purge git history of the leaked plant credentials + rotate them.** Deep-review §4. Working tree was scrubbed June 6 (commit `88a275f`) but history was **not** rewritten: `git show a573304:scripts/count-plant-credentials.ts` still yields ~186 plaintext customer-portal passwords. Until history is rewritten (`git filter-repo`) **and** the passwords rotated, the leak is live. *Doc calls this the #1 security action.* Bundle with **R9** (Zoho `.xls`).
- **R2 [V] — Move backups off the protected project + run one restore drill.** Deep-review §9. The only automated backup is the n8n SQLite tar uploaded to a bucket on the **same dev Supabase project** it protects; the ERP DB relies solely on Supabase 7-day PITR; no restore has ever been test-run. Gates the prod cutover (the cutover spec assumes a restore works).
- **R3 [V] — Document a bus-factor escrow.** Deep-review §9. `N8N_ENCRYPTION_KEY` (lose it = all n8n creds unreadable), Supabase dashboard, Meta/WhatsApp, Google OAuth, `.env.local` — all Vivek-only, no escrow.
- **R4 [DECIDE] — Encrypt aadhaar/PAN/bank columns, OR correct master-ref §13.** Deep-review §3. Columns are **plaintext `text`** today (only `plant_monitoring_credentials.password_encrypted` is real pgcrypto). Live exposure is currently theoretical (0 employees have aadhaar populated) but the master reference falsely claims these are "column-level encrypted via pgcrypto." Decide: encrypt with the mig-158 pattern **before** HR onboarding enters data, or fix the doc. If "encrypt," it becomes a [C→dev] task.
- **R5 [DECIDE] — Fate of the 268 `financials_invalidated` proposals.** Deep-review §2 (up from 165 in May — HubSpot-import corruption flag accruing). Re-derive vs write off, before cutover.
- **R6 [DECIDE/C] — DPDP package.** Deep-review §9: consent capture for customer phone/marketing, retention cron (privacy page promises 24-month lead deletion), erasure endpoint, storage-EXIF deletion on soft-delete, and a tested guarantee that phone/email/IDs never enter AI prompts/embeddings. Scope is a decision; once scoped, most of it is [C→dev].
- **R7 [V/DECIDE] — Confirm the 18 `security_definer_view` digest views are digest-only** (or add `security_invoker=true` as done for `channel_partners_safe` in mig 161). Deep-review §1.
- **R8 [V] — Enable Supabase Auth leaked-password (HIBP) protection** + move the one `extension_in_public` extension to its own schema. Deep-review §1, both low.
- **R9 [V] — Remove the 37 MB of Zoho Books `.xls` from git history.** Codebase-review §1.6 (real financial data in history). Same `git filter-repo` pass as **R1**.

---

## Part B — Execution batches

### Batch 0 — Security quick wins (code) · [C]

**Files:**
- Modify: `apps/erp/package.json:25` (next), root `package.json:39` (drop xlsx)
- Modify: `apps/erp/src/lib/excel-quote-parser.ts` (xlsx → exceljs)
- Modify: `apps/erp/sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Modify: the FIMER test fixture with the embedded real key (locate in Batch 0 step 1)
- Reference: `docs/SHIROI_MASTER_REFERENCE.md` §4 (sensitive-field blocklist — reuse it for the Sentry redactor)

#### Task 0.1 — Bump Next 14.2.29 → 14.2.35 (SSRF + middleware-bypass)
- [ ] **Step 1:** In `apps/erp/package.json`, change `"next": "14.2.29"` → `"next": "14.2.35"`. Run `pnpm install`.
- [ ] **Step 2:** `pnpm --filter erp build` — Expected: build succeeds (patch bump within 14.2.x; React 19 already present).
- [ ] **Step 3:** Commit `chore(deps): next 14.2.29→14.2.35 — close high-sev SSRF + middleware-bypass`.

#### Task 0.2 — Migrate the vendor-upload parser off the unpatchable `xlsx`
The risk is specifically that `excel-quote-parser.ts` parses **vendor-uploaded** Excel in production (CVE-2023-30533 prototype-pollution + CVE-2024-22363 ReDoS, never patched on the npm `xlsx`). `exceljs ^4.4.0` is already a dependency.
- [ ] **Step 1:** Read `apps/erp/src/lib/excel-quote-parser.ts` fully; enumerate every `XLSX.*` call (`read`, `utils.sheet_to_json`, range/cell access) and the shape the rest of the module expects.
- [ ] **Step 2 (TDD):** If a parser test exists, extend it with a known vendor sample; if not, write `excel-quote-parser.test.ts` that feeds a small `.xlsx` buffer and asserts the parsed rows. Run it against the current `xlsx` impl — Expected: PASS (locks current behavior).
- [ ] **Step 3:** Reimplement the parse with `exceljs` (`new ExcelJS.Workbook(); await wb.xlsx.load(buffer); ws.eachRow(...)`), preserving the output contract. Keep it `async` (exceljs is promise-based).
- [ ] **Step 4:** Run the test — Expected: PASS with identical rows. Remove `import * as XLSX from 'xlsx'`.
- [ ] **Step 5:** Remove `"xlsx": "^0.18.5"` from root `package.json`; `pnpm install`; grep the repo to confirm no remaining `from 'xlsx'` on a production path (scripts-only usage, if any, can stay or move to a pinned SheetJS CDN tarball — note in the commit).
- [ ] **Step 6:** All four CI gates. Commit `fix(security): parse vendor Excel with exceljs, drop unpatchable xlsx (CVE-2023-30533/2024-22363)`.

#### Task 0.3 — Sentry `beforeSend` PII redaction
- [ ] **Step 1:** Extract the sensitive-field list (master-ref §4: `bank_account_number`, `aadhar_number`, `pan_number`, `gross_monthly`, `basic_salary`, `ctc_monthly`, `ctc_annual`, `net_take_home`, `commission_amount`, `pf_employee`) into one shared `apps/erp/src/lib/observability/sentry-redact.ts` exporting a `beforeSend` that deep-redacts those keys from `event.extra`, `event.contexts`, breadcrumbs, and exception `value` strings.
- [ ] **Step 2 (TDD):** `sentry-redact.test.ts` — feed an event whose `extra.pan_number` and an exception message containing a PAN are set; assert both are `[redacted]`.
- [ ] **Step 3:** Wire `beforeSend` + `sendDefaultPii: false` into all three `sentry.*.config.ts`.
- [ ] **Step 4:** CI gates; commit `fix(security): redact sensitive fields before Sentry send`.

#### Task 0.4 — Scrub the real secret in the FIMER test fixture
- [ ] **Step 1:** Locate the fixture in `fimer.test.ts` (deep-review §5 flags a real Aurora Vision API key + password). Confirm it is a live credential.
- [ ] **Step 2:** Replace with obvious dummies (`test-api-key`, `test-password`); ensure the test still asserts shape, not the literal secret.
- [ ] **Step 3:** Commit `fix(security): scrub real Aurora Vision creds from fimer.test.ts fixtures`. *(If the key is/was live, flag it to Vivek for rotation under R1.)*

> **n8n `executeOnce` (deep-review §6, CRITICAL) is [C→n8n], deferred to Batch 5** where the other n8n edits live — Claude edits the JSON, Vivek pushes. Noted here because it is security-adjacent: ~26 Send-WhatsApp nodes on event workflows (01–18, 29–31, 40–47) lack `executeOnce` and will re-send on retry (the Meta-flood failure mode). Must be fixed before those workflows are activated.

---

### Batch 1 — Correctness & money · [C], [C→dev]

**Files:**
- Create: `supabase/migrations/<next>_fn_recalc_po_totals.sql`
- Modify: `apps/erp/src/lib/po-actions.ts:76-98`, `apps/erp/src/lib/procurement-actions.ts:60-84` and `:295-322`, `apps/erp/src/lib/rfq-actions.ts` (PO-from-award totals)
- Modify: `apps/erp/src/lib/finance-actions.ts:293` (`} as any)` insert), `apps/erp/src/lib/payments-overview-queries.ts:118-120` (native `+` KPIs)
- Modify: the 7 files inserting out-of-CHECK `notification_type` (enumerate in step 1; constraint is mig 014)

#### Task 1.1 — PO money totals in SQL (the headline NEVER-DO #12 fix) · [C→dev]
**Verified:** `po-actions.ts:82-84` does `.reduce((s,i)=>s+Number(i.total_price),0)` and **persists** `subtotal`/`gst_amount`/`total_amount` to `purchase_orders`. `procurement-actions.ts` repeats the same JS accumulation at `:60-84` and `:295-322`. `rfq-actions.ts` generates POs from awards with the same logic. Fix once in SQL; remove all JS money math from the three files.

Approach: a `SECURITY DEFINER` function + a **row-level trigger** on `purchase_order_items` so the parent totals are *always* correct regardless of write path (matches the repo's DB-trigger-enforced-gate pattern). The three actions stop computing/persisting totals entirely.

- [ ] **Step 1:** Verify `purchase_orders` total columns' NOT NULL/defaults and `purchase_order_items.total_price/gst_amount` types in `packages/types/database.ts` (so inserting an item-less PO doesn't violate NOT NULL — add `DEFAULT 0` in the migration if needed).
- [ ] **Step 2:** Write the migration:
```sql
-- fn_recalc_po_totals: single source of truth for purchase_orders money totals.
-- Replaces JS float .reduce() in po-actions/procurement-actions/rfq-actions
-- (NEVER-DO #12: never aggregate money in JS).
create or replace function public.fn_recalc_po_totals(p_po_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.purchase_orders po
  set subtotal     = coalesce(t.subtotal, 0),
      gst_amount   = coalesce(t.gst, 0),
      total_amount = coalesce(t.subtotal, 0) + coalesce(t.gst, 0)
  from (
    select sum(total_price)::numeric(14,2) as subtotal,
           sum(gst_amount)::numeric(14,2)  as gst
    from public.purchase_order_items
    where purchase_order_id = p_po_id
  ) t
  where po.id = p_po_id;
$$;

create or replace function public.trg_recalc_po_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_recalc_po_totals(coalesce(new.purchase_order_id, old.purchase_order_id));
  return null;
end $$;

drop trigger if exists recalc_po_totals on public.purchase_order_items;
create trigger recalc_po_totals
  after insert or update or delete on public.purchase_order_items
  for each row execute function public.trg_recalc_po_totals();
```
- [ ] **Step 3:** Hand the migration to Vivek for **dev** apply; on confirmation, regen `database.ts` (Management-API one-liner in CLAUDE.md) + `node scripts/strip-view-fk-entries.mjs` + `pnpm check-types`, same commit.
- [ ] **Step 4:** Edit `po-actions.ts` — delete lines 82-93 (the `.reduce` + the `purchase_orders` update); the trigger now maintains totals after the item `.update` at 62-69. Keep the item update and `revalidatePath`.
- [ ] **Step 5:** Edit `procurement-actions.ts` `:60-84` and `:295-322` — remove the JS `subtotal/gstTotal/totalAmount` accumulation and the totals fields from the `purchase_orders` insert (insert items, let the trigger populate). Same for the `rfq-actions.ts` PO-from-award path.
- [ ] **Step 6 (verify):** Integration check on dev — create a PO with two items, assert `purchase_orders.total_amount` equals the exact NUMERIC sum (e.g. two lines that expose float error like `0.1 + 0.2`); edit a rate, assert recompute; delete an item, assert recompute.
- [ ] **Step 7:** CI gates; commit `fix(purchase): PO money totals via SQL trigger, remove JS float .reduce (NEVER-DO #12)`.

#### Task 1.2 — Finance precision nits · [C]
- [ ] **Step 1:** `finance-actions.ts:293` — the `} as any)` on the `vendor_payments` insert is masking schema drift. Regenerate `database.ts` first (it may already be stale), type the insert as `Database['public']['Tables']['vendor_payments']['Insert']`, fix whatever field mismatch the cast hid. No `as any`.
- [ ] **Step 2:** `payments-overview-queries.ts:118-120` — the expected-this-week/month KPIs use native `+` while `:95-111` already uses Decimal. Convert the two reduces to `decimal.js` (or, preferably, push the sum into the existing RPC if these rows come from one). 
- [ ] **Step 3:** CI gates; commit `fix(finance): type vendor_payments insert + Decimal the expected-payment KPIs`.

#### Task 1.3 — Notification CHECK violations (silent 23514s) · [C]
From the May-30 review, still open: 7 files insert `notification_type` values that violate the mig-014 CHECK, so PO/RFQ/closure notifications silently fail with 23514.
- [ ] **Step 1:** Read mig 014's CHECK to get the allowed `notification_type` set. Grep `notification_type:` inserts across `apps/erp/src/lib` and list the 7 offenders + the value each sends.
- [ ] **Step 2 [DECIDE-in-step]:** For each offender, either (a) the value is legitimate → add it to the CHECK via a new migration [C→dev], or (b) it's a typo → fix the insert to an allowed value. Most are likely (a) (PO/RFQ/closure are real notification kinds).
- [ ] **Step 3:** If (a): write the migration extending the CHECK; dev apply; regen types. If (b): fix inserts.
- [ ] **Step 4 (verify):** Trigger each path (or a unit test on the notification helper) and assert no 23514.
- [ ] **Step 5:** CI gates; commit `fix(notifications): align notification_type inserts with mig-014 CHECK`.

---

### Batch 2 — CI & ratchet · [C]

Goal: make CI runnable and honest, then turn it on. **Order matters: fix red suites before adding `pnpm test` to CI.**

- **2.1 — Fix the 4 failing/unloadable suites** (deep-review §5): `proposal-share-actions.test.ts` (shared-token rate-limiter trips at test 8 — give each test a fresh token; add a rate-limiter unit test); `proposal-send-actions.test.ts` (short-circuits on missing `N8N_WEBHOOK_SECRET` — inject/mocked); `data-review-helpers.test.ts` (live-DB integration that can't load in CI — gate behind an env flag or convert to fixtures); `handover-actions.test.ts` (6 tests never load — vite can't transform the `.tsx` PDF import under `jsx:preserve`; fix the transform/config). Verify: `pnpm test` → **all green** in a clean checkout.
- **2.2 — Adopt the orphaned `scripts/` tests** — `scripts/` has no `package.json`, so its ~34 tests (excel parser, migration utils, credential import) never run. Add a minimal `scripts/package.json` with a `test` script + wire into Turbo.
- **2.3 — Add `pnpm test` to `.github/workflows/ci.yml`** as a 5th step (after build). This is the one-line fix the ₹0-Quick-Quote bug is the warning for.
- **2.4 — Ratchet rules** (codebase-review §1.2, Part 3 B2): extend `scripts/ci/check-forbidden-patterns.sh` (or add a sibling) to (a) count **general** `as any` and fail on increase (baseline = current count), (b) fail on `throw` in a `'use server'` action (NEVER-DO #19), (c) fail on a duplicate migration number, (d) fail on `SECURITY DEFINER` without `SET search_path` in any new migration (deep-review §1). Each rule baselined so it only ratchets down.
- Verify each: the gate fails on a planted violation, passes clean. Commit per rule. Module/CHANGELOG: note the new CI contract.

---

### Batch 3 — Type-safety sweep · [C]

T2: ~393 `as any` concentrated in ~6 files. Do **after** Batch 2's ratchet so regressions are caught. Subdivide by file; each is its own commit; `getProject()` and friends already infer correctly, so most casts are pure debt.

- **3.1 — `apps/erp/src/app/.../projects/[id]/page.tsx:91-262`** — the flagship: ~47 `(project as any)` casts on the most-used page + an inline Supabase call for primary contact (lines 92-98, NEVER-DO #15). Define/return the proper row type from `getProject()`; delete the casts; move the contact resolve into `projects-queries.ts`. ~169 more `as any` across project lib (stepper queries, BOQ actions) — same root cause, mechanical.
- **3.2 — `import-review-actions.ts:11,29,47`** — `(supabase.rpc as any)` on the 5 import RPCs; type them from `database.ts`.
- **3.3 — `contacts-actions.ts` (40, 84, 122, 134, 349)** — 6× `as any`; type with `Tables['contacts']['Insert']`/`['Update']`.
- **3.4 — Inline-edit typed whitelist** — `inline-edit-actions.ts:70-71` `.from(tableName as any)`: replace the dynamic-table path with a typed whitelist (a `Record<EditableTable, …>` map), not a string cast.
- **3.5 — Stragglers** — `leads-queries.ts:94`, `leads-table.tsx:147`, `po-actions.ts:371`/`rfq-actions.ts:162` (`as unknown as`), `procurement-queries.ts:260`.
- Verify per file: `pnpm check-types` + `pnpm build` green; the `as any` ratchet count drops. Commit per file/group.

---

### Batch 4 — Scale guards · [C], [C→dev]

T3 (unpaginated lists) + JS-aggregation hot spots + RLS perf hygiene. None urgent today (e.g. `stock_pieces` has 0 rows); all bite at ~10x.

- **4.1 — Pagination** [C, some C→dev for RPC limit params]: `getAllNetMeteringApplications()` (liaison — *the* unbounded one), `/invoices`, `/vendor-bills`, `/expenses`, `search_inventory_stock_pieces` (hardcoded `p_limit:1000`), `getAllAmcData` (amc-actions:489-530), `/om/profitability`.
- **4.2 — SQL aggregation** [C→dev]: `getAllAmcData` per-contract visit loops + client grouping → one `GROUP BY`; `/om/profitability` JS re-aggregation → window-function totals in the RPC; `getLowStockCutLengths()` JS threshold filter → push WHERE into the RPC.
- **4.3 — Vendor-portal single-RPC token validation + rate limit** [C→dev]: collapse the 4-6 sequential queries per page load into one `fn_validate_rfq_invitation_token(token)`; add per-IP rate limiting on the token route (brute-force enumeration).
- **4.4 — Indexes** [C→dev]: `projects (status, created_at)` for the list page (verify first); GIN/trigram on ticket `title` for O&M ticket search (currently unindexed ILIKE); scan deep-review §1's `unindexed_foreign_keys` for hot-join FKs (ignore `unused_index` — dev-stats artifact).
- **4.5 — RLS performance sweep** [C→dev]: wrap `auth.uid()`/`get_my_role()` in `(SELECT …)` scalar subqueries across policies flagged `auth_rls_initplan` (181, the biggest 10x tax); consolidate `multiple_permissive_policies` (397) where same role/action; drop the 7 duplicate indexes.
- **4.6 — SECURITY DEFINER hygiene** [C→dev]: finish the `SET search_path` sweep (67 functions still lack it); `REVOKE EXECUTE … FROM anon` on the SECURITY DEFINER functions that aren't deliberately public; the CI grep from 2.4 keeps it from regressing.
- Each migration: dev apply + regen types; verify with `mcp__supabase__get_advisors` re-run showing the finding count drop. Commit per coherent unit.

---

### Batch 5 — Proactive alerts & UX polish · [C], [C→n8n]

- **5.1 — Proactive alerts the spec demands** [C→n8n + C→dev for the digest views]: MSME Day-40 (currently dashboard-card-only; wire an n8n daily job, log sends to `procurement_audit_log` for the tribunal trail) and low-stock (deduped, 7-day n8n notification). Claude builds the query/view + workflow JSON; Vivek pushes n8n.
- **5.2 — n8n `executeOnce`** [C→n8n] (deep-review §6, CRITICAL): add `executeOnce:true` to the ~26 Send-WhatsApp nodes on event workflows 01–18, 29–31, 40–47; add missing timezones (30, 40–47, 62, 65); set error-workflow on the 11 that lack it; decide the 6 emitter-without-router events (add cases or document audit-only). Vivek pushes; **must precede activating those workflows**.
- **5.3 — Quiet-failure surfacing** [C]: `design-queries.ts:78-85` (return per-source errors + load-issues banner so a failed price_book doesn't render an empty BOM picker); MSME count→0 (fail loud, not silent zero); `contacts` search catch that returns `[]` (log it); stepper "Failed to Load" → structured error codes/Sentry breadcrumbs.
- **5.4 — UX** [C]: completion-checklist rollback (`completion-checklist.tsx:56-72`) confirm + audit (it gates payment milestones); `/hr/leave/all` render `rejected_reason` inline (already selected); shared `password-reveal-field.tsx` (import-review reuses plant-monitoring's copy button) + bump import page size 50→100-150.
- **5.5 — Inventory ledger bridge** [C→dev]: `inventory_cut_records` ↔ `stock_pieces.current_length_m` — optional FK + synchronous decrement so a Materials-tab cut decrements the stock piece (warranty-chain integrity); `allocateToProject()` writes to `procurement_audit_log`.
- **5.6 — A11y** [C] (deep-review §8): `aria-label`/`title` on ~25 icon-only buttons; `<thead>/<th scope>` on the top hand-rolled tables (or move searchable ones to DataTable); consolidate ~100 hand-formatted money/date sites onto `formatINR`/`formatDate` + an ESLint rule; codemod the top-20 arbitrary hex Tailwind values to tokens; wrap the date-range popover in Radix Popover for keyboard nav.

---

### Batch 6 — Pre-contacts-import package · [C]

Tie to the planned Google/iPhone fuzzy-match import (`docs/superpowers/specs/` contacts spec); these take contacts from hundreds → 10k+, so clear before import:
- Trim `search_contacts` RPC shape (TODO S10, `contacts-queries.ts:33-40`) — return id/name/company for list callers, not full rows + nested relations (~50-70% payload cut).
- Rate-limit + log `/api/contacts/search` (auth-gated but unlimited; the enumeration risk); stop the catch silently returning `[]`.
- Settle `contacts.owner_id` (set on activities, never on contact create) — default to current user — before RLS depends on it.
- Build the merge/dedup UI **as part of** the import feature, not separately.

---

## Repo hygiene (schedule independently; mostly [V])

- Zoho `.xls` out of git history → **R9** (with R1).
- `CURRENT_STATUS.md` diet (codebase-review §1.4): ~40k tokens / 4,000-word "last updated" para violates its own snapshot mandate; move history to CHANGELOG. [C]
- Migration numbering (codebase-review §1.5): 12 duplicate numbers, missing 124, pre-120 non-idempotent — rename/document. The Batch-2.4 dup-number gate prevents *new* ones. [C, careful]
- Edge-function adapter drift (codebase-review §1.7): `inverter-poll/index.ts` inlines Deno copies of Growatt/Sungrow/FIMER adapters synced only by `// SYNC WITH` comments — add a CI drift check. [C]
- `scripts/` foldering: 118 flat files. [C, low priority]

---

## Self-review (run against the two review docs)

- **Coverage:** Every Part-2 module suggestion and every Part-3 theme of doc 1 maps to a Batch 1–6 item; every numbered item of doc 2's consolidated priority list maps to Batch 0 (1-4), Runbook R1-R9 (5-8, 12), Batch 2 (9-10), or Batch 4 (11-12). The two **retracted** findings are explicitly excluded.
- **Owner correctness:** Every migration is [C→dev]; every n8n edit is [C→n8n]; every destructive/credential/infra/decision item is [V]/[DECIDE]. No batch silently assumes a prod push.
- **Gates:** dependencies noted (Batch 2 test-fix before CI-on; R1+R9 bundled; 5.2 before activating event workflows).

---

*Plan authored 2026-06-10 from `docs/reviews/2026-06-10-*.md` (PR #6). Phased detail: Batches 0–1 step-level; 2–6 expand at execution.*
