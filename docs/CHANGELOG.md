# Shiroi ERP — Changelog

> Append-only. One line per shipped milestone. The source of truth for "when did we ship X / which migration was X in."
> Verbose daily-log footers and the old CLAUDE.md CURRENT STATE table were compressed into this file on April 17, 2026 as part of the docs restructure. Full prior content preserved in `docs/archive/CLAUDE_MD_2026-04-17_ARCHIVED.md` and `docs/archive/SHIROI_MASTER_REFERENCE_3_0_ARCHIVED.md`.

Format: `[YYYY-MM-DD] <headline> → <migration(s) if any> · <spec if any> · <module if any>`

---

## April 2026

- **[2026-04-17]** Plant Monitoring — project picker upgraded to searchable combobox in Add dialog and filter bar. Client-side substring search on customer name + project number, keyboard nav (↑↓/Enter/Esc), × clear, "Create a new project →" escape hatch. No DB changes. → spec: `2026-04-17-plant-monitoring-project-combobox-design.md` · module: `om`
- **[2026-04-17]** Default PM switched from EARLIEST to LATEST active `project_manager` (`ORDER BY created_at DESC`). New PMs catch fresh project intake from sales; seniors stay free for escalations. Today still resolves to Manivel (only active PM). Srikanth Neelankarai (the other PM-less active project) also data-patched to Manivel — blast radius now zero. → migration 064
- **[2026-04-17]** Project status crash hotfix: moving a PM-less auto-created project (e.g. Deepak) from `yet_to_start` → `in_progress` crashed the `trg_payment_followup` trigger with `null value in column created_by`. Root cause: no `marketing_manager` employee exists and `project_manager_id` was NULL → `COALESCE` fell through to NULL. Migration 062 widens the owner-resolution ladder to 3 tiers (marketing_manager → project_manager → founder). Migration 063 closes the gap at the source: `create_project_from_accepted_proposal()` now assigns a default PM on auto-create. Deepak's existing row data-patched to Manivel as PM. → migrations 062, 063
- **[2026-04-17]** Purchase v2 hotfix: RFQ RLS was founder/PE-only but Shiroi has no `purchase_officer` user — Manivel (`project_manager`) is the de-facto PE. Migration 061 broadens INSERT/UPDATE on `rfqs`, `rfq_items`, `rfq_invitations`, `rfq_quotes`, `rfq_awards` to include `project_manager`. Founder-only approval on POs untouched. → migration 061
- **[2026-04-17]** **Purchase Module v2** — 5-stage competitive procurement pipeline shipped end-to-end across 10 phases. BOQ → RFQ (3 quote-entry modes: vendor portal / manual / Excel upload) → Quote Comparison (L1 auto-highlight, override-with-reason, auto-award-all-L1) → PO with founder approval gate (approve/reject with reason) → Dispatch lifecycle (PE sent → vendor shipped → acknowledged). UUID-token vendor portal (no login), Gmail compose + WhatsApp deep-link channels (no SMTP), `procurement_audit_log` with 14 events, 6 notification events, Playwright smoke coverage (9 tests). Forbidden-pattern baseline held at 61. → migration 060 · spec: `2026-04-17-purchase-module-v2-design.md` · plan: `2026-04-17-purchase-module-v2-implementation.md` · module: `purchase`
- **[2026-04-17]** Docs restructure: CLAUDE.md slimmed 811→~180 lines, master reference slimmed ~1,900→~600 lines, per-module docs introduced. · spec: `2026-04-17-docs-restructure-design.md`
- **[2026-04-16]** Plant Monitoring module shipped end-to-end (Manivel's spec). `/om/plant-monitoring` page, brand detection helper, commissioning→creds sync trigger, summary RPC. → migration 059 · spec: `2026-04-16-plant-monitoring-design.md` · module: `om`
- **[2026-04-15]** Category standardisation: `project_boq_items` + `price_book` + `delivery_challan_items` collapsed to Manivel's 15 categories. `ItemCombobox` wired into BOI/BOQ/proposal with ~950 deduped suggestions. → migrations 057, 058 · spec: `2026-04-15-category-standardisation-design.md`
- **[2026-04-15]** As-any cleanup R1: 5 action/query files refactored to typed rows + `ActionResult<T>`. Forbidden-pattern baseline 97→57. Bug in `check-forbidden-patterns.sh` (set -eo pipefail + grep exit-1) fixed.
- **[2026-04-15]** Dashboard caching: 5 `unstable_cache` wrappers around aggregation RPCs. Expected ~60% DB round-trip reduction on dashboard loads.
- **[2026-04-15]** Playwright smoke tests: @playwright/test installed, 5 tests (/login, founder dashboard, /leads, /projects, /price-book) with dual-mode execution.
- **[2026-04-15]** God component splits: survey-form (1,191 LOC), project-files (1,124 LOC), proposal-wizard (1,024 LOC) each split into 5–6 modules, all under the 500-LOC rule #14.
- **[2026-04-15]** Storage RLS perf fix: 8 storage.objects policies now use cached `get_my_role()` helper instead of inline profile EXISTS check. Missing UPDATE policy for site-photos bucket also added. → migration 054
- **[2026-04-15]** Marketing + Design revamp shipped end-to-end: new `marketing_manager` role, `quick_quote_sent` / `design_in_progress` / `detailed_proposal_sent` / `closure_soon` enum stages, channel partners, consultant commission lock, lead closure approvals (green/amber/red band), new `/sales` + `/partners` routes, `/design/[leadId]` workspace, Quote tab with BomPicker, payment follow-up tasks with SLA triggers. → migrations 051, 052, 053, 055, 056 · spec: `2026-04-04-pm-leads-proposals-design.md` · module: `sales`, `design`
- **[2026-04-14]** Inverter telemetry infrastructure: 7 tables (partitioned monthly by RANGE), 8 functions, 5 pg_cron schedules, auto-ticket scan feeding Service Tickets V3. `packages/inverter-adapters/` workspace package (sungrow, growatt, sma, huawei stubs). Edge Function `supabase/functions/inverter-poll/`. → migration 050
- **[2026-04-14]** Engineering rules codified: 10 new NEVER-DO rules (#11–20) from full-codebase audit. CI workflow with check-types + lint + forbidden-pattern baseline. `ActionResult<T>` helper introduced. → migration 048 (performance round 2: 4 indexes + 3 RPCs)
- **[2026-04-14]** Projects module 3-bug batch fix: BOM auto-pricing rewritten with 4-strategy layered matching · server PDF render config added (`@react-pdf/renderer` external) · CEIG ≥10kW gate fixed (was backwards).
- **[2026-04-14]** Documents tab drag-drop fix: missing UPDATE RLS policy on project-files bucket added. → migration 047
- **[2026-04-14]** Manivel PM corrections, 4 batches (21 tasks): Survey PDF, BOQ qty inline edit, DC PDF null guards, execution task visibility, liaison CEIG scope toggle, SignaturePad component, commissioning signatures, AMC V4 (9-col table), Service Tickets V3 (3-digit numbers, customer-only links), PO rate inline edit, PO PDF + download + Cancel, Price Book CRUD + page V2 + Sheets import (217 items, final 252 active). → migrations 045, 046
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

**Keep it short.** Paragraphs of detail belong in the spec or the module doc — not here.
