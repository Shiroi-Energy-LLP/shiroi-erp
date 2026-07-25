# Docs INDEX — router for the heavy on-demand docs

> **Generated** by `scripts/build-docs-index.mjs` — do not hand-edit; re-run after adding docs.
> Purpose: find the right spec / plan / review from ONE line without opening 50–145 KB files.
> Paths are relative to `docs/superpowers/specs`, `docs/superpowers/plans`, `docs/reviews`.
> For "when did we ship X" use `docs/CHANGELOG.md`; for module overviews use `docs/modules/<module>.md`.


## Specs — design docs (the *what* & *why*)

_53 files in `docs/superpowers/specs/`_

- `2026-07-25` **Service Ticket — Done By, create parity, single edit surface** — _om (Service Tickets)_ · `2026-07-25-service-ticket-done-by-and-create-parity-design.md`
- `2026-07-20` **Purchase Flow — "Bill of Items Manager" Functional Spec (for ERP re-implementat…** — `2026-07-20-purchase-flow-boi-manager-spec.md`
- `2026-07-20` **Projects List — Expected Dates, Next Follow-up, Multi-Status Filter, Completed-…** — _projects (docs/modules/proj…_ · **Approved (design sign-off by Vivek 2026-07-…** · `2026-07-20-projects-list-dates-followup-multistatus-design.md`
- `2026-07-16` **Zoho Books Live API Sync — Design (2026-07-16)** — a live API connection with Zoho Books so that all finance entries flow Zoho → ERP on a schedule, plus a write API used… · `2026-07-16-zoho-live-api-sync-design.md`
- `2026-07-01` **Repo Structure — Token-Optimization Restructure — Design Spec** — _cross-cutting / docs + repo…_ · **✅ Implemented (docs-layer changes only; no…** · `2026-07-01-token-optimization-restructure-design.md`
- `2026-06-27` **Service Ticket Module — Detail Page, Timeline, KPIs & Filters** — _O&M (/om/tickets)_ · `2026-06-27-service-ticket-detail-and-timeline-design.md`
- `2026-06-21` **BOM + Voucher Import — Design Spec** — **Approved (Vivek), ready for implementation** · an upload → parse → auto-match → human-review → confirm pipeline that · `2026-06-21-bom-voucher-import-design.md`
- `2026-06-19` **Universal Table Typography + Wrap Standard — Design** — _design-system / all modules…_ · **Approved (design); spec under review** · `2026-06-19-table-typography-wrap-standard-design.md`
- `2026-06-19` **Import Review → "Link to existing project" — design (2026-06-19)** — `2026-06-19-import-review-link-existing-project-design.md`
- `2026-06-19` **Docs Lean-Reset — Design Spec** — **✅ Done (2026-06-19) — all migration steps e…** · `2026-06-19-docs-lean-reset-design.md`
- `2026-06-18` **ERP-wide Redundancy Sweep — Design** — `2026-06-18-erp-redundancy-sweep-design.md`
- `2026-06-16` **Manivel Feedback Batch 3 — Design** — `2026-06-16-manivel-feedback-batch3-design.md`
- `2026-06-15` **Won Project Setup Gate — Design** — **design approved, pending spec review → impl…** · force Prem (marketing_manager) to hand over complete first-page data immediately after a deal is won, so every project… · `2026-06-15-won-project-setup-gate-design.md`
- `2026-06-15` **Manivel Dashboard Parity + Data Credibility — Design** — `2026-06-15-manivel-dashboard-parity-design.md`
- `2026-06-11` **Project Feedback Batch 2 — Design** — **Approved by Vivek (design presented in chat…** · `2026-06-11-project-feedback-batch2-design.md`
- `2026-06-10` **Project Module Enhancements — Design** — **Approved by Vivek (chat, 2026-06-10)** · `2026-06-10-project-module-enhancements-design.md`
- `2026-06-09` **Customer + Project Name on Leads & Projects — Design** — `2026-06-09-leads-projects-customer-project-name-design.md`
- `2026-06-09` **Selective Google / iPhone Contacts Import + Fuzzy Match — Design** — `2026-06-09-iphone-contacts-import-design.md`
- `2026-06-09` **Dev → Prod Migration — Design Spec & Cutover Runbook** — `2026-06-09-dev-to-prod-migration-design.md`
- `2026-06-08` **Team Tasks fixes · Won→Manivel hand-off · Morning-message additions** — **Draft — pending Vivek review** · `2026-06-08-team-tasks-won-handoff-morning-digest-design.md`
- `2026-06-08` **Leads Page — Referrer Filter Simplification, MGMT Rename, dd/mm/yyyy Date Picker** — _sales (leads)_ · **design approved (2026-06-08) — implementati…** · `2026-06-08-leads-filters-and-date-picker-design.md`
- `2026-06-05` **Implement Claude Code Insights Recommendations — Design** — `2026-06-05-implement-cc-insights-design.md`
- `2026-06-05` **Historical Plants Import + Plant Credentials Encryption — Design** — `2026-06-05-historical-plants-import-design.md`
- `2026-05-25` **Shiroi RAG — Design Spec** — `2026-05-25-shiroi-rag-design.md`
- `2026-05-23` **Liaison TNEB Stages Redesign — May 23, 2026** — `2026-05-23-liaison-tneb-redesign-design.md`
- `2026-05-21` **Morning digest redesign — coordinator-led model** — _n8n_ · **Approved** · `2026-05-21-morning-digest-redesign-design.md`
- `2026-05-20` **Proposal Format Revamp — May 20, 2026** — `2026-05-20-proposal-format-revamp-design.md`
- `2026-05-20` **Marketing Hotfix — May 20, 2026** — `2026-05-20-marketing-hotfix-design.md`
- `2026-05-20` **Marketing Feedback Round 2 — May 20, 2026** — `2026-05-20-marketing-feedback-round-2-design.md`
- `2026-05-19` **Marketing Feedback Batch — Design (May 19, 2026)** — `2026-05-19-marketing-feedback-batch-design.md`
- `2026-05-02` **Tasks: Auto-create from Follow-ups + Team View + NOT NULL — Design** — `2026-05-02-tasks-followups-team-view-design.md`
- `2026-05-02` **Project Data Review Triage — Design** — `2026-05-02-project-data-review-design.md`
- `2026-05-02` **Documents Index + Drive Folder Lifecycle — Design** — `2026-05-02-documents-drive-lifecycle-design.md`
- `2026-05-01` **Zoho Orphan Triage — Design** — **Approved (Vivek), pending implementation pl…** · `2026-05-01-zoho-orphan-triage-design.md`
- `2026-05-01` **Task-Sync + Map Link + Expected Orders/Payments — Design** — `2026-05-01-task-sync-map-link-expected-orders-design.md`
- `2026-05-01` **Lead Status Fix + Payments Tracker — Design** — `2026-05-01-lead-status-fix-payments-tracker-design.md`
- `2026-04-19` **n8n Workflow Catalog — Shiroi ERP** — **Roadmap (intent captured, not yet scheduled)** · `2026-04-19-n8n-workflow-catalog.md`
- `2026-04-18` **User Settings Page — Design Spec** — **Approved for implementation planning** · `2026-04-18-user-settings-page-design.md`
- `2026-04-17` **Purchase Module v2 — Post-Ship Feedback Pass** — `2026-04-17-purchase-v2-feedback-design.md`
- `2026-04-17` **Purchase Module V2 — Design Spec** — **Approved, ready for implementation plan** · `2026-04-17-purchase-module-v2-design.md`
- `2026-04-17` **Plant Monitoring — Searchable Project Combobox** — _O&M → Plant Monitoring_ · `2026-04-17-plant-monitoring-project-combobox-design.md`
- `2026-04-17` **Finance Module V2 — Zoho Books Integration — Design Spec** — **Design approved, pending implementation plan** · `2026-04-17-finance-module-v2-zoho-design.md`
- `2026-04-17` **Expenses Module — Design Spec** — **Design approved, pending implementation plan** · `2026-04-17-expenses-module-design.md`
- `April 17, 2026` **Documentation Restructure — Design Spec** — **Approved, executed same day** · `2026-04-17-docs-restructure-design.md`
- `2026-04-16` **Plant Monitoring Module — Design Spec** — **Approved, ready for implementation planning** · `2026-04-16-plant-monitoring-design.md`
- `2026-04-15` **Category Standardisation — Design Spec** — `2026-04-15-category-standardisation-design.md`
- `2026-04-14` **Manivel PM Corrections — Combined Design Spec** — `2026-04-14-manivel-corrections-design.md`
- `2026-04-04` **PM Screens + Leads/Proposals Usability Overhaul** — `2026-04-04-pm-leads-proposals-design.md`
- `2026-04-04` **Contacts Database — Design Spec** — `2026-04-04-contacts-database-design.md`
- `April 3, 2026` **Shiroi ERP — Phase 2C Roadmap & Full Status** — **⚠️ SUPERSEDED — see docs/superpowers/plans/…** · `2026-04-03-phase2c-roadmap-design.md`
- `April 3, 2026` **HubSpot Migration V2 Fix — Design Spec** — **Approved** · `2026-04-03-hubspot-migration-v2-fix-design.md`
- `April 3, 2026` **Google Drive Proposal Migration — Design Spec** — **Approved (Approach A)** · `2026-04-03-google-drive-proposal-migration-design.md`
- `2026-03-30` **Shiroi ERP — Role-Specific Dashboards & Phase 2 Build Design** — `2026-03-30-role-dashboards-design.md`

## Plans — implementation logs (the *how*, task-by-task)

_45 files in `docs/superpowers/plans/`_

- `2026-07-20` **Purchase Flow — BOI Manager Replication Implementation Plan** — Replicate Manivel's "Bill of Items Manager" purchase flow (price book → project BOI → multi-select → instant PO + PDF)… · `2026-07-20-purchase-flow-boi-manager.md`
- `2026-06-16` **Manivel Feedback Batch 3 — Implementation Plan** — Ship Vivek's third Manivel feedback list — projects-list dashboard + ops columns, free-text projects on activities/tick… · `2026-06-16-manivel-feedback-batch3.md`
- `2026-06-11` **Project Feedback Batch 2 Implementation Plan** — Ship the 12-item feedback batch — FY filter, soft project delete, project auto-search everywhere, /tasks milestone pick… · `2026-06-11-project-feedback-batch2.md`
- `2026-06-10` **Fable Review Implementation Plan — June 10, 2026** — Work through every actionable finding in the two June-10 review docs (docs/reviews/2026-06-10-codebase-and-module-revie… · `2026-06-10-review-implementation.md`
- `2026-06-10` **Project Module Enhancements Implementation Plan** — Implement the five approved Project-module requirement areas — PM-only Project Value, BOI edit-anytime-with-audit, BOQ… · `2026-06-10-project-module-enhancements.md`
- `2026-06-08` **Team Tasks · Won→Manivel · Morning-message Implementation Plan** — Fix the Team-Tasks date/type bugs, make every Won deal spawn a project assigned to Manivel (+ backfill the 57 stranded… · `2026-06-08-team-tasks-won-handoff-morning-digest.md`
- `2026-06-08` **Leads Filters + dd/mm/yyyy Date Picker — Implementation Plan** — Replace the leads referrer filter with 3 buckets (No referrer / MGMT / Customer), build a dd/mm/yyyy calendar date-rang… · `2026-06-08-leads-filters-and-date-picker.md`
- `2026-05-30` **WhatsApp Two-Way Conversations — Plan — 2026-05-30** — `2026-05-30-whatsapp-two-way.md`
- `2026-05-30` **H3 AI Roadmap — Wave 5+ — 2026-05-30** — `2026-05-30-h3-ai-wave-5-plus.md`
- `2026-05-30` **Automated Handover Flow — Plan — 2026-05-30** — `2026-05-30-automated-handover.md`
- `2026-05-25` **H1 — WhatsApp Two-Way for Employees** — `2026-05-25-whatsapp-two-way-plan.md`
- `2026-05-25` **H2 — Automated Handover** — `2026-05-25-automated-handover-plan.md`
- `2026-05-25` **H3 — AI Roadmap (revised)** — Swap OpenAI embeddings out of the process-document Edge Function. Add Sarvam + Jina env infrastructure. · `2026-05-25-ai-roadmap-plan.md`
- `2026-05-23` **Liaison TNEB Stages Redesign Implementation Plan** — Rename discom_status values to match official TNEB stage vocabulary, add an "awaiting client" blocking flag, move ceig_… · `2026-05-23-liaison-tneb-redesign.md`
- `2026-05-23` **Inverter Integration V1 Implementation Plan** — Wire live inverter telemetry into the ERP for the three vendor families where we have a viable API path (Sungrow, Growa… · `2026-05-23-inverter-integration-v1.md`
- `2026-05-23` **Shiroi ERP — Revised Master Plan** — `2026-05-23-erp-master-plan-revised.md`
- `2026-05-21` **Morning digest redesign — implementation plan** — Replace the existing 8-workflow role-keyed morning digest set with 4 coordinator-led workflows that hit each direct rep… · `2026-05-21-morning-digest-redesign.md`
- `2026-05-19` **Marketing Feedback Batch — Implementation Plan (May 19, 2026)** — `2026-05-19-marketing-feedback-batch.md`
- `2026-05-02` **Project Data Review Triage — Implementation Plan** — Build /data-review/projects triage UI for founder + marketing_manager + project_manager to confirm system size + total… · `2026-05-02-project-data-review-plan.md`
- `2026-05-01` **Zoho Orphan Triage Implementation Plan** — Build a /cash/orphan-invoices triage UI that lets founder + finance + marketing_manager attribute the 303 unattributed… · `2026-05-01-zoho-orphan-triage.md`
- `2026-05-01` **Implementation Plan — Task Sync + Map Link + Expected Orders/Payments** — `2026-05-01-task-sync-map-link-expected-orders-plan.md`
- `2026-05-01` **Implementation Plan — Lead Status Fix + Payments Tracker** — `2026-05-01-lead-status-fix-payments-tracker-plan.md`
- `2026-04-30` **Proposal financial corruption — implementation plan** — Fix the 130-proposal total_after_discount corruption (BOM extraction picked up wrong files from co-mingled lead folders… · `2026-04-30-proposal-corruption-implementation.md`
- `2026-04-26 (initial), revised 2026-04-30` **Proposal financial corruption — investigation + recovery plan** — **REVISED 2026-04-30 — Vivek's decisions appl…** · `2026-04-26-proposal-financial-corruption-recovery.md`
- `2026-04-19` **Data Accuracy Pass — Projects, Money Received, Profitability** — Fix the broken attribution chain between ERP projects and Zoho money-movement data so that (1) every ERP project that h… · `2026-04-19-data-accuracy-pass.md`
- `2026-04-18` **User Settings Page Implementation Plan** — Build a /settings page with Account, Feedback, and (founder-only) Users tabs, and add a topbar profile dropdown as the… · `2026-04-18-user-settings-page.md`
- `2026-04-18` **Finance Module V2 — Zoho Books Integration — Implementation Plan** — Build Finance Module V2 — fill the vendor_bills schema gap, import 3 years of Zoho Books data into ERP (with fuzzy proj… · `2026-04-18-finance-module-v2-zoho-implementation.md`
- `2026-04-17` **Purchase v2 Feedback — Implementation Plan** — `2026-04-17-purchase-v2-feedback-implementation.md`
- `2026-04-17` **Purchase Module V2 — Implementation Plan** — Replace the current single-vendor procurement flow with a 5-stage competitive pipeline (BOQ → RFQ → Quote Comparison →… · `2026-04-17-purchase-module-v2-implementation.md`
- `2026-04-17` **Plant Monitoring — Searchable Project Combobox Implementation Plan** — Replace the plain <select> project picker in the Add Credential dialog and the project filter dropdown on the Plant Mon… · `2026-04-17-plant-monitoring-project-combobox.md`
- `2026-04-17` **Expenses Module Implementation Plan** — Ship the standalone Expenses module — new top-level /expenses nav, per-submitter voucher numbers, 3-stage approval work… · `2026-04-17-expenses-module-implementation.md`
- `2026-04-16` **Plant Monitoring Module Implementation Plan** — Build a new /om/plant-monitoring page that centralises solar plant monitoring-portal credentials, auto-populated from c… · `2026-04-16-plant-monitoring.md`
- `2026-04-15` **Category Standardisation Implementation Plan** — Unify BOI/BOQ/Actuals/Purchase/Price Book on Manivel's 15-category vocabulary, add a smart autocomplete combobox for it… · `2026-04-15-category-standardisation.md`
- `2026-04-14` **Manivel PM Corrections Implementation Plan** — Fix 4 batches of corrections from Manivel after PM testing — project module fixes, task/AMC/tickets corrections, PO mod… · `2026-04-14-manivel-corrections.md`
- `April 8, 2026` **Shiroi Energy ERP — Comprehensive Roadmap** — **For Vivek's review** · `2026-04-08-erp-roadmap.md`
- `2026-04-07` **WhatsApp Import Pipeline — Implementation Plan** — Build a Node.js script that parses three WhatsApp group chat ZIP exports, uses Claude API to extract structured data, a… · `2026-04-07-whatsapp-import.md`
- `2026-04-07` **PM Corrections — Implementation Plan** — Address all feedback from PM Manivel Muthu across 9 modules: Project list view, Survey form, BOM/BOQ, Delivery notes, E… · `2026-04-07-pm-corrections-plan.md`
- `2026-04-07` **PM Corrections — FINAL Implementation Plan** — Complete overhaul of the project module to match PM Manivel's specifications exactly. Fix all bugs. Build every missing… · `2026-04-07-pm-corrections-final.md`
- `2026-04-06` **Marketing Flow Redesign Implementation Plan** — Redesign the entire marketing/leads/proposals flow to be task-centric and stage-navigable, mirroring the project module… · `2026-04-06-marketing-redesign.md`
- `2026-04-05` **PM Corrections Implementation Plan** — Address all corrections from PM Manivel Muthu's feedback document — fix the projects table default columns, add missing… · `2026-04-05-pm-corrections.md`
- `2026-04-04` **PM Screens + Leads/Proposals Overhaul — Implementation Plan** — Add pagination + bulk actions to leads/proposals pages, fix PM dashboard KPIs and add missing widgets (donut chart, ope… · `2026-04-04-pm-leads-proposals-plan.md`
- `2026-04-04` **Contacts Database Implementation Plan** — Build a separate contacts + companies system with 4 new tables, 6 new pages, and contact cards on existing lead/proposa… · `2026-04-04-contacts-database-plan.md`
- `2026-04-03` **Google Drive Proposal Migration — Implementation Plan** — Migrate 1,353 proposal folders from 4 Google Drive year-folders into Supabase, syncing with 1,115 existing HubSpot-impo… · `2026-04-03-google-drive-proposal-migration.md`
- `2026-04-01` **Phase 2A: Role-Specific Dashboards Implementation Plan** — Build 8 role-adaptive dashboards, 2 new DB roles, sectioned sidebar navigation, founder role switcher, universal My Tas… · `2026-04-01-phase2a-role-dashboards.md`
- `2026-03-30` **Shiroi ERP — Phase 1 Complete Build Plan** — Build all of Phase 1 — from design system through data migration — so Vivek can open the ERP at 8am and see cash-negati… · `2026-03-30-phase1-complete-build.md`

## Reviews — audits & multi-area sweeps

_16 files in `docs/reviews/`_

- `2026-07-25` **Price Book — FY26-27 rate card import (2026-07-25)** — `2026-07-25-price-book-fy26-27-import.md`
- `2026-07-19` **ERP Speed — Full Report (Code + Infrastructure)** — `2026-07-19-erp-speed-full-report.md`
- `2026-06-19` **Page-Load Performance Audit & Suggested Changes** — `2026-06-19-page-load-perf-audit.md`
- `2026-06-18` **UI Theming Audit — How Centralized Are Colours & Fonts?** — `2026-06-18-ui-theming-audit.md`
- `2026-06-18` **Redundancy Sweep — Pending Decisions (for Vivek)** — `2026-06-18-redundancy-pending-decisions.md`
- `2026-06-18` **Projects & Leads — tables/search slowness (2026-06-18)** — `2026-06-18-projects-leads-search-perf.md`
- `2026-06-18` **ERP-wide Redundancy Sweep — Findings** — `2026-06-18-erp-redundancy-sweep.md`
- `2026-06-16` **Overnight build — Manivel sheet reconciliation + Command Center (2026-06-16)** — `2026-06-16-overnight-reconciliation-build.md`
- `2026-06-15` **Manivel Sheet ↔ ERP Reconciliation (2026-06-15)** — `2026-06-15-manivel-erp-reconciliation.md`
- `2026-06-10` **Deep Review — Security, Live DB, Tests, Deps, n8n, A11y, DR/DPDP — June 10, 2026** — `2026-06-10-deep-review-security-ops-data.md`
- `2026-06-10` **Codebase + Module-by-Module Review — June 10, 2026** — `2026-06-10-codebase-and-module-review.md`
- `2026-06-06` **Credential Leak Remediation — 2026-06-06** — `2026-06-06-credential-leak-remediation.md`
- `2026-05-30` **Comprehensive Overnight Review — 2026-05-30** — `2026-05-30-overnight-comprehensive-review.md`
- `2026-05-25` **Drive Folder Backfill Design Note — 2026-05-25** — `2026-05-25-drive-folder-backfill-design.md`
- `2026-05-24` **Plan-vs-Build Review — 2026-05-24** — `2026-05-24-plan-vs-build.md`
- `2026-05-24` **Comprehensive Code Review — 2026-05-24** — `2026-05-24-comprehensive-review.md`
