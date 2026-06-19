# Shiroi ERP — Changelog

> Append-only. One line per shipped milestone. The source of truth for "when did we ship X / which migration was X in."
> Verbose daily-log footers and the old CLAUDE.md CURRENT STATE table were compressed into this file on April 17, 2026 as part of the docs restructure. Full prior content preserved in `docs/archive/CLAUDE_MD_2026-04-17_ARCHIVED.md` and `docs/archive/SHIROI_MASTER_REFERENCE_3_0_ARCHIVED.md`.
> **2026-06-19 lean-reset:** entries had re-bloated into multi-paragraph write-ups (~1,650 chars each); compressed back to one line apiece. Full pre-reset verbose prose is preserved in `docs/archive/CHANGELOG_VERBOSE_2026-H1_ARCHIVED.md`.

Format: `[YYYY-MM-DD] <headline> → <migration(s) if any> · <spec if any> · <module if any>`

---

## June 2026

- **[2026-06-19]** style(ui/tables): universal 14px-body + text-wrap table standard — set once in the `@repo/ui` `Table` primitive + `DataTable`, then swept ~30 hand-rolled display tables (tasks, execution, service tickets, O&M, project steps, finance/procurement, misc); numbers/dates/status/actions stay single-line; editor grids, forms & badges untouched. → no migration · spec `2026-06-19-table-typography-wrap-standard-design.md` · modules: cross-cutting / design system
- **[2026-06-19]** docs: lean-reset of the bloated index files — CHANGELOG 320→40 KB (verbose multi-paragraph entries → one line each; full prose archived) + CURRENT_STATUS 110→7 KB, plus an advisory CI entry-length guardrail. → no migration · spec `2026-06-19-docs-lean-reset-design.md` · docs
- **[2026-06-19]** fix(hr): `getEmployeeCompensation` self-view restored — the role gate's `isSelf` compared `profiles.id` to `employees.id` (never matched → dead branch); now resolves the caller's `employees.id` via `getCurrentEmployeeId()`, so an employee can view their OWN compensation (founder/hr_manager unchanged). → no migration · module: hr
- **[2026-06-19]** perf+security(auth): [G1] request-scoped session cache — one validated `auth.getUser()` per render instead of 2–3; `getAuthUser`/`getSessionContext` split. → no migration · review `2026-06-19-page-load-perf-audit.md` [G1] · modules: cross-cutting
- **[2026-06-19]** feat(inverters): Deye Cloud OpenAPI adapter (replaces the unpaid SolarMan path). → no migration · module: om (inverter monitoring)
- **[2026-06-19]** refactor(labels): centralized 6 duplicated label/option maps into `lib/label-constants.ts` (Vivek's redundancy-sweep decisions). → no migration · modules: cross-cutting (leads, proposals, projects, hr, om, purchase)
- **[2026-06-19]** docs+rules: red-flag pass before executing the page-load perf audit + redundancy sweep — added NEVER-DO #22–25 + master-ref §4.17–4.19 and corrected the audit's unsafe "delete dead `leads/`" advice. → no migration · reviews `2026-06-19-page-load-perf-audit.md` + `2026-06-18-erp-redundancy-sweep.md` · modules: cross-cutting
- **[2026-06-18]** style+refactor(theme/money): colour-shift 384 more hexes to warm tokens (`2c42617`) + PDF amounts whole-rupee (`ff48bfe`). → no migration · review `2026-06-18-ui-theming-audit.md` · modules: cross-cutting + design system
- **[2026-06-18]** style+refactor(theme/money): tokenized 336 exact-match hexes (commit `5ff3bf0`) + `formatINR` is now whole-rupees with a precise `formatRate` for unit prices. → no migration · review `2026-06-18-ui-theming-audit.md` · modules: cross-cutting + design system
- **[2026-06-18]** refactor+fix(tasks): collapsed the 3 duplicate task-write actions into thin wrappers over the universal `tasks-actions.ts` pair — closing the dropped-`completed_by` bug (no migration). → no migration · review `2026-06-18-erp-redundancy-sweep.md` §3 · modules: projects, sales
- **[2026-06-18]** chore(schema+code): redundancy-sweep follow-through — mig 189 drops 17 more indexes on dev; 3 safe code dedups; UI-theming audit answered. → mig 189 (dev) · review `2026-06-18-ui-theming-audit.md` · modules: cross-cutting + design system
- **[2026-06-18]** chore(schema+code): ERP-wide redundancy sweep — mig 188 drops 25 exact-duplicate/shadowed indexes on dev; code/UI duplication audited + flagged. → mig 188 (dev) · spec `2026-06-18-erp-redundancy-sweep-design.md` · review `2026-06-18-erp-redundancy-sweep.md` · modules: cross-cutting (projects, finance, sales, hr, purchase, om)
- **[2026-06-18]** fix(projects): THE real root cause of "task added to a project never shows on the Execution page" (persisted across 3–4 rounds) — a stale PostgREST FK hint, not the write path or the milestone reorder (no migration). → no migration · module: projects (also finance/payment-followups)
- **[2026-06-18]** design: "Solar Gold" rebrand — the brand hue moves from eco-green `#00B050` to solar gold `#E08A00`, and green becomes a status-only signal (no migration, no schema change). → no migration · design system / all modules
- **[2026-06-18]** perf: diagnosed "projects & leads tables + search got slow" → it's a CPU-starved dev instance, not query structure; shipped the free-path wins (mig 187 dev + leads-page parallelization). → mig 187 (dev) · review `2026-06-18-projects-leads-search-perf.md` · modules: projects, sales
- **[2026-06-18]** ux(tasks/activities/service-tickets): table search now filters live as you type, matching /projects (no migration). → no migration · modules: projects (tasks/activities), om
- **[2026-06-18]** fix(projects): the Execution tab hid every task for any project with no seeded milestones — tasks now render first, always (no migration). → no migration · module: projects
- **[2026-06-18]** om: Plant Monitoring credential book backfilled from historical-import staging (mig 186, dev only) — 5 → 33 credentials. → mig 186 (dev) · module: om
- **[2026-06-18]** ux(projects): the `/projects` row link is now "Customer — Project", not the project code (no migration). → no migration · module: projects
- **[2026-06-16]** Manivel feedback batch 3 (migs 182–185, dev only): projects-list dashboard, free-text projects, price-book fix, service-ticket polish, BOQ PDF. → migs 182/183/184/185 (dev) · spec `2026-06-16-manivel-feedback-batch3-design.md` · plan `2026-06-16-manivel-feedback-batch3.md` · modules: projects, om, purchase
- **[2026-06-16 overnight]** Manivel sheet → ERP reconciliation + Command Center dashboard (migs 180–181, dev only). → migs 180/181 (dev) · spec `2026-06-15-manivel-dashboard-parity-design.md` · review `2026-06-16-overnight-reconciliation-build.md` · modules: projects, finance
- **[2026-06-15]** ux: lead close date auto-managed by status (mig 179, dev only). → mig 179 (dev) · sales module
- **[2026-06-15]** ux: "Customer — Project" is the default customer column, and existing saved views were backfilled (mig 178, dev only). → mig 178 (dev) · sales module
- **[2026-06-13]** data(finance): back-filled 12 customer payments (₹28,90,336) from Vivek's "Payment followup" sheet into dev (no migration · no schema change). → no migration · module finance
- **[2026-06-11/12 overnight]** Project feedback batch 2 (mig 177, dev only). → mig 177 (dev) · spec `2026-06-11-project-feedback-batch2-design.md` · plan `2026-06-11-project-feedback-batch2.md` · projects/om/purchase modules
- **[2026-06-11]** fix: PostgREST `.or()` search crash (Sentry: "failed to parse logic tree" on /projects when the search term contains a comma, e.g. "bhuv, a"). → no migration · projects/purchase/finance modules
- **[2026-06-11]** tests: vitest fully green again (35 files / 408 tests) — the 4 failures flagged on 06-11 closed. → no migration · sales/projects modules
- **[2026-06-11]** Project module enhancements batch (migs 173–176, dev only). → migs 173/174/175/176 (dev) · spec `2026-06-10-project-module-enhancements-design.md` · plan `2026-06-10-project-module-enhancements.md` · projects module
- **[2026-06-10]** security: review Batch 0 — 4 hardening fixes (commits 441181a/918f8cc/b9ace29/ddf1671). → no migration · plan `2026-06-10-review-implementation.md`
- **[2026-06-10]** docs: review-implementation plan for the two June-10 review docs (PR #6). → no migration · plan `2026-06-10-review-implementation.md`
- **[2026-06-10]** om: inverter-poll edge fn hardened — per-fetch 10s timeout (`fetchWithTimeout` wraps every Growatt/Sungrow/FIMER call) + 30s wall-clock budget that defers leftover inverters to the next cycle, so the function always returns under the n8n node timeout (was intermittently spiking 48–70s and failing the cron). → no migration · module om
- **[2026-06-09]** docs: dev→prod full-data migration design spec + cutover runbook (planning only — we are NOT migrating; no code, no migration). → no migration · spec `2026-06-09-dev-to-prod-migration-design.md`
- **[2026-06-09]** Customer + Project name on leads & projects: link a lead/project to a company (e.g. Lancor Holdings) + a project name; lists show "Customer — Project" by default (mig 172). → mig 172 · spec `2026-06-09-leads-projects-customer-project-name-design.md` · modules: sales, projects
- **[2026-06-09]** fix(projects): daily site reports were uninsertable from the web — "Manivel can't add daily reports" (no migration · 8 files + test). → no migration · `auth.ts` + `report-actions.ts` + `correction-actions.ts` + report/correction forms + 3 report pages + `report-actions.test.ts` · module: projects
- **[2026-06-09]** inverter telemetry: clamp implausible vendor `recorded_at` so a frozen datalogger clock can't break the partitioned insert (no migration · edge fn deploy to dev). → no migration · edge fn deploy + `base.ts`/`base.test.ts`/`inverter-poll/index.ts` · module: om

- **[2026-06-08]** leads referrer filter → 3 buckets + dd/mm/yyyy calendar date picker that fixes the "June shows July" leak (mig 171). → mig 171 · spec `2026-06-08-leads-filters-and-date-picker-design.md` · plan `2026-06-08-leads-filters-and-date-picker.md` · module: sales

- **[2026-06-08]** morning-digest fan-in throw fix: #19 (Vivek 7AM) + #20 (sales-head 8AM) serialized (no migration). → no migration · n8n workflow patch (#19, #20) · module: sales

- **[2026-06-08]** Team Tasks date/type fixes + Won-without-proposal now spawns a project for Manivel + morning action block (migs 168, 169, 170). → migrations 168, 169, 170 · spec `2026-06-08-team-tasks-won-handoff-morning-digest-design.md` · plan `2026-06-08-team-tasks-won-handoff-morning-digest.md` · modules: sales, projects, om

- **[2026-06-08]** edit a lead's name from the detail page (no migration). → no migration · module: sales

- **[2026-06-08]** ABB/FIMER fleet cut to Edison School only + Edison secret set via Management-API PAT (no migration). → no migration · module: om · `scripts/set-fimer-edge-secrets.ts`

- **[2026-06-07]** renamed the lead referrer "VIP" label to "MGMT REF". → no migration · module: sales

- **[2026-06-07]** inverter-poll: n8n HTTP timeout 55s → 120s (false-error fix, no migration). → no migration · n8n workflow patch · module: om

- **[2026-06-06]** SECURITY: scrubbed exposed plant-monitoring credentials from the repo (GitGuardian alerts). → no migration · module: om

- **[2026-06-06]** smaller follow-ups round: 15a v3 + C1 v2 (55 fns) + C3 v2 (30 inline auth blocks) + orphan delete. → no migration · 2 new sub-files + 1 deletion + 33 modifications

- **[2026-06-06]** inverter polling outage fixed: n8n cron firing-into-nothing + Edge Function deploy drift (no migration). → no migration · edge fn v8+v9 deploy + n8n workflow patch · module: om

- **[2026-06-06]** UI wiring batch: items 16, 17a, 20 — 7 components + 14 actions wired (or deleted) across 6 thematic commits. → no migration · 11 new files + 6 deletions + 19 modifications

- **[2026-06-06]** overnight cleanup Phase 2: 15a split + C1 ActionResult + C3 requireAuthUser + C4 formatDate + D-security + 62 critical tests. → no new migration · 5 new sub-files + 1 barrel + 1 helper + 6 test files

- **[2026-06-06]** Historical plants import + plant-credentials encryption (migs 158, 159, 160). → migrations 158, 159, 160 · spec `2026-06-05-historical-plants-import-design.md` · module: om

- **[2026-06-06]** overnight cleanup Phase 1: 5 time-series partitions + S13 bank-field view + C8/C10/C5/C6 + S11/S12/S21 + 2 critical test files (migs 159-164). → migrations 159, 160, 161, 162, 163, 164

- **[2026-06-05]** FIMER / ABB Aurora Vision integration LIVE: 14 inverters across 14 plants polling on dev (real telemetry confirmed). → no migration · module: om · adapter `fimer.ts`

- **[2026-06-05]** Sungrow follow-on: n8n cron + Edge Function auth fixes, daylight-only schedule. → no migration · edge fn v6 deploy + n8n workflow patch + docs

- **[2026-06-05]** Sungrow integration LIVE: 17 inverters across 14 plants polling on dev (migs 156 + 157). → migrations 156, 157 · module: om · edge fn deploy

- **[2026-06-04]** item 2b: 11 typed search RPCs replace 16 PostgREST `.or()` interpolations across 12 files (migs 152-155). → migrations 152, 153, 154, 155

- **[2026-06-03]** onboarded Shravan Tomar (Design Head). → no migration · 1 new script

## May 2026

- **[2026-05-31]** re-dispatch: items 12a + 21a — Batch A silent-fails recovered. → no migration · 4 file edits

- **[2026-05-31]** fix(security): item 2a — sanitize PostgREST .or() filter inputs across 12 files (16 sites). → no migration · helper + tests + 12 file edits

- **[2026-05-31]** review decisions Batch A: 6 of 8 items applied via 8-parallel-agent workflow (migs 146-150) + edge-fn deploy. → migrations 146, 147, 148, 149, 150 + edge fn deploy

- **[2026-05-31]** fix(po): align `updatePoLineItemRate` with the includes-GST convention + enforce via CHECK constraint (mig 151). → migration 151 · module: procurement

- **[2026-05-30]** review decisions: 9 of 22 judgment-call items applied via 8-parallel-agent workflow (migs 141–145). → migrations 141, 142, 143, 144, 145

- **[2026-05-30]** overnight session: comprehensive multi-agent code review (5 dimensions) + 6 safe fixes + 3 H-phase plans + role-specific training data + 2 quick wins (mig 140). → migration 140 · `docs/reviews/2026-05-30-overnight-comprehensive-review.md` + 6 section files + 3 plan files + 4 training scripts + 2 training markdown handouts

- **[2026-05-25]** fix(whatsapp-import): close the `case 'lead'` gap from 2026-05-24's review-pass batch 3. → no migration · module: sales

- **[2026-05-25]** n8n: 4 distinct runtime bugs in the new digest workflows — fixed. → no migration

- **[2026-05-25]** feat(ai): H3 Wave 2-4 COMPLETE — 5 finisher agents land cron + UI for S11, S12, S13, S15, S17 (no new migration). → no migration (138 + 139 already cover all schema) · all of Wave 2-4

- **[2026-05-24]** feat(ai): H3 Wave 2-4 partial — 3 features core-complete + 5 features partial (mig 139 foundation already shipped). → no migration (139 from Wave 2-4 foundation already shipped) · partial of Wave 2-4

- **[2026-05-25]** feat(ai): H3 Wave 1 — 5 features shipped on top of the RAG + provider foundation. → no new migration (138 from foundation) · all of Wave 1

- **[2026-05-25]** plans: revised H3 AI roadmap (rev 2) + Shiroi RAG design spec. → no migration · docs/superpowers/plans/2026-05-25-ai-roadmap-plan.md + docs/superpowers/specs/2026-05-25-shiroi-rag-design.md

- **[2026-05-25]** plans: 3 detailed implementation specs for next-phase AI work. → no migration · 3 plan files

- **[2026-05-24]** fix: review-pass batch 3 — close 7 of 8 latent bugs + run 3 stalled-backlog audits (migration 137). → migration 137 · `docs/reviews/2026-05-24-plan-vs-build.md`

- **[2026-05-24]** review: plan-vs-build audit across all 11 modules + master plan B/C/E/F. → no migration · docs/reviews/2026-05-24-plan-vs-build.md

- **[2026-05-24]** docs: formalise the 2026-05-24 learnings as project rules. → no migration · master ref §4.13–4.15

- **[2026-05-24]** fix(build): unblock Vercel — extract client-shared constants out of `-queries.ts` files + add `pnpm build` to CI. → no migration

- **[2026-05-24]** feat(infra): PVLib microservice live at https://pvlib.shiroienergy.com (E15 complete). → no migration · module infrastructure

- **[2026-05-24]** fix: review pass batch 2 — clean up the remaining "important + nice-to-have" items so the recent shipped features actually feel finished (migration 136). → migration 136 · all module docs

- **[2026-05-24]** fix: act on the comprehensive review — 15 critical defects patched, CI back to green (migrations 134 + 135). → migrations 134–135 · spec docs/reviews/2026-05-24-comprehensive-review.md

- **[2026-05-24]** review: comprehensive code review of Phase B/C/E/F + Phase 7/8 (six parallel agent passes + local CI). → no migration

- **[2026-05-24]** docs: Meta Business Verification complete + messaging tier at 2,000 msgs/24h. → no migration

- **[2026-05-24]** feat(scale): Phase F shipped — F1 WhatsApp drip sequences, F3 GST e-invoice framework, F4 referral payouts, F6 salary benchmarking, F7 customer proposal portal, F8 OpenRouter AI provider (F2/F5 deferred). → migrations 129–134 · modules: sales, finance, hr, om

- **[2026-05-24]** feat(purchase): C1 gap fixes — material requisitions + vendor bill panel + PO reconciliation (migration 123). → migration 123 · module purchase

- **[2026-05-24]** feat(intelligence): Phase E — E6–E15 AI/automation layer (migrations 125–128). → migrations 125–128 · modules om/documents/finance

- **[2026-05-24]** feat(projects/ops): C8–C12 — cut-length tracking + completion % + documents upload + handover pack PDF + DC certificates (migrations 121–122). → migrations 121–122 · modules projects/inventory/om

- **[2026-05-24]** fix(inverter-poll): inline pure-TS MD5 — Deno crypto.subtle does not support MD5 (no migration). → no migration · module om (plant monitoring)

- **[2026-05-24]** fix(inverters): Phase 7 code-review fixes — string_count field + credentials wiring (no migration). → no migration · module om

- **[2026-05-24]** feat(inverter-poll): Phase 8 — Edge Function real adapter dispatch + n8n cron (no migration). → no migration · module om (plant monitoring)

- **[2026-05-24] — fix(sidebar): add missing `Handshake` icon to ICON_MAP.** `roles.ts` references `icon: 'Handshake'` for the Partners nav item, but `sidebar.tsx` did not import it or register it in `ICON_MAP`, so the link rendered without an icon. Added `Handshake` to the lucide-react import and the ICON_MAP record. CI green (check-types + lint + forbidden-patterns). → no migration · module ui

- **[2026-05-24]** feat(hr): C5+C6+C7 — full leave management + employee profiles + attendance tracking (migration 120). → migration 120 · module hr

- **[2026-05-24]** feat(om): Phase 7 — /om/inverters management UI (no migration). → no migration · module om

- **[2026-05-24]** feat(adapters): Phase 6 — SolarMan/Deye + Goodwe SEMS adapter stubs (no migration). → no migration · module om (plant monitoring)

- **[2026-05-24]** feat(finance): Phase C-finance — invoice raising, payment recording, receivables reconciliation (mig 118). → migration 118 · module finance

- **[2026-05-24]** feat(marketing): Phase B complete — payment tracker follow-ups + BOM categories + quote PDFs + detailed quote flow (mig 117). → migration 117 · module payments/sales

- **[2026-05-24]** feat(sungrow): Phase 5 — OAuth2 callback + RSA helper + real adapter (no migration). → no migration · module om

- **[2026-05-23]** fix(ux): views dropdown no longer clipped by overflow container. → no migration · module all (data-table shared component)

- **[2026-05-23]** Liaison TNEB redesign (mig 115). → migration 115 · spec `2026-05-23-liaison-tneb-redesign-design.md` · module liaison

- **[2026-05-21]** n8n: morning digest redesign — coordinator-led model. → migration 114 · spec `2026-05-21-morning-digest-redesign-design.md` · plan `2026-05-21-morning-digest-redesign.md`

- **[2026-05-20]** Marketing feedback round 2 shipped (5 streams + mig 113). → migration 113

- **[2026-05-21]** n8n setup completion: Workspace OAuth (non-expiring tokens), Sentry path skipped, audit cleanup. → no migration

- **[2026-05-20]** Fix Generate PDF crash on Vercel — patched `@react-pdf/reconciler@2.0.0` to recognise React 19 production element symbol.

- **[2026-05-20]** PDF route instrumentation + Send Proposal feature (mig 112). → migration 112

- **[2026-05-20]** Quick Quote BOM generator: fixed a 3-layer vocabulary/filter/sizing bug that produced ₹0 quotes since day one (a 150 kWp industrial now clears ₹40L); tests rewritten on realistic price-book mocks. → no migration · module: sales

- **[2026-05-20]** Org-wide proposal-gate toggle (mig 111) — scope-correction follow-up to mig 109. → migration 111

- **[2026-05-20]** n8n: the REAL cause of "morning crons not firing" — Meta silent throttle from per-item flood. → no migration

- **[2026-05-20]** Proposal PDF revamp: replaced the May-19 placeholders with Shiroi's real 3-year customer-facing format (14-row Technical Specification, V2 brand tokens, LLP name on cover). → spec: `2026-05-20-proposal-format-revamp-design.md` · module: sales

- **[2026-05-20]** Marketing hotfix: lead_activities RLS for marketing_manager + Quick Quote modal close + activity_type alignment. → migration 110

- **[2026-05-19]** Marketing feedback batch shipped (10 issues, 1 migration). → migration 109

- **[2026-05-19]** n8n: DigitalOcean restored ports 80/443; public router reachable; legacy bug-report webhook retired. → no migration

- **[2026-05-19]** n8n: cron timezone — the REAL fix this time. → no migration

- **[2026-05-18]** n8n: 2-week debug after digests + error emails went silent — three stacked root causes found and fixed. → no migration

- **[2026-05-04]** n8n: digests failed at 12:30/13:30/14:30 IST today; two more bugs caught. → no migration

- **[2026-05-03]** Both specs from 2026-05-02 implemented overnight: tasks (mig 108) + documents (mig 109, phase 1 + phase 2 scaffold). → migrations 108, 109 · specs: 2026-05-02-tasks-followups-team-view, 2026-05-02-documents-drive-lifecycle

- **[2026-05-03]** n8n: two bugs caught after morning digests went silent. → no migration

- **[2026-05-02]** Sort by system size unblocked + two specs filed (tasks auto-create from follow-ups, documents/Drive lifecycle). → migrations 108, 109 (pending) · specs filed

- **[2026-05-02]** n8n: retired workflow `#57` in favour of a host-side backup cron (n8n's `executeCommand` node removal blocked the original); discovered PROD Supabase is paused. → no migration

- **[2026-05-02]** n8n Phase 5: ALL 47 WhatsApp Send nodes flipped to Meta `erp_alert` template mode; 32 of 34 workflows now active (full digest tier unlocked). → no migration

- **[2026-05-02]** n8n: corrected Vinodh's number + added Sridhar (Chairman) as report recipient + Meta billing fix unblocked actual delivery. → no migration

- **[2026-05-02]** Project Data Review Triage UI shipped — `/data-review/projects` for cleaning 46 HubSpot-imported projects with `financials_invalidated` / `system_size_uncertain` flags. → migration 102 (already shipped in orphan-triage hotfix)

- **[2026-05-02]** Quick Quote unblocked + Won transition gated on proposal existence. → migrations 106, 107

- **[2026-05-02]** CI cleanup on yesterday's PM/zoho cascade fix (`a4de50e`). → no migration

- **[2026-05-02]** Workflow rule update: explicit "CI locally → docs → push to remote" sequence. → no migration

- **[2026-05-02]** Purchase v2 unblocking — Send PO to vendor + Add Vendor master + Copy-link removal. → migration 103

- **[2026-05-02]** PM cascade hardening + Zoho sync-queue RLS unblocking — a won lead now reliably auto-creates Manivel's project. → migrations 104, 105 · module: projects

- **[2026-05-02]** Hotfix: orphan banner crashed `/cash` + extend triage access to project_manager (Manivel). → migration 102

- **[2026-05-02]** HubSpot incremental import (May 2 export) + Payments-pipeline cross-check. → no migration

- **[2026-05-02]** CI fix on orphan triage merge: extract inline Supabase from `/cash/orphan-invoices/`. → no migration

- **[2026-05-02]** Zoho Orphan Triage UI shipped — `/cash/orphan-invoices` for 303 orphan invoices (~₹63 Cr) and 659 orphan payments. → migrations 096, 097, 098, 099, 100, 101


- **[2026-05-02]** n8n: two latent runtime bugs found and fixed (env-var blocking + cron timezone). → no migration

- **[2026-05-02]** n8n: Gmail OAuth completed via SSH-tunnel workaround, #55 Global Error Handler activated. → no migration

- **[2026-05-02]** n8n Phase 4: fixed 5 silently-broken simulated workflows + role-routing per Vivek's instructions. → no migration

- **[2026-05-02]** Tasks "Client" column + leads.map_link + Expected Orders/Payments dashboard cards. → migration 094

- **[2026-05-02]** n8n: redesigned #56 droplet health → daily heartbeat (replaces executeCommand which n8n removed for security in current version). → no migration

- **[2026-05-01]** n8n WhatsApp deployment: Phase 3 LIVE — 19 workflows active, end-to-end tested, Vinodh co-founder fan-out added. → no migration

- **[2026-05-01]** Lead status fix + Payments Tracker tab. → migration 088

- **[2026-05-02]** Phase 3 — HubSpot re-import + Tier B caveated recoveries + PV333 PDF retry; dev final 752 proposals / 199 banner-flagged / 0 over the ₹10L/kWp ceiling. → migrations 092, 093, 095
- **[2026-05-02]** Fix: proposal financial corruption merged to main — Phases 1+2 shipped. → migrations 089–091, 090b
- **[2026-05-01]** Fix: pdf-parse v2 import in Tier B re-extract scripts.
## April 2026

- **[2026-04-30]** Fix: proposal financial corruption — Tier B AI re-extraction + UI banner. → migration 090b · plan: `2026-04-30-proposal-corruption-implementation.md` · design: `2026-04-26-proposal-financial-corruption-recovery.md`
- **[2026-04-30]** Fix: 130 proposals corrupted with implausible BOM totals — Tier A reset + CHECK constraint. → migrations 089–091

- **[2026-04-26]** Fix: net position negative on a lot of projects (orphan customer-payment attribution). → migration 087
- **[2026-04-26]** Fix: dashboard pipeline value too big — weighted-pipeline calc corrected (now ₹1.24 Cr from 15 leads). → no migration
- **[2026-04-20]** Fix: Zoho-imported expenses all showing as "this month". → migration 086
- **[2026-04-20]** n8n 01-bug-report sub-workflow — `notifyBugReport` now prefers `emitErpEvent` over the legacy standalone webhook (the last Tier-1 holdout). → spec: `2026-04-19-n8n-workflow-catalog.md`
- **[2026-04-20]** n8n Tier 6 meta-infra (nightly backup cron + Sentry forwarder) + 10 more WhatsApp templates. → spec: `2026-04-19-n8n-workflow-catalog.md`
- **[2026-04-20]** n8n Tier 2 digest scaffolding — 10 daily/weekly cron workflows (#19–#28). → spec: `2026-04-19-n8n-workflow-catalog.md`
- **[2026-04-20]** n8n Tier 1 scaffolding complete — 13 new workflow JSONs (11 webhook + 2 cron), router expanded to 16 routes, 5 more emit sites wired, 8 more digest views. → migration 085 · spec: `2026-04-19-n8n-workflow-catalog.md`
- **[2026-04-20]** n8n scaffolding: migrations 082+083 applied to dev via Supabase MCP, types regenerated, `emitExpenseSubmitted` swapped to `whatsapp_number`. → migrations 082, 083 (applied)
- **[2026-04-20]** Zoho data-accuracy pass — phases 06-12 rewritten + full re-run. → migration 084 · plan: `2026-04-19-data-accuracy-pass.md`
- **[2026-04-19]** n8n workflow catalog drafted — 59 workflows across 6 tiers (handoffs, digests, anomalies, customer-facing, compliance, meta-infra) as the automation roadmap. → spec: `2026-04-19-n8n-workflow-catalog.md`
- **[2026-04-19]** n8n + Caddy infrastructure live on DigitalOcean (droplet `shiroi-erp`, auto-HTTPS via Caddy; n8n at n8n.shiroienergy.com, ~₹1,000/mo). → no migration · infra `infrastructure/n8n/`
- **[2026-04-19]** Fix: project-level cash position wrong on 115 projects (Drive-BOM fake POs + trigger LEFT JOIN bug). → migrations 080, 081
- **[2026-04-18]** Fix: vendor payment over-counting from Zoho import. → migration 079
- **[2026-04-18]** Data: Drive-derived proposal dates (follow-up to 073/076/077). → migration 078
- **[2026-04-18]** Data: historical date backfill for projects / proposals / leads. → migrations 073, 076, 077
- **[2026-04-18]** Fix: legacy vouchers invisible in project Actuals tab. → migration 074
- **[2026-04-18]** User Settings Page shipped: `/settings` route with Account (profile + password change), Feedback (bug report form + history), and Users (founder-only role + active controls) tabs. → migration 073 · spec: `2026-04-18-user-settings-page-design.md` · plan: `2026-04-18-user-settings-page.md`
- **[2026-04-18]** Finance Module V2 + Zoho Books backfill shipped overnight (agentic run). → migrations 067–072 · spec: `2026-04-17-finance-module-v2-zoho-design.md` · module: `finance`
- **[2026-04-17]** Expenses module shipped: standalone /expenses, dual state machine (project-linked 3-stage + general 2-stage), per-submitter voucher numbering (`voucher_prefix` on employees), category master (8 seeded + CRUD), expense_documents table, `get_expense_kpis` RPC, Project Actuals read-only embed. → migration 066 · spec: `2026-04-17-expenses-module-design.md` · module: `expenses`
- **[2026-04-17]** Purchase v2 feedback pass (Vivek review) — Tab 1 inline Qty/Rate edit + per-project BOQ PDF; → migration 065 · spec: `2026-04-17-purchase-v2-feedback-design.md` · plan: `2026-04-17-purchase-v2-feedback-implementation.md` · module: `purchase`
- **[2026-04-17]** Plant Monitoring — project picker upgraded to searchable combobox in Add dialog and filter bar. Client-side substring search on customer name + project number, keyboard nav (↑↓/Enter/Esc), × clear, "Create a new project →" escape hatch. No DB changes. → spec: `2026-04-17-plant-monitoring-project-combobox-design.md` · module: `om`
- **[2026-04-17]** Default PM switched from EARLIEST to LATEST active `project_manager` (`ORDER BY created_at DESC`). New PMs catch fresh project intake from sales; seniors stay free for escalations. Today still resolves to Manivel (only active PM). Srikanth Neelankarai (the other PM-less active project) also data-patched to Manivel — blast radius now zero. → migration 064
- **[2026-04-17]** Project status crash hotfix: moving a PM-less auto-created project (e.g. Deepak) from `yet_to_start` → `in_progress` crashed the `trg_payment_followup` trigger with `null value in column created_by`. → migrations 062, 063
- **[2026-04-17]** Purchase v2 hotfix: RFQ RLS was founder/PE-only but Shiroi has no `purchase_officer` user — Manivel (`project_manager`) is the de-facto PE. Migration 061 broadens INSERT/UPDATE on `rfqs`, `rfq_items`, `rfq_invitations`, `rfq_quotes`, `rfq_awards` to include `project_manager`. Founder-only approval on POs untouched. → migration 061
- **[2026-04-17]** Purchase Module v2 — 5-stage competitive procurement pipeline shipped end-to-end across 10 phases. → migration 060 · spec: `2026-04-17-purchase-module-v2-design.md` · plan: `2026-04-17-purchase-module-v2-implementation.md` · module: `purchase`
- **[2026-04-17]** Docs restructure: CLAUDE.md slimmed 811→~180 lines, master reference slimmed ~1,900→~600 lines, per-module docs introduced. · spec: `2026-04-17-docs-restructure-design.md`
- **[2026-04-16]** Plant Monitoring module shipped end-to-end (Manivel's spec). `/om/plant-monitoring` page, brand detection helper, commissioning→creds sync trigger, summary RPC. → migration 059 · spec: `2026-04-16-plant-monitoring-design.md` · module: `om`
- **[2026-04-15]** Category standardisation: `project_boq_items` + `price_book` + `delivery_challan_items` collapsed to Manivel's 15 categories. `ItemCombobox` wired into BOI/BOQ/proposal with ~950 deduped suggestions. → migrations 057, 058 · spec: `2026-04-15-category-standardisation-design.md`
- **[2026-04-15]** As-any cleanup R1: 5 action/query files refactored to typed rows + `ActionResult<T>`. Forbidden-pattern baseline 97→57. Bug in `check-forbidden-patterns.sh` (set -eo pipefail + grep exit-1) fixed.
- **[2026-04-15]** Dashboard caching: 5 `unstable_cache` wrappers around aggregation RPCs. Expected ~60% DB round-trip reduction on dashboard loads.
- **[2026-04-15]** Playwright smoke tests: @playwright/test installed, 5 tests (/login, founder dashboard, /leads, /projects, /price-book) with dual-mode execution.
- **[2026-04-15]** God component splits: survey-form (1,191 LOC), project-files (1,124 LOC), proposal-wizard (1,024 LOC) each split into 5–6 modules, all under the 500-LOC rule #14.
- **[2026-04-15]** Storage RLS perf fix: 8 storage.objects policies now use cached `get_my_role()` helper instead of inline profile EXISTS check. Missing UPDATE policy for site-photos bucket also added. → migration 054
- **[2026-04-15]** Marketing + Design revamp shipped end-to-end. → migrations 051, 052, 053, 055, 056 · spec: `2026-04-04-pm-leads-proposals-design.md` · modules: sales, design
- **[2026-04-14]** Inverter telemetry infrastructure: 7 tables (partitioned monthly by RANGE), 8 functions, 5 pg_cron schedules, auto-ticket scan feeding Service Tickets V3. `packages/inverter-adapters/` workspace package (sungrow, growatt, sma, huawei stubs). Edge Function `supabase/functions/inverter-poll/`. → migration 050
- **[2026-04-14]** Engineering rules codified: 10 new NEVER-DO rules (#11–20) from full-codebase audit. CI workflow with check-types + lint + forbidden-pattern baseline. `ActionResult<T>` helper introduced. → migration 048 (performance round 2: 4 indexes + 3 RPCs)
- **[2026-04-14]** Projects module 3-bug batch fix: BOM auto-pricing rewritten with 4-strategy layered matching · server PDF render config added (`@react-pdf/renderer` external) · CEIG ≥10kW gate fixed (was backwards).
- **[2026-04-14]** Documents tab drag-drop fix: missing UPDATE RLS policy on project-files bucket added. → migration 047
- **[2026-04-14]** Manivel PM corrections — 4 batches (21 tasks). → migrations 045, 046 · module: projects
- **[2026-04-13]** AMC Module V3: flat contract-centric table, Create AMC with Free/Paid (Free auto-creates 3 visits), visit tracker, 8 server actions. → migration 044 · module: `om`
- **[2026-04-12]** Task Module V4 (Manivel's 6-fix spec): customer_name-only links, icon-only Activity Log with expandable row, compact 2-col forms, Status Open/Closed only, Milestone removed from UI.
- **[2026-04-12]** Search filter speed: SearchInput debounce 350ms→200ms across 14 paginated pages.
- **[2026-04-11]** PM Stepper modules overhaul (Manivel's 5-module spec): DC Corrections V2, Execution V2 (10 milestones, 11-col task table), Actuals V2 (lock mechanism, qty editable), QC V2 (7-section structured form, approval workflow, QC PDF), Commissioning V2 (multi-string test table, monitoring details, finalize). → migrations 037, 038, 039, 040
- **[2026-04-11]** Purchase module overhaul: project-centric `/procurement`, per-item vendor assignment, auto-group into vendor-wise POs, Material Receipt → Ready to Dispatch flow, priority toggle. → migration 041 · module: `purchase`
- **[2026-04-11]** Task Module V2 + Documents tab fix + Execution V3 + Actuals & QC V3 + Liaison V2 + Task V3 + Service Tickets V2 + AMC V2. → migrations 042, 043
- **[2026-04-10]** BOI V2 + BOQ V2: multi-version BOI (BOI-1, BOI-2) with draft→submitted→approved→locked workflow, 14 Manivel categories, BOQ Budget Analysis (5-card summary, category breakdown, Send to Purchase, Auto-Price). → migration 036 · module: `projects`
- **[2026-04-10]** Documents tab overhaul: separate Card boxes per category (12), compact Handover box, Site Photos slideshow, drag-and-drop recategorization between boxes, upload dropdown matches new category list.
- **[2026-04-09]** Project detail page overhaul: 8-status dropdown header, 12-stage ProjectStepper, Details tab 4 editable boxes (FinancialBox/SystemConfigBox/CustomerInfoBox/TimelineTeamBox), new Actuals step, new Documents tab, Vouchers approval queue at `/vouchers`. → migrations 033, 034 · module: `projects`
- **[2026-04-07]** WhatsApp import pipeline: 4,164 records extracted from 3 group chats → activities +3,320, daily reports +210, contacts +275, BOQ items +135, payments +40. UI at `/whatsapp-import`. → migration 025 · spec: `2026-04-07-whatsapp-import` plan
- **[2026-04-06]** Marketing redesign: stage-based leads pipeline, weighted KPIs, tabbed lead detail, task-centric follow-ups, payment follow-up trigger. Payments overview page with P&L. → migrations 020, 021 · module: `sales`
- **[2026-04-05 → 2026-04-07]** PM Corrections R2: QC/Liaison/Status constraint fixes, commissioning edit, task completion toggles, tasks page overhaul, O&M visits overhaul, PDF hardening. → migrations 022a, 022b, 023a, 023b, 024a, 024b
- **[2026-04-04]** Contacts V2 (HubSpot-style): person + organization separation, lifecycle stages, activity timeline, edit pages, smart backfill (~1,115 contacts, ~56 companies). → migration 017 · module: `contacts`
- **[2026-04-04]** HubSpot-style DataTable: reusable across leads/proposals/projects/contacts/companies. Column picker (search + drag-reorder), saved views (tabs), URL-driven sort/pagination, inline editing. → migration 018 (table_views)
- **[2026-04-03]** HubSpot cutover complete (V2): 1,115 leads, 314 projects, 314 proposals, 30 payments migrated. 0 unmatched payments.
- **[2026-04-03]** Google Drive sync: 180 confirmed project folders synced (BOM, project dates, brands, margins, addresses). 1,344 files from 159 projects → Supabase project-files bucket. **2,151 total files across 136 projects.**
- **[2026-04-02]** Phase 2B complete: 57+ routes, all sidebar links data-driven, 0 placeholders. Procurement, Inventory, Vendors, Tasks, Daily Reports, Finance, QC, HR, O&M, Sales, Liaison, Design, Reference.
- **[2026-04-02]** Sentry live: `@sentry/nextjs` v10, client+server+edge+onRequestError, DSN in `.env.local`.
- **[2026-04-01]** UI/UX Overhaul R1 + R2: 15 improvements (Logo SVG, Eyebrow, EmptyState, Skeleton, Breadcrumb, Radix Dialog upgrade, Sheet/Tooltip/DropdownMenu/Tabs, sidebar collapse+mobile drawer, Form component, skip-to-content, etc.). Color token cleanup across 45+ files.

## March 2026

- **[2026-03-30]** Phase 2A role-adaptive dashboards: 8 role-specific dashboards, PM 10-step stepper, founder role switcher. · spec: `2026-03-30-role-dashboards-design.md`
- **[2026-03-30]** Phase 1A complete: 8 priority screens built (founder dashboard, leads, proposals, projects, procurement, cash, HR, daily reports).
- **[2026-03-29]** Database schema complete: 134 tables, 91 triggers, RLS on every table. → migrations 001 through 012 shipped.
- **[2026-03-29]** Supabase client factory: browser + server + admin + middleware. RLS recursion fix with `get_my_role()` + `get_my_employee_id()`. → migration 008a
- **[2026-03-29]** Design system V1: `packages/ui` with 11 components. Shiroi brand tokens.
- **[2026-03-29]** Auth + App Shell: login with logo, middleware, collapsible sidebar, topbar with role switcher.

## Earlier (foundation)

- **[2026-03-early]** Monorepo scaffolded: Turborepo + pnpm, all packages wired, `@repo/types` / `@repo/supabase` / `@repo/ui` / `@repo/eslint-config` / `@repo/typescript-config`.
- **[2026-03-early]** GitHub repo created: `github.com/Shiroi-Energy-LLP/shiroi-erp` (private).
- **[2026-03-early]** Supabase projects created: dev (`actqtzoxjilqnldnacqz`) + prod (`kfkydkwycgijvexqiysc`).
- **[2026-03-early]** Next.js 14 ERP app running at `localhost:3000`.

---

## How to append to this file

One line per shipped milestone. Include:
- Date in `[YYYY-MM-DD]` format (first of a multi-day effort is fine).
- One-sentence headline.
- Migration numbers if the change touched the DB.
- Spec filename if there was one (just the basename, not full path).
- Module name (sales / design / projects / purchase / finance / om / liaison / hr / inventory / contacts) if the change is scoped to one.

**Keep it short — one line, hard cap ~400 characters.** If an entry needs a paragraph, write it up in `docs/reviews/<YYYY-MM-DD>-<topic>.md` (or the spec) and **link the basename here** — never inline it. `scripts/ci/check-changelog-entry-length.sh` prints an advisory warning for any entry over the cap (warning only; it never fails the build). This file is the grep-able index, not the record of detail.
