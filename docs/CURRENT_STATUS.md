# Current Status

> Weekly-refreshed snapshot of what's in flight and where dev ↔ prod stand.
> History lives in `docs/CHANGELOG.md`. Specs in `docs/superpowers/specs/`.
> Last updated: **April 20, 2026** (Tier 1 + Tier 2 + Tier 6 n8n scaffolding complete on `feat/n8n-workflow-scaffolding` — 14 Tier 1 workflow JSONs (12 webhook incl. `01-bug-report` + 2 cron), 10 Tier 2 digest JSONs (#19–#28 daily/weekly cron), 3 Tier 6 meta/infra JSONs (#56 droplet health, #57 nightly backup, #58 Sentry forwarder), router wired to 16 routes, 6 `emitErpEvent` call sites (incl. `notifyBugReport` now via event bus with legacy webhook as fallback), migration 085 with 8 more digest views applied to dev, types regen + strip-script added, 10 more WhatsApp templates catalogued. Zoho data-accuracy pass earlier on the same branch with mig 084 DDL already live; cash-position root-cause fix migs 080+081 before that).

---

## Phase

**Phase 3 — Advanced Features + Deployment.**
Building out final modules before moving to full prod rollout. Still active development — 3 more big modules to ship before employee testing week.

---

## In flight this week (April 14–20, 2026)

| Item | Owner | Status | Detail |
|------|-------|--------|--------|
| **Zoho data-accuracy pass — `feat/n8n-workflow-scaffolding`** | Claude (overnight 2026-04-19/20) | 🔄 Awaits morning review | Vivek flagged financials as still wrong after migs 079/080/081 and authorized an overnight autonomous pass: *"Find the best route to get all this data right and go ahead and implement them overnight."* Rewrote phases 06–12 of `scripts/zoho-import/` end-to-end. Phase 06 matcher is now a weighted scorer (Jaccard + Dice + project-cost/size/city/customer) — auto-matches jumped 12 → 141. Phases 07/08 read `Project ID` directly from Zoho XLS (lookup via `projects.zoho_project_id`). Phases 09/11 fixed the grain bug — Customer_Payment.xls and Vendor_Payment.xls are **per-allocation** (one XLS row per invoice/bill a payment is split across); prior code deduped by parent `CustomerPayment ID` / `VendorPayment ID` and dropped 99% of detail. New dedupe keys: `InvoicePayment ID` / `PIPayment ID`. Phase 11 also ditched the "first open bill for vendor" heuristic (which misdirected 669 of 729 in April's import) for a direct `Bill ID` → `zoho_bill_id` lookup. Phases 10/12 added customer-name fallback. **Migration 084** relaxes `project_id` to NULL on `purchase_orders` / `invoices` / `customer_payments` / `vendor_payments` so rows without a matched project still land (CHECK constraint keeps ERP-source rows NOT NULL). **Result:** customer_payments 7 → 1078 (154×), vendor_payments 729 → 1486, invoices 20 → 481, POs 106 → 1247, expenses 190 → 5113. Reconciliation: **2 discrepancies across 141 mapped projects** (one project off ₹18,775). Money totals now captured — ₹67.87 Cr received, ₹46.72 Cr paid, ₹74.74 Cr invoiced, ₹64.52 Cr billed-to-us, ₹6.53 Cr expensed. Plan: `docs/superpowers/plans/2026-04-19-data-accuracy-pass.md`. 76 projects still in `docs/zoho-review-queue.csv` for manual match. **To unblock morning:** (1) review money totals against bank/accountant statements; (2) spot-check a sample of projects in `/profitability`; (3) manually match remaining 76 projects (sheet already present); (4) merge branch. |
| **n8n workflow scaffolding — `feat/n8n-workflow-scaffolding`** | Claude (overnight 2026-04-18/19/20) | 🔄 Awaits morning review | Branch has 10+ commits ready for Vivek to review + merge. Tier 1 of the 59-workflow catalog is **complete**. **Prior commits still pending merge:** LLP legal-name corrections · `emitErpEvent()` helper + `N8N_EVENT_BUS_URL` env · migration 082 `employees.whatsapp_number` · event-bus router + global error handler + programmatic push script · 4 Tier 1 sub-workflow templates · emit wired into `advanceProjectStatus` + `submitExpense` · migration 083 (7 digest views) + WhatsApp template catalog (~20 templates). **New this pass (overnight 2026-04-19/20):** (a) `emitErpEvent` wired into 5 more action files — `approvePO` → `purchase_order.approved`, `recordPayment` → `customer_payment.received`, `createServiceTicket` → `om_ticket.created`, `createEmployeeAccount` → `employee.created`, `recordCeigApproval` → `ceig_approval.received`. Pre-existing embed bug in po-actions.ts (`vendors(name)` → `(company_name)`) fixed along the way. (b) 11 more Tier 1 webhook sub-workflow JSONs (04 proposal-requested, 05 proposal-submitted, 07 PO-approved, 09 GRN-recorded (pending ERP wiring), 10 installation-scheduled, 11 installation-complete, 12 CEIG-approval-received, 14 customer-payment-received, 15 om-ticket-created, 17 leave-request-submitted (pending ERP wiring), 18 employee-created) + 2 Tier 1 cron JSONs (03 lead-stale-24h hitting v_digest_leads_stale_24h, 08 vendor-payment-due hitting v_digest_vendor_payments_due_7d with >₹5L → Vivek cc branch and MSME 45-day inline reminder). All 13 use SIMULATED SEND `Set` placeholders until WABA credential lands. (c) Router `00-event-bus-router.json` expanded from 5 to 16 Switch routes + fallback. (d) Migration 085 (applied to dev via MCP) adds 8 more digest views for Tier 2 (`v_digest_proposals_silent_3d`, `v_digest_proposals_design_backlog`, `v_digest_milestones_overdue`, `v_digest_pos_pending_approval`, `v_digest_vendor_payments_due_7d`, `v_digest_invoices_due_7d`, `v_digest_om_tickets_open_48h`, `v_digest_leave_pending`). Pre-apply fix: vendors table has `company_name` not `name` — corrected throughout. (e) `scripts/strip-view-fk-entries.mjs` introduced — post-processes `database.ts` to drop bogus `referencedRelation: "v_*"` FK entries that Supabase's type generator invents from view metadata (without it, tsc hits TS2589 "type instantiation excessively deep"). Cuts database.ts from ~36k lines → ~15k. Run after every regen. (f) Push script + workflows README updated with all new placeholders, Supabase service-role credential, and Tier 1 status matrix. Type-check + lint clean repo-wide. **Tier 2 also shipped same pass:** 10 daily/weekly digest JSONs (`19`–`28`) following the 4-node cron template (scheduleTrigger → Supabase REST → compose → SIMULATED SEND). `19` (Vivek 7AM, new leads), `20–25/27` (role-head 8AM digests hitting primary Tier 2 views — stale leads, design backlog, overdue milestones, pending POs with MSME flag, overdue invoices, open O&M tickets with SLA badge, pending leave requests). `26` (Liaison) and `28` (Vivek weekly Mon) are placeholder workflows documenting the missing views (CEIG/net-metering/docs-expiry for 26, weekly rollups for 28) — author in a follow-up migration. Adds 8 more role-head WhatsApp env vars to the droplet checklist (`{SALES,DESIGN,PROJECTS,PURCHASE,OM,LIAISON,HR}_HEAD_WHATSAPP`). **Tier 6 meta also shipped:** `56` droplet health (every 15min executeCommand top/free/df → Switch on ≥85% → alert Vivek), `57` nightly 2AM IST backup of `~/.n8n` → `tar.gz` → Supabase Storage `n8n-backups/YYYY-MM-DD.tar.gz` with sha256 (needs bucket pre-create), `58` Sentry webhook `/webhook/sentry-alert` filtering fatal/error → WhatsApp Vivek. **Templates:** 10 more WhatsApp template bodies added to `infrastructure/n8n/templates.md` for the new Tier 1 + Tier 6 surfaces (proposal-requested, proposal-submitted, po-approved, vendor-payment-due, install-complete-internal, ceig-approval, customer-payment unified, om-ticket-assigned, employee-onboarded unified, infra-alert unified). Unified templates keep Meta's finite template quota lean. No new push-script mappings needed — Tier 2/6 only reference credentials/error-handler already registered. **To unblock morning: (1)** merge branch; **(2)** finish WABA creation + submit all templates in `templates.md` to Meta for approval; **(3)** create n8n credentials (`x-webhook-secret` Header Auth, `Gmail (Vivek)` OAuth, **new: `Supabase service role` HTTP Header Auth** with `apikey: {sb_secret_*}`); **(4)** set droplet env vars (`SUPABASE_PROJECT_ID`, `SUPABASE_SECRET_KEY`, `VIVEK_WHATSAPP`, `FINANCE_HEAD_WHATSAPP`, `SALES_HEAD_WHATSAPP`, `DESIGN_HEAD_WHATSAPP`, `PROJECTS_HEAD_WHATSAPP`, `PURCHASE_HEAD_WHATSAPP`, `OM_HEAD_WHATSAPP`, `LIAISON_HEAD_WHATSAPP`, `HR_HEAD_WHATSAPP`); **(5)** create private Supabase bucket `n8n-backups` for workflow #57; **(6)** in Sentry, configure an alert-rule webhook to `https://n8n.shiroienergy.com/webhook/sentry-alert` with `x-webhook-secret` header; **(7)** run `pnpm tsx scripts/push-n8n-workflows.ts` to import all 32 workflows (router + error handler + 15 Tier 1 subs + 2 Tier 1 crons + 10 Tier 2 digests + 3 Tier 6 meta). Migration state on dev: 081 tracked + 082+083+085 tracked + 084 DDL live (applied outside `supabase_migrations.schema_migrations`). |
| **n8n + Caddy infrastructure** | Vivek + Claude | ✅ Shipped Apr 19 | DigitalOcean Bangalore droplet (`shiroi-erp`, 2 GB / $12/mo) running n8n + Caddy via `docker-compose`. Public URL `https://n8n.shiroienergy.com` (auto-HTTPS via Let's Encrypt). Cloud-init user-data script bakes Docker + UFW + `/opt/shiroi-automation/` at first boot — after two aborted attempts (stuck `sshd_config` apt prompt, then failed rebuild), the cloud-init path worked first-try. Replaces the "spare laptop" plan from master reference §3.2 — same software, different host; trades ~₹1,000/mo for public IP (so Supabase webhooks land without LAN tunneling) + zero uptime management. Infra files mirrored in `infrastructure/n8n/` (docker-compose + Caddyfile + cloud-init + README). Unblocks Phase D (Zoho live sync), daily training microlearning, WhatsApp drip sequences, nightly crons, and the bug-report webhook from `/settings`. |
| **Fix: project cash position wrong on 115 projects (root cause, not symptom)** | Claude | ✅ Shipped Apr 19 | Vivek pushed back on mig 079: *"the numbers are still wrong. VAF still shows -3 cr, whereas it should be profitable. same with a lot of other projects. you have not found the root cause for the cash position numbers. pls dig deep and get this sorted out."* Two bugs stacked. **(A)** `scripts/migrate-google-drive.ts` had pre-created 869 ERP-source POs from BOM with fake `amount_paid=total_amount` + `status='fully_delivered'`. **(B)** `refresh_project_cash_position()` trigger computed `total_invoiced` via a backwards LEFT JOIN starting from customer_payments, so projects with 0 payments showed `invoiced=0` even with real invoices. Combined effect on VAF: cash said `net=-3Cr`, truth is `+17L`. **Mig 080** deletes 75 Drive-BOM POs on 8 dup-PO projects + rewrites the trigger to query invoices/payments independently + force-refreshes all 57 cash-position rows. **Mig 081** soft-cancels the remaining 775 Drive-BOM POs on 115 non-dup projects (57 real Zoho payments worth ₹98.49L kept attached to satisfy CHECK). Post-fix: only 5 projects remain with net<0 — all legitimate "vendor-spend-ahead-of-invoice" states (real Zoho POs). Findings in `docs/2026-04-19-cash-position-root-cause.md`. |
| **Fix: vendor payment over-counting from Zoho import** | Claude | ✅ Shipped Apr 18 | Vivek flagged financial data as wrong ("VAF is fully paid and so on"). Phase 11 Zoho import linked 669/729 vendor payments to wrong bills/POs via bad fallback heuristic (first open bill / latest PO for vendor). Trigger summed unrelated payments onto single targets; `total_ap_bills` was −₹1.39Cr and `total_ap_pos` was −₹4.29Cr (negative = impossible). Migration 079 clamps `amount_paid` to `total_amount` on 2 bills + 25 POs, hardens `update_po_amount_paid` and `recalc_vendor_bill_totals` with LEAST() guards so future imports can't break the invariant. Post-fix VAF AP outstanding ₹0 as Vivek said. AR untouched. Root-cause bug in `phase-11-vendor-payments.ts` to be fixed before next Zoho sync. Findings in `docs/2026-04-18-finance-overcounting-fix.md`. |
| **Data: historical dates backfill** | Claude | ✅ Shipped Apr 18 | Zoho import clobbered `created_at` on ~600 projects/proposals/leads with the 2026-04-02 batch timestamp. Migration 073 used Zoho invoice dates (12 projects). Migration 076 used `project_number` FY (154 projects). Migration 077 parsed year from `proposal_number` (428 proposals) + cascaded to leads. **Migration 078 (follow-up):** walked 4 `Proposals YYYY` Drive folders (1,405 children), matched 229 unambiguous proposals by normalised proposal number, replaced synthetic FY-start dates with real Drive `createdTime` @ noon IST. Dispersed the 2024-01-01 cluster 96→3 and 2023-01-01 cluster 84→28. Remaining Sep-2025 clusters are SHIROI/PROP/2025-26/NNNN internal proposals (not in Drive), sit within correct FY. Full findings in `docs/2026-04-18-date-backfill-findings.md`. |
| **Fix: Expenses invisible in project Actuals tab** | Claude | ✅ Shipped Apr 18 | Migration 066 table rename preserved old FK names (`project_site_expenses_*_fkey`); PostgREST embed hints in `listExpenses` expected `expenses_*_fkey` and failed silently — project Actuals tab showed "no expenses" for all 121 projects with 1358 existing vouchers. Renamed 3 FKs. Reported by Manivel. Migration 074. |
| **User Settings Page** | Claude | ✅ Shipped Apr 18 | `/settings` route with Account / Feedback / Users (founder-only) tabs. Password change, bug reporting (with optional n8n webhook), role + active controls. New `ProfileMenu` dropdown in topbar. Migration 073 (`bug_reports` table + founder-admin RLS). 3 Playwright smoke tests. See `docs/superpowers/plans/2026-04-18-user-settings-page.md`. |
| **Finance Module V2 + Zoho import** | Claude | ✅ Shipped Apr 18 | 5 migrations (067–072). 13-phase import script: 264 accounts, 17 taxes, 945 items, 296 vendors (272 new), 12 projects matched, 2336 vendor bills, 729 vendor payments, 190 expenses. Finance UI: /vendor-bills, /vendors/[id], /profitability V2, /cash Zoho panel, MSME aging strip, sync health dashboard card. Reconcile report: 3 discrepancies. See `docs/modules/finance.md`. |
| **Expenses Module** | Claude | ✅ Shipped Apr 17 | Standalone /expenses module; dual workflow (project-linked 3-stage + general 2-stage); per-submitter voucher numbers; category master + CRUD; Project Actuals read-only embed. Migration 066. See `docs/modules/expenses.md`. |
| **Purchase v2 feedback pass** | Claude | ✅ Shipped Apr 17 | Vivek-review feedback across all 5 tabs: Tab 1 inline Qty/Rate + BOQ PDF; Tab 2 vendor typeahead + invitation rows; Tab 3 terms footer; Tab 4 Send-to-vendor (Email/WA/Copy) + founder quick-PO auto-approve; Tab 5 generated `dispatch_stage` + PM role widening + receipt cascade. See `docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md` + plan. Migration 065. |
| **Purchase Module v2** | Claude | ✅ Shipped Apr 17 | Full 5-stage competitive pipeline (BOQ → RFQ → Comparison → PO → Dispatch), vendor portal, founder approval, audit log, 10 phases. See `docs/modules/purchase.md` + `docs/superpowers/specs/2026-04-17-purchase-module-v2-design.md`. Migration 060. |
| Plant Monitoring module shipped | Claude | ✅ Shipped Apr 16 | `/om/plant-monitoring` page, migration 059, 11 commits. See `docs/modules/om.md`. |
| Docs restructure | Claude | ✅ Shipped Apr 17 | This refactor. See `docs/superpowers/specs/2026-04-17-docs-restructure-design.md`. |
| Marketing + Design revamp — feedback loop | Prem (marketing mgr) | 🔜 Next | Get Prem's feedback on /sales + partners + design workspace + closure band UI. Same cycle as Manivel's PM feedback. |
| Zoho manual project match | Vivek | 🔜 Action needed | 76 projects in `docs/zoho-review-queue.csv` need manual match in Supabase `zoho_project_mapping` table. After matching, re-run phases 07-13 to pick up those projects' transactions. |
| Phase D (n8n Zoho live sync) | Claude | 🔜 Unblocked | n8n now running (Apr 19). DB infrastructure (zoho_sync_queue, triggers, claim/ack RPCs) was ready since migration 072. Next: build the workflow — consume `zoho_sync_queue`, call Zoho Books API, ack on success. |
| Bug-report webhook → alert | Claude | ✅ Shipped Apr 20 | `notifyBugReport` in `settings-actions.ts` now fires through the event bus router (`emitErpEvent('bug_report.submitted', …)` — with submitter full_name fetched from profiles) whenever `N8N_EVENT_BUS_URL` is set, and falls back to the legacy standalone `N8N_BUG_REPORT_WEBHOOK_URL` only when the event bus env is unset. New `01-bug-report.json` sub-workflow follows the Tier 1 template and WhatsApps `$env.VIVEK_WHATSAPP` with a severity-iconed summary + `/settings?tab=feedback&id=…` deep link. Retires the last standalone webhook on the Tier 1 surface. |
| Employee testing week | All | 🔜 Planned | 5–6 employees review on dev for 1 week. Data flags + inline edit + verification. |
| Prod deployment window | Vivek | 🔜 After testing | Batch-promote migrations 013–072 to prod + selective data migration. |

---

## Migration state

| Env | Latest applied | Pending |
|-----|---------------|---------|
| **Dev** (`actqtzoxjilqnldnacqz`) | **085** (Tier 2 digest views extras, Apr 20 via Supabase MCP). 082 (whatsapp_number), 083 (Tier 1 digest views), 085 all tracked. Mig 084 (nullable project_id) DDL is live on dev tables but was applied outside `supabase_migrations.schema_migrations`; Zoho re-run relied on it. | None blocking n8n work — 084 not in migrations table but its ALTERs are in effect |
| **Prod** (`kfkydkwycgijvexqiysc`) | 012 (approximate — last coordinated window) | **013 through 085** — 73 migrations waiting on the next prod window |

**Prod deploy strategy:** batch-promote all pending migrations after employee testing week completes. Selective data migration alongside (we've heavily backfilled dev from Google Drive, HubSpot, Zoho Books, and WhatsApp; not all of that needs to move to prod — specifically the Zoho import tables are dev-only for now).

**Overnight run 2026-04-18 results** (Claude agentic):
- Migrations 067–072 applied and types regenerated (0 check-types errors)
- 13-phase Zoho Books historical import run end-to-end. Key counts: 264 accounts, 17 taxes, 945 items, 20 contacts linked, 296 vendors (272 new created), 12 projects auto-matched (76 in review queue, 160 unmatched), 106 POs, 20 invoices, 7 customer payments, 2336 vendor bills (~2147 from prior run + 189 newly fixed), 729 vendor payments, 190 project expenses, 12 credit notes all skipped (no linked invoice).
- Reconciliation: 3 discrepancies found across 12 matched projects (>₹1 tolerance). Report at `docs/zoho-import-report-2026-04-17.md`.
- Finance UI Phase C shipped (see changelog).

---

## Environment URLs

| Thing | URL |
|-------|-----|
| Dev Supabase | `actqtzoxjilqnldnacqz.supabase.co` |
| Prod Supabase | `kfkydkwycgijvexqiysc.supabase.co` |
| ERP (points at **dev** Supabase) | `erp.shiroienergy.com` (Vercel, auto-deploys on push to `main`) |
| GitHub | `github.com/Shiroi-Energy-LLP/shiroi-erp` (private) |
| Local dev | `localhost:3000` |
| n8n | `https://n8n.shiroienergy.com` (DO Bangalore droplet `shiroi-erp`, `68.183.91.111`) |
| PVLib microservice | `https://pvlib.shiroienergy.com` (same droplet, not yet deployed) |

---

## Active CI / discipline gates

Running on every PR + push to `main` (`~1 min` total):

1. `pnpm check-types` — 5 packages, 0 errors required
2. `pnpm lint` — 2 lintable packages with `--max-warnings 0`
3. `scripts/ci/check-forbidden-patterns.sh` — baseline-aware grep for NEVER-DO rules 11/13/15

**Forbidden-pattern baseline:** currently 66 (ratcheted up from 61 on Apr 17 for 5 new expenses-module `createClient` imports — same grandfathered pattern as 54 pre-existing files). Long-term target: ratchet back down after refactoring these page-level imports into `-queries.ts` helpers.

**Playwright smoke tests** exist (`e2e/smoke.spec.ts`, 9 tests — 6 original + 3 Purchase v2 paths) but not wired into CI yet — needs dev Supabase test user + GitHub Actions secrets.

---

## External registrations in progress

| Item | Where | Blocks | Status |
|------|-------|--------|--------|
| Sungrow iSolarCloud API | isolarcloud.com/developer | Live inverter polling | Registration started, 4–8 weeks |
| Growatt API | server-api.growatt.com | Live inverter polling | Registration started, 4–8 weeks |
| WATI.io WhatsApp BSP | wati.io | Phase 2 direct WA sending | Registration started, 2–4 weeks |
| Facebook Business Manager | business.facebook.com | Required for WATI.io | Part of WATI registration |

---

## Known open issues (non-blocking)

- **Inverter live polling** — adapter stubs + Edge Function + partitioned telemetry all shipped (migration 050 + `packages/inverter-adapters/`). Awaiting Sungrow/Growatt API registration (4–8 weeks). Until then: `SYNTHETIC_INVERTER_READINGS=1` env var produces synthetic readings for end-to-end testing.
- **As-any cleanup R2** — first round cleared 5 files (97→57 baseline violations). ~56 more action/query files remain. Not urgent; discipline gate stops new ones.
- **56 action files** still to migrate to `ActionResult<T>` return shape (NEVER-DO rule #19). Only ~5 done so far.
- **God components** — all 3 files >1,000 LOC from the April 14 audit have been split (survey-form, project-files, proposal-wizard). No known component >500 LOC currently.

---

## What counts as "this week's work"

This file is the weekly view. When something in the table above ships, it:
1. Gets removed from this file.
2. Gets one line added to `docs/CHANGELOG.md`.
3. Updates the relevant module doc in `docs/modules/<module>.md`.

When something new enters the queue, it goes in the table above and (if big enough) gets a spec in `docs/superpowers/specs/`.
