# Deep Review — Security, Live DB, Tests, Deps, n8n, A11y, DR/DPDP — June 10, 2026

> Second review pass requested by Vivek (after the codebase + module review same day). Nine reviews: live-database health, data integrity, empirical security advisors, static security audit, test quality, dependency/CVE, n8n workflow audit, accessibility/design, and DR/bus-factor/DPDP. Review only — no code or schema changed. All DB work was read-only against **dev** (`actqtzoxjilqnldnacqz`), which is the de-facto live system today.
> Method note: where an agent's static claim was load-bearing, it was verified against the running DB or git. Two earlier findings were **corrected** by that verification (noted below).

---

## ⚠️ Corrections to the first review (verified against live DB)

1. **`leads.expected_close_date` IS indexed.** `idx_leads_expected_close` exists — a partial btree on open-pipeline rows (excludes won/lost/disqualified/converted), which is exactly the set the Closing-This-Week/Month filters hit. The migration grep missed it (index name and column on different lines). **Retract** the "missing index" finding from the module review.
2. **The n8n event-bus router is NOT off-by-N.** A node-by-node mapping of all 36 Switch rules to their connection targets shows every rule wired correctly; rules 23–35 intentionally fall through to the global error handler as placeholders. **Retract** the "router mis-wires proposal.sent_to_customer" finding (it traces to a May-30 note that has since been fixed or was mis-stated). The real n8n issue is elsewhere — see §6.

Lesson reinforced: static review proposes, the running system disposes. The items below that say "verified" were checked live.

---

## 1. Live database — Supabase advisors (read-only, dev)

**Security advisors: 283 findings.**
- **18 ERROR — `security_definer_view`**: all 18 are the `v_digest_*` digest views (used by the morning n8n digests). They run with the definer's privileges, bypassing the querying role's RLS. For internal digest aggregates this is *probably* intended, but it should be a conscious decision — a digest view could expose rows a role shouldn't see if ever queried in-app. Action: confirm each is digest-only, or add `security_invoker=true` (as already done for `channel_partners_safe` in mig 161).
- **67 WARN — `function_search_path_mutable`**: the mig 141 `SET search_path` sweep covered 36 functions; **67 more still lack it**, including newer ones. The sweep was a point-in-time fix, not a standing rule — new SECURITY DEFINER functions keep landing without it. Action: one more sweep + a CI grep that fails on `SECURITY DEFINER` without `SET search_path` in any new migration.
- **76/83 WARN — anon/authenticated `security_definer_function_executable`**: a large surface of SECURITY DEFINER functions is EXECUTE-able by `anon`/`authenticated`. Many are triggers/internal helpers that don't need a direct GRANT to `anon`. Action: audit the list, `REVOKE EXECUTE ... FROM anon` on everything that isn't deliberately public.
- **4 WARN — `rls_policy_always_true`**: `notifications`, `system_logs`, `whatsapp_import_queue`, and an audit-log backup table have INSERT policies with `WITH CHECK (true)`. Mostly defensible (system-insert paths) but worth narrowing to a role check.
- **33 INFO — `rls_enabled_no_policy`**: all are **partition children** (inverter_readings_*, lead_activities_*, customer_message_log_*). RLS is defined on the parent and applies to partitions; this is advisor noise, not a real gap. No action.
- **1 WARN — leaked-password protection disabled** (Supabase Auth HIBP check off) and **1 — `extension_in_public`** (an extension installed in `public`). Both low; enable HIBP, move the extension to its own schema at leisure.

**Performance advisors: 1,248 findings.** Most are low-signal on a low-traffic dev DB, but two patterns are real and will bite at scale:
- **181 WARN — `auth_rls_initplan`**: RLS policies that call `auth.uid()`/`get_my_role()` **per-row** instead of once per query (`(SELECT auth.uid())`). At 10x this is the single biggest RLS performance tax. Worth a sweep to wrap the helper calls in scalar subqueries.
- **397 WARN — `multiple_permissive_policies`** + **7 duplicate indexes**: many tables have several permissive policies for the same role/action that Postgres must OR together on every query. Consolidating cuts planning + execution cost.
- **286 INFO — `unindexed_foreign_keys`** and **376 — `unused_index`**: partly contradictory and partly dev-traffic artifacts (an index looks "unused" if no query has run it here). Don't act on `unused_index` from dev stats. The unindexed FKs are worth scanning for the ones on hot join paths.

**Verdict:** no open-barn-door (no public table without RLS, no plaintext-secret column exposed to the client). The themes are *discipline drift* (search_path, anon GRANTs) and *RLS performance hygiene* (initplan, multiple policies) — both sweepable.

## 2. Data integrity (read-only, dev) — clean, with notes

Row counts: inverter_readings 9,133 · purchase_orders 2,043 · contacts 1,391 · leads 1,269 · customer_payments 1,148 · proposals 866 · projects 472 · stock_pieces **0**.

- ✅ **Zero FK orphans** (proposals→leads, projects→proposals). Referential integrity is intact — good sign for the cutover.
- ✅ **Zero null/negative customer_payment amounts.**
- **268 proposals `financials_invalidated`** (up from 165 in May) — the HubSpot-import financial-corruption flag keeps accruing; worth a decision on whether these get re-derived or written off before cutover.
- **22 duplicate active-phone leads** slip past the partial unique index — legacy rows whose statuses fall in the index's allowed set. Minor data-quality cleanup.
- **467 of 472 projects have no `company_id`** — expected (Phase-2 company backfill is pending), but it means the new "Customer — Project" column is mostly falling back to the denormalized name today.
- **stock_pieces is empty** — the inventory module is built but carries no live data yet, so its scalability findings are pre-emptive, not urgent.

## 3. PII encryption — VERIFIED plaintext, contradicts the master reference

Master reference §13 states `aadhar_number` and `bank_account_number` are "column-level encrypted via pgcrypto." **Live schema says otherwise:**

| Column | Tables | Actual type |
|---|---|---|
| `aadhar_number` | employees | **`text` (plaintext)** |
| `pan_number` | employees, channel_partners, vendors, lead_referrals | **`text` (plaintext)** |
| `bank_account_number` | employees, channel_partners, vendors | **`text` (plaintext)** |
| `password_encrypted` | plant_monitoring_credentials | `bytea` (pgcrypto — the only thing actually encrypted) |

Today the live exposure is theoretical — **0 employees have aadhaar populated** — and the fields are RLS-gated + masked in views (mig 161/167). But the doc is wrong, and the encryption needs to exist *before* HR onboarding starts entering aadhaar/bank data. Action: either encrypt these columns with the mig-158 pgcrypto pattern, or correct §13 to say "RLS + view-masking, not encryption" — don't leave the claim false.

---

## 4. Static security audit (code)

API auth posture is **sound**: all 24 `/api/*` routes are gated (11 webhook-secret cron endpoints, 13 user-auth). `/p/[token]` uses 64-hex (256-bit) tokens with server-side expiry; vendor portal validates tokens via admin client and exposes no pricing/customer PII. `.or()` injection is **down to 2 sites** (views-actions.ts:17, voice-report route:282) — both interpolate UUIDs only, and RLS still applies, so low risk. Edge functions both check the service-role bearer (process-document confirmed fixed).

Real items:
- **CRITICAL — git history still contains the leaked plant credentials.** Commit 88a275f scrubbed the working tree (GitGuardian, June 6) but history was **not** rewritten — `git show a573304:scripts/count-plant-credentials.ts` still yields ~186 plaintext customer portal passwords. Until history is purged (`git filter-repo`) **and** the credentials rotated, the leak is live. This is the #1 security action in the whole review.
- **HIGH — Sentry has no PII scrubbing.** No `beforeSend`, no `sendDefaultPii:false`, no sensitive-field redaction in `sentry.{client,server}.config.ts`. Code is defensively careful not to log salary/IDs, but one stray `throw new Error(\`...${pan_number}...\`)` would ship PII to Sentry. Add a `beforeSend` redactor keyed on the sensitive-field list.
- **MEDIUM — customer PII routinely emitted to n8n.** `emitErpEvent('customer.monthly_performance_generated', …)` ships customer_name + customer_phone to the n8n webhook (outside RLS). Fire-and-forget and no salary/bank/ID fields, but the approved-PII-per-event contract should be documented on `ErpEventName`.

## 5. Test quality — `pnpm test` is RED in a clean checkout

Running the suite clean: **Test Files 4 failed | 28 passed; Tests 3 failed | 350 passed.** Before `pnpm test` joins CI, these must be fixed or "green" will be a lie:
1. `proposal-share-actions.test.ts` (2 fail) — all tests reuse the same 64-char token; the new in-process rate limiter (5/min) trips by test 8. And the rate limiter itself has no test.
2. `proposal-send-actions.test.ts` (1 fail) — expects a PDF error but short-circuits on missing `N8N_WEBHOOK_SECRET`; passes only on a machine with `.env.local`.
3. `data-review-helpers.test.ts` — a live-DB integration test (`createClient` from env) that can't load in CI; 3 of 6 assertions are truthiness-grade.
4. `handover-actions.test.ts` — 6 tests that have **never loaded** (vite can't transform the `.tsx` PDF import under `jsx:preserve`).
5. `scripts/` has **no package.json** — its ~34 tests (excel parser, migration utils, credential import) are orphaned and Turbo never runs them.

What's genuinely strong: budgetary-quote (18 tests, now on real price_book vocabulary — would catch the ₹0 bug), the six inverter adapters (real API shapes, unit/timezone math, error-path asserts), einvoice-builder (exact GST splits), report-actions (pins the employee-id≠profile-id FK fix). The money math that lives in SQL RPCs (receivables, profitability) has **zero** coverage — only the JS wrappers are tested. Top missing tests: SQL RPC integration (seeded-DB/pgTAP), the accept-portal rate limiter, completion-%→payment-gate flow, and PDF money rendering vs `calcProposalTotals`.

Hygiene flag: `fimer.test.ts` fixtures appear to embed a **real Aurora Vision API key + password** — scrub to dummy values.

## 6. n8n workflows — router is fine, idempotency is not

Router verified correct (see correction #2). The real findings:
- **CRITICAL — `executeOnce` missing on ~26 Send WhatsApp nodes** across the event-driven workflows (01–18, 29–31, 40–47). The May-20 flood fix only touched the cron digests (19–28). On any retry, event workflows re-send — the exact failure mode that flooded Meta and tripped the silent anti-spam throttle. This should be fixed before those workflows are activated.
- **All 58 workflows are `active:false`** in the repo — matches the documented canary posture, but means a naive push activates nothing; activation is a manual n8n-UI step to remember.
- **6 app-emitted events have no router case** (lead.scored, lead.routed, plant.anomaly_detected, qc.photo_finding_created, vendor.bill_ai_extracted, customer.monthly_performance_generated) — currently silent drops. Either add cases or document them as audit-only. `lead.stale_24h` is the inverse (router case, no emitter — cron-driven, harmless dead branch).
- Timezone missing on 30, 40–47, 62, 65; error-workflow unset on 11 (mostly customer-tier). Minor.
- ✅ No hardcoded secrets in any workflow JSON (all `{{ $env.* }}` / `REPLACE_WITH_*` placeholders).

## 7. Dependencies / supply chain — one real exposure, one EOL clock

`pnpm audit --prod`: **44 vulns (20 high / 21 moderate / 3 low).**
- **HIGHEST CONCRETE RISK — `xlsx` 0.18.5 from the npm registry**, which is permanently unpatched (prototype-pollution CVE-2023-30533 + ReDoS CVE-2024-22363; fixes only on the SheetJS CDN ≥0.20.2). It is **not** script-only — `apps/erp/src/lib/excel-quote-parser.ts` parses **vendor-uploaded Excel files** in production (the procurement quote-upload path), which is exactly the attack vector. It's also a phantom dep (declared only at root). Migrate that path to `exceljs` (already a dep) or pin the SheetJS CDN tarball.
- **Next 14.2.29 → bump to 14.2.35 this week** — closes high-sev SSRF + middleware-bypass within the 14.x line; one-line change.
- **Next 14 → 15 within ~a month** — ~13 advisories have no 14.x backport (14.x effectively EOL for security). Upgrade is unusually cheap here: React 19 is already in place and the one documented config rename (`serverComponentsExternalPackages`) is the only flagged change.
- Smaller: `@anthropic-ai/sdk` 0.82→≥0.91.1 (advisory), Supabase js/ssr bumps, Sentry 10.46→10.57, consider pnpm 10 (blocks postinstall scripts by default). `.npmrc` is clean (integrity on).

## 8. Accessibility / design consistency

Solid foundation (Radix dialogs/menus throughout, comprehensive design tokens, reduced-motion respected, lead-status + cash-position badges all pair color *with text* — no color-only signalling). Real items, pragmatic for an internal tool:
- **~25 icon-only buttons** (row Save/Cancel/Trash, password eye, pagination) lack `aria-label`/`title`. Cheap, high-value.
- **~52 hand-rolled `<table>`s** without `<thead>/<th scope>` (BOM picker, QC/commissioning checklists, PO line items, cut-length) — screen-reader navigation suffers; the searchable ones should use the DataTable component anyway.
- **~100 hand-formatted money/date sites** (`.toLocaleString`, `.toFixed`) bypass the shared `formatINR`/`formatDate` — a real IST/precision-drift risk; add an ESLint rule once consolidated.
- **~813 arbitrary hex Tailwind values** (`text-[#1A1D24]` etc.) where tokens exist — concentrated in older stepper/procurement pages; codemod the top 20 recurring values.
- The custom date-range filter popover isn't keyboard-navigable (arrow keys/Enter) — wrap in Radix Popover.

Modern pages (`/leads`, `/design`, `/sales`) are clean; drift is isolated to older modules.

## 9. DR / bus factor / DPDP

**Disaster recovery (the genuinely scary part of this whole review):**
- **CRITICAL — circular backup dependency.** The only automated backup is the n8n SQLite tar, and it's uploaded to a bucket on **the same dev Supabase project** it's meant to protect. If that project is lost, so is its backup. The ERP *database* relies solely on Supabase's own 7-day PITR.
- **CRITICAL — no restore drill has ever been run.** A backup never test-restored is a hypothesis, not a backup.
- **HIGH — dev IS production, with no rollback before cutover.** A bad migration applied to dev (the standing "dev-first" rule) hits live users, and the "rollback = don't flip the app" safety only exists *post*-cutover. Until prod exists, a destructive migration's only recovery is PITR-within-7-days.
- **CRITICAL — bus factor of one.** Supabase dashboard, the n8n droplet SSH + `N8N_ENCRYPTION_KEY` (lose it = all n8n credentials unreadable), Meta/WhatsApp business, Google Workspace OAuth, `.env.local` — all Vivek-only, no documented escrow or "if Vivek is unavailable" procedure.

**DPDP Act 2023 (pragmatic):**
- PII encryption gap (§3) — the headline.
- No consent capture for customer phone/marketing (privacy page says "reply STOP" but there's no opt-out table or consent timestamp on leads); no employee data-collection notice.
- No automated retention/erasure: the privacy page promises 24-month lead deletion and a deletion-request path, but no cron and no erasure endpoint implement them. Storage files (site photos w/ GPS EXIF) are never deleted even when the DB row is soft-deleted.
- AI prompts do include `customer_name` (`report-ai-actions.ts:80`) — fine if names are treated as non-sensitive context, but it should be a stated, tested guarantee that phone/email/IDs never enter prompts or embeddings (proposals contain PII and get embedded for RAG).

---

## Consolidated priority list (this pass)

**Do now (security/data, low effort, high consequence):**
1. **Purge git history of the leaked plant credentials + rotate them** (§4) — the one unambiguous open vulnerability.
2. **Fix `xlsx` on the vendor-upload path** (§7) — untrusted-file parser with unpatchable CVEs in production.
3. **Bump Next to 14.2.35** (§7) — one line, closes high-sev SSRF/middleware.
4. **Add Sentry `beforeSend` PII redaction** (§4).

**Do before the prod cutover:**
5. **Move backups off the protected project + run one restore drill** (§9) — the cutover spec gates on row-count parity but assumes a restore works; prove it.
6. **Encrypt aadhaar/PAN/bank columns (or correct §13)** before HR onboarding populates them (§3).
7. **Document a bus-factor escrow** for the encryption key + dashboard/OAuth access (§9).
8. **Decide the fate of the 268 invalidated proposals** (§2).

**Do before `pnpm test` joins CI:**
9. **Fix the 4 failing/unloadable suites + adopt `scripts/` tests** (§5), then turn on the CI step (from the first review).
10. **Add `executeOnce` to the event-workflow WhatsApp nodes** before activating them (§6).

**Sweeps (schedule, mechanical):**
11. RLS performance: `auth_rls_initplan` ((SELECT auth.uid()) wrap) + consolidate multiple-permissive-policies (§1).
12. SECURITY DEFINER hygiene: finish the `SET search_path` sweep (67 left) + `REVOKE EXECUTE FROM anon` audit + a CI grep to keep it from regressing (§1).
13. A11y: aria-labels on icon buttons, `<thead>/<th scope>` on the top tables, formatter consolidation + ESLint rule (§8).
14. DPDP: consent capture + retention cron + erasure endpoint + AI-prompt PII test (§9).

Note: this pass **removed** two items from the first review (the expected_close_date index and the n8n router off-by-N) after live verification. Net, the system is in better shape than the static reviews implied on those two points — but the git-history credential leak and the DR posture are more serious than static code review alone would have surfaced.
