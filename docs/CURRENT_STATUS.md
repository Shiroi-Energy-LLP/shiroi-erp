# Current Status

> Weekly-refreshed snapshot of what's in flight and where dev ↔ prod stand.
> History lives in `docs/CHANGELOG.md`. Specs in `docs/superpowers/specs/`.
> Last updated: **April 17, 2026** (Vivek).

---

## Phase

**Phase 3 — Advanced Features + Deployment.**
Building out final modules before moving to full prod rollout. Still active development — 3 more big modules to ship before employee testing week.

---

## In flight this week (April 14–18, 2026)

| Item | Owner | Status | Detail |
|------|-------|--------|--------|
| **Purchase v2 feedback pass** | Claude | ✅ Shipped Apr 17 | Vivek-review feedback across all 5 tabs: Tab 1 inline Qty/Rate + BOQ PDF; Tab 2 vendor typeahead + invitation rows; Tab 3 terms footer; Tab 4 Send-to-vendor (Email/WA/Copy) + founder quick-PO auto-approve; Tab 5 generated `dispatch_stage` + PM role widening + receipt cascade. See `docs/superpowers/specs/2026-04-17-purchase-v2-feedback-design.md` + plan. Migration 065. |
| **Purchase Module v2** | Claude | ✅ Shipped Apr 17 | Full 5-stage competitive pipeline (BOQ → RFQ → Comparison → PO → Dispatch), vendor portal, founder approval, audit log, 10 phases. See `docs/modules/purchase.md` + `docs/superpowers/specs/2026-04-17-purchase-module-v2-design.md`. Migration 060. |
| Plant Monitoring module shipped | Claude | ✅ Shipped Apr 16 | `/om/plant-monitoring` page, migration 059, 11 commits. See `docs/modules/om.md`. |
| Docs restructure | Claude | 🟡 In progress Apr 17 | This refactor. See `docs/superpowers/specs/2026-04-17-docs-restructure-design.md`. |
| Marketing + Design revamp — feedback loop | Prem (marketing mgr) | 🔜 Next | Get Prem's feedback on /sales + partners + design workspace + closure band UI. Same cycle as Manivel's PM feedback. |
| Zoho Books import | Vivek (provides CSVs) | 🔜 Blocked on CSVs | Vendors, POs, invoices, payments. Dedup against existing 108 vendors, 850 POs. |
| Employee testing week | All | 🔜 Planned | 5–6 employees review on dev for 1 week. Data flags + inline edit + verification. |
| Prod deployment window | Vivek | 🔜 After testing | Batch-promote migrations 013–059 to prod + selective data migration. |

---

## Migration state

| Env | Latest applied | Pending |
|-----|---------------|---------|
| **Dev** (`actqtzoxjilqnldnacqz`) | **065** (Purchase v2 feedback, Apr 17) | None — fully caught up |
| **Prod** (`kfkydkwycgijvexqiysc`) | 012 (approximate — last coordinated window) | **013 through 065** — 53 migrations waiting on the next prod window |

**Prod deploy strategy:** batch-promote all pending migrations after employee testing week completes. Selective data migration alongside (we've heavily backfilled dev from Google Drive, HubSpot, and WhatsApp; not all of that needs to move to prod).

All 59 migrations (001 through 059) are verified on dev via MCP `list_migrations` + spot-checks of key objects (plant_monitoring_credentials, inverters partitioned telemetry, data_flags, project_bois, channel_partners, lead_closure_approvals, `get_pipeline_summary`, `get_my_role`, `get_plant_monitoring_summary`, `get_company_cash_summary`, `get_lead_stage_counts`, `get_amc_monthly_summary`, `get_projects_without_today_report`, `marketing_manager` enum, `closure_soon` enum).

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

**Forbidden-pattern baseline:** currently 61 (ratcheted down from 99 on Apr 14). Only ratchets down. Run `bash scripts/ci/check-forbidden-patterns.sh --update-baseline` after a cleanup pass.

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
