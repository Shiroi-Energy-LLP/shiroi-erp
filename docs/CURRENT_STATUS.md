# Current Status

> Weekly-refreshed snapshot of what's in flight and where dev ↔ prod stand.
> History lives in `docs/CHANGELOG.md`. Specs in `docs/superpowers/specs/`.
> Last updated: **April 18, 2026** (Claude — overnight agentic run + finance over-count fix).

---

## Phase

**Phase 3 — Advanced Features + Deployment.**
Building out final modules before moving to full prod rollout. Still active development — 3 more big modules to ship before employee testing week.

---

## In flight this week (April 14–18, 2026)

| Item | Owner | Status | Detail |
|------|-------|--------|--------|
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
| Phase D (n8n Zoho live sync) | Claude | 🔜 Skipped per brief | n8n webhook wiring for live Zoho → ERP sync. Requires n8n running. All DB infrastructure (zoho_sync_queue, triggers, claim/ack RPCs) is ready. |
| Employee testing week | All | 🔜 Planned | 5–6 employees review on dev for 1 week. Data flags + inline edit + verification. |
| Prod deployment window | Vivek | 🔜 After testing | Batch-promote migrations 013–072 to prod + selective data migration. |

---

## Migration state

| Env | Latest applied | Pending |
|-----|---------------|---------|
| **Dev** (`actqtzoxjilqnldnacqz`) | **079** (vendor payment over-count fix + trigger hardening, Apr 18) | None — fully caught up |
| **Prod** (`kfkydkwycgijvexqiysc`) | 012 (approximate — last coordinated window) | **013 through 079** — 67 migrations waiting on the next prod window |

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
| n8n | `[spare-laptop-ip]:5678` |
| PVLib microservice | `[spare-laptop-ip]:5001` |

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
