# Shiroi Energy ERP — Claude Code Context

> Read this file fully before writing a single line of code.
> For full detail on any section, read: `docs/SHIROI_MASTER_REFERENCE_3_0.md`

---

## WHO AND WHAT THIS IS

**Shiroi Energy Private Limited** — Solar EPC company, Chennai, Tamil Nadu, India.
Rooftop solar installation (residential, commercial, industrial). 500+ completed projects.
~50 employees. Systems: on-grid, hybrid (with battery), off-grid.

**This ERP is single-tenant. Built for Shiroi only. No `company_id` on any table. Ever.**

Founder: Vivek. He reviews every file before commit. No autonomous pushes to production.

---

## CURRENT STATE (as of April 10, 2026)

| Item | Status | Detail |
|------|--------|--------|
| GitHub repo | ✅ Live | github.com/Shiroi-Energy-LLP/shiroi-erp (private) |
| Monorepo | ✅ Complete | Turborepo + pnpm, all packages wired |
| Next.js ERP app | ✅ Running | apps/erp on localhost:3000 |
| Supabase dev | ✅ Live | actqtzoxjilqnldnacqz.supabase.co |
| Supabase prod | ✅ Live | kfkydkwycgijvexqiysc.supabase.co |
| Database schema | ✅ Complete | 137+ tables, 91+ triggers, RLS on ALL tables |
| TypeScript types | ✅ Generated | packages/types/database.ts — regenerated Apr 10 with project_bois table + boi_id on project_boq_items |
| Migrations | ✅ Committed | supabase/migrations/ — 39 files (001 through 036) |
| Supabase client | ✅ Complete | packages/supabase — browser, server, admin, middleware clients |
| Design system | ✅ Complete | packages/ui — V2 design system, 22 components (Logo, Eyebrow, EmptyState, Skeleton, Breadcrumb, SkipToContent, Sheet, Tooltip, DropdownMenu, Tabs, Form + original 11) |
| Auth + App Shell | ✅ Complete | Login (with logo), middleware, collapsible sidebar (240px/60px + mobile drawer), topbar with role switcher, skip-to-content |
| Phase 1A Screens | ✅ Complete | Founder dashboard, leads, proposals, projects, procurement, cash, HR, daily reports |
| Phase 2A Dashboards | ✅ Complete | 8 role-adaptive dashboards, PM 10-step stepper |
| Phase 2B All Screens | ✅ Complete | 57+ routes total — all sidebar links are real data-driven pages, 0 placeholders |
| Sentry | ✅ Live | @sentry/nextjs v10, client+server+edge+onRequestError, DSN in .env.local |
| Migration 010 | ✅ Applied (dev) | lead_status 'converted' + project_site_expenses + project-files bucket |
| Migration 011 | ✅ Applied (dev) | `design_confirmed` added to `lead_status` enum after `proposal_sent` |
| Migration 012 | ✅ Applied (dev) | `lead_status_history.changed_by` now nullable for system/migration operations |
| Migration 013 | ✅ Applied (dev) | proposal-files storage bucket — prod pending |
| Migration 014 | ✅ Applied (dev) | is_budgetary, tariff_escalation_pct, notifications table — prod pending |
| Migration 015 | ✅ Applied (dev) | Price book seeded: 35 items, 14 correction factors — prod pending |
| Migration 017 | ✅ Applied (dev) | Contacts V2: first_name/last_name, lifecycle_stage, secondary_phone, source, owner_id; Companies: pan, industry, company_size, owner_id; Activities + activity_associations tables |
| Migration 018 | ✅ Applied (dev) | table_views: saved views for HubSpot-style column/filter/sort persistence per user |
| Data migration | ✅ Complete | 108 vendors, ~160 projects, 850 POs (2,348 items), 1,164 expenses, 916 files from Google Drive |
| HubSpot cutover | ✅ Complete (V2) | 1,115 leads, 314 projects, 314 proposals, 30 payments migrated. 0 unmatched payments. |
| Contacts V2 | ✅ Complete | HubSpot-style person/company separation, lifecycle stages, activity timeline, edit pages, smart backfill (~1,115 contacts, ~56 companies from leads) |
| Contact dedup | ✅ Complete | 284 duplicate contacts merged by phone, 0 remaining duplicates. 756→1,115 contacts after dedup+backfill |
| Contact backfill | ✅ Complete | 367 leads without contacts backfilled — 364 created/linked, 3 junk leads excluded |
| HubSpot-style DataTable | ✅ Complete | Reusable across leads/proposals/projects/contacts/companies. Column picker (search + drag-reorder), saved views (tabs), URL-driven sort/pagination, checkbox selection, inline editing |
| DataTable all entities | ✅ Complete | Projects, Contacts, Companies pages converted from standard tables to HubSpot-style DataTable with column picker + saved views |
| Inline editing | ✅ Complete | Double-click-to-edit cells in DataTable. Supports text, number, select, date, phone, email fields. Server action with RLS enforcement |
| Proposal engine | ✅ Implemented | Quick Quote, BOM generator (9 tests), budgetary + detailed PDF (10 pages), savings page, price override modal, PDF API route, notifications CRUD |
| Proposal files | ✅ Complete | Upload/download files on proposal detail page via Supabase Storage |
| Leads filtering | ✅ Complete | Converted leads hidden by default, visible via filter |
| Leads page v3 | ✅ Complete | Stage-based pipeline nav, weighted pipeline summary, 19 configurable columns (added expected_close_date, close_probability, weighted_value) |
| Proposals page v2 | ✅ Complete | HubSpot-style DataTable with column picker, saved views, 12 configurable columns |
| PM Dashboard v2 | ✅ Complete | Correct KPIs (System Size, Clients, Sales, Profit %), donut chart, operations widget, dark today panel |
| Vercel + domain | ✅ Live | erp.shiroienergy.com — deployed against DEV Supabase, auto-deploys on push |
| Employee admin page | ✅ Complete | /hr/employees/new — create accounts (auth + profile + employee), deactivate button, temp password generation |
| Data integrity check | ✅ Complete | Step 43: FK validation, orphan detection, financial integrity, MSME compliance, status consistency |
| Project file upload | ✅ Complete | Step 50: Drag-drop upload on project detail, 6 categories, signed URL download, Supabase Storage |
| AI daily report narrative | ✅ Complete | Step 61: Claude API integration (claude-sonnet-4-20250514), structured prompt, generate/regenerate on report detail |
| Net metering + CEIG workflow | ✅ Complete | Step 64: Full CEIG/DISCOM/net-meter forms, followup tracking, objection log, CEIG gate enforcement UI |
| Handover pack | ✅ Complete | Step 65: Auto-generate structured JSON from project data, versioned in generated_documents, warranty/checklist/system summary |
| Inventory cut-length tracking | ✅ Complete | Step 67: /inventory dashboard + detail, cut-length gauge, location/scrap management, low-stock alerts |
| UI/UX Overhaul R1 | ✅ Complete | 15 improvements: Logo SVG, Eyebrow, EmptyState (23 pages), Skeleton (7 loading.tsx), Breadcrumbs (4 detail pages), Radix Dialog upgrade, Sheet/Tooltip/DropdownMenu/Tabs, sidebar collapse+mobile drawer, table overflow, toast notifications, Form component (react-hook-form+Zod), column picker drag-drop feedback, skip-to-content, visited links, responsive fonts, reduced motion |
| UI/UX Overhaul R2 | 🔜 In Progress | Color token cleanup (339 hex→token replacements), remaining EmptyState (15), loading.tsx (~15), Eyebrow (25), Breadcrumbs (4), Toast (4), form conversions (4) |
| Route fix (deployment) | ✅ Complete | Added missing page.tsx for /om and /projects/[id]/reports/[reportId] — fixed parallelRoutes.get TypeError |
| Marketing redesign | ✅ Complete | Stage-based leads pipeline, weighted pipeline KPIs, tab-based lead detail (Details/Activities/Tasks/Proposal/Files/Payments), task-centric follow-up workflow, mandatory follow-up dates, default close probabilities |
| Payments overview page | ✅ Complete | Project payments tracker with P&L, payment stages, next milestone amounts, expected collections this week/month, invested vs received, filter by active/outstanding |
| Migration 020 | ✅ Applied (dev) | Pipeline fields: expected_close_date, close_probability, is_archived on leads + indexes |
| Migration 021 | ✅ Applied (dev) | Payment follow-up trigger: auto-creates tasks when project reaches payment milestone stages |
| Migration 022a | ✅ Applied (dev) | Fix file delete RLS: expands DELETE policies on project-files and site-photos buckets (PM corrections) |
| Migration 022b | ✅ Applied (dev) | Data cleanup: junk lead deletion, deterministic SQL fixes, processing_jobs table (data quality) |
| Migration 023a | ✅ Applied (dev) | Survey form overhaul: ~25 new columns (GPS, roof details, electrical, shading, signatures) (PM corrections) |
| Migration 023b | ✅ Applied (dev) | Expanded BOM item_category CHECK constraint for Excel parsing (data quality) |
| Migration 024a | ✅ Applied (dev) | BOQ items + delivery challans: project_boq_items, delivery_challans tables (PM corrections) |
| Migration 024b | ✅ Applied (dev) | Storage mime type fix function (update_storage_mime_type RPC) (data quality) |
| Migration 025 | ✅ Applied (dev) | WhatsApp import queue: whatsapp_import_queue table with RLS, 5 indexes, review workflow |
| Migration 026 | ✅ Applied (dev) | site_photos: project_id nullable, added lead_id for lead-only photos |
| Data quality overhaul | ✅ Complete | Full 7-phase plan executed. See details below |
| BOM extraction | ✅ Complete | 35,022 BOM lines across 629 proposals (Excel costing sheets + Google Drive Bill of Items) |
| Google Drive sync | ✅ Complete | 180 confirmed project folders synced: 119 BOM, 81 project dates/brands, 159 margins, 12 lead addresses |
| Google Drive file sync | ✅ Complete | 1,344 files from 159 confirmed projects → Supabase project-files bucket. 881 old-path files fixed. **2,151 total files across 136 projects**, 0 orphans |
| Migration 027b | ✅ Applied (dev) | Expanded project-files bucket mime types (DWG, DOCX, XLSX, PPTX, video, SketchUp) + 100MB limit |
| Doc extraction | ✅ Complete | 707 Word/PDF proposals parsed → 496 leads + 114 proposals enriched |
| Proposal creation | ✅ Complete | 410 new proposals created from extracted doc data (341→751 total proposals) |
| Owner assignment | ✅ Complete | All 1,126 leads now have assigned_to (10 Vivek, 1,116 Prem from HubSpot deal owner + default) |
| Photo registration | ✅ Complete | 1,290 site photos registered (170 with projects + 1,120 lead-only via migration 026) |
| Octet-stream fix | ✅ Complete | 685 mistyped files reclassified (SketchUp, Layout, PPTX, video) |
| HubSpot enrichment | ✅ Complete | Close dates, owner assignment, contacts/companies enrichment from CSV exports |
| Deleted lead restore | ✅ Complete | 10 real leads restored (PV264/RWD, 50MWp, Ramakrishna, Ravi, etc.), 11 junk leads kept soft-deleted |
| PM Corrections R2 | ✅ Complete | QC/Liaison/Status constraint fixes, commissioning edit, task completion toggles, tasks page overhaul, O&M visits overhaul, PDF hardening |
| WhatsApp import pipeline | ✅ Complete | Rule-based extraction from 3 group chats. 4,164 records extracted + enriched + approved. Script: `scripts/whatsapp-import/extract-local.ts` |
| WhatsApp data extracted | ✅ Complete | Marketing: 152 records (50 payments, 30 POs, 32 contacts, 40 activities). LLP: 186 records (115 BOQ items, 27 POs, 15 payments, 4 vendor_payments). Shiroi Energy ⚡: 3,826 records (403 daily reports, 3,100 activities, 298 contacts, 25 financial). |
| WA Import Queue UI | ✅ Complete | /whatsapp-import — stats grid, paginated review table, approve/reject/reassign actions. Sidebar link for founder/finance/purchase_officer. |
| WA queue approval | ✅ Complete | All 4,164 queue records enriched + auto-approved into target tables. Activities: 0→3,320. Daily reports: 0→210. Contacts: +275 (1,390 total, 0 phone dupes). BOQ items: +135 (251 total). Payments: +40 (70 total). Approval action bugs fixed (FK, missing cases). Script: `scripts/whatsapp-import/enrich-and-approve.ts` |
| BOM category fix | ✅ Complete | Fixed item_category CHECK constraint violation — dropdown now sends DB-valid snake_case values instead of display labels |
| AMC module visibility | ✅ Complete | AMC Schedule added to founder + om_technician sidebar; /om/amc page enhanced with upcoming visits table + summary cards; AMC This Month card on founder dashboard |
| Proposals timeout fix | ✅ Complete | Added idx_proposals_created_at index, count:estimated, optimized join — fixes Sentry timeout on /proposals with 751 rows |
| Project file visibility | ✅ Complete | Fixed 3 issues hiding 9,845 files from project page: (1) path prefix mismatch for 909 GDrive files, (2) missing categories (purchase-orders, layouts, delivery-challans, sesal), (3) 7,636 lead files in proposal-files bucket now shown via new LeadFiles component |
| Image viewer lightbox | ✅ Complete | Click any image in ProjectFiles or LeadFiles → full-screen modal with prev/next arrows, keyboard navigation, download button. Built with Radix Dialog, no new dependencies |
| WhatsApp photos on project page | ✅ Complete | ProjectFiles now scans site-photos bucket for `projects/{id}/whatsapp/` media. 196 WhatsApp photos across 54 projects surfaced |
| Migration 027a | ✅ Applied (dev) | tasks: category, remarks, assigned_date columns + task_work_logs table with RLS |
| Task module overhaul | ✅ Complete | Edit/delete tasks, category field (10 milestone-aligned categories), remarks, done-by column, daily work logs with expandable timeline, category filter |
| Performance overhaul | ✅ Complete | Fixed 7+ statement timeouts: migration 028 (6 indexes + 3 RPC functions), eliminated duplicate getProject(), payments query filtered by lead_ids, 3 JS aggregations→SQL RPCs, 13 pages paginated, ProjectFiles parallel storage calls, stepper queries parallelized |
| Migration 028 | ✅ Applied (dev) | Performance indexes (daily_site_reports, leads pipeline, proposals lead+status, cash positions, BOM lines, projects status) + RPC functions (get_lead_stage_counts, get_company_cash_summary, get_msme_due_count) |
| List page timeout fix | ✅ Complete | 5 paginated pages changed from count:'exact' to count:'estimated' (projects, leads, contacts, companies, whatsapp-import) — prevents full table scan on every page load |
| Migration 029 | ✅ Applied (dev) | 4 sort-column indexes: idx_projects_created_at, idx_leads_created_at, idx_contacts_created_at, idx_whatsapp_queue_timestamp (all DESC) |
| Middleware timeout fix | ✅ Complete | Excluded /login from middleware matcher; added 5s Promise.race timeout to getUser() — prevents MIDDLEWARE_INVOCATION_TIMEOUT when Supabase Auth is slow |
| Migration 029 | ✅ Applied (dev) | data_flags table (entity flagging system), data_verified_by/at columns on leads/projects/proposals, get_flag_count + get_data_flag_summary RPCs |
| Migration 030 | ✅ Applied (dev) | BOI/BOQ project fields: boi_locked, boi_locked_at, boi_locked_by, boq_completed, boq_completed_at, project_cost_manual on projects + idx_project_boq_items_category |
| Migration 031 | ✅ Applied (dev) | Project status overhaul: collapse 11→8 statuses (order_received, yet_to_start, in_progress, completed, holding_shiroi, holding_client, waiting_net_metering, meter_client_scope). FK fix on log_project_status_change (lookup employee_id by profile_id). Auto-create Project trigger on proposal acceptance. idx_projects_active rebuilt with new enum literals. |
| BOI module overhaul V2 | ✅ Complete | Multi-version BOI (BOI-1, BOI-2, etc.) with draft→submitted→approved→locked workflow. Migration 036: project_bois table with versioning, boi_id FK on project_boq_items, RLS, backward compat (508 items auto-linked). 14 Manivel categories, per-BOI category filter (DOM-based), prepared-by/approved-by/locked-by display, inline add/delete for draft BOIs only, Create New BOI when latest is locked |
| Migration 036 | ✅ Applied (dev) | BOI versioning: project_bois table (id, project_id, boi_number, status, prepared_by, approved_by, locked_by, timestamps), boi_id FK on project_boq_items, RLS policies, backward compat data migration |
| BOQ Budget Analysis V2 | ✅ Complete | 5-card summary (Project Cost, Material Budget, Site Expenses, Total Outflow, Final Margin %), category-wise breakdown table with subtotals (excl/incl GST), Send to Purchase button (bulk yet_to_finalize→yet_to_place), Auto-Price from Price Book, site expenses integrated in margin calc, compact 12px table with Amount excl. GST + Total incl. GST columns |
| Delivery Note overhaul | ✅ Complete | "Create DC" button auto-fetches Ready to Dispatch items, checkbox selection with adjustable quantities, transport details form, DC history with DC1/DC2 numbering |
| Projects screen overhaul | ✅ Complete | Per Manivel's simplified spec: remarks column hidden by default, `formatProjectNumber` strips SHIROI/PROJ/ prefix, customer_name clickable → project detail, 8-status filter dropdown, FK error on status inline-edit fixed (migration 031), auto-create Projects from accepted Proposals. 14 files updated (column-config, data-table, projects/page, profitability/page, payments/page, payments-overview-queries, amc-actions, dashboard-queries, pm-queries, project-step-actions, tasks-actions, project-status-badge, pm-donut-chart, advance-status-button, project-status-helpers). |
| Data flag system | ✅ Complete | DataFlagButton component (reusable), data-flag-actions.ts (create/resolve/query flags, verify entity), resolve-button for dashboard |
| Data Quality dashboard | ✅ Complete | /data-quality — summary cards (unresolved/resolved/verified), flags-by-entity breakdown, filterable flags table with resolve action, pagination |
| Data Quality sidebar | ✅ Complete | Added to founder, purchase_officer, finance sidebar (Admin section). Flag + MessageSquare icons registered in sidebar |
| Inline editing expansion | ✅ Complete | Projects: 8 new editable cols. Proposals: 4. Contacts: 3 new. New configs: Vendors (14 cols/10 editable), POs (8), BOM (9/7 editable). inline-edit-actions extended for vendors/POs/BOM |
| BOM Review page | ✅ Complete | /bom-review — 35K BOM lines, category filters, summary cards (total/with rate/missing rate/flagged), inline editing, flag button per row, pagination |
| Design Queue | ✅ Complete | /design wired to leads with status site_survey_done/design_confirmed, KPI cards, link to design workspace |
| Price Book | ✅ Complete | /price-book wired to price_book_items table (35 seeded items), full data table with category/unit/rates |
| Liaison index | ✅ Complete | /liaison wired to net_metering_applications — summary cards (total/pending CEIG/pending net meter/approved) + link to sub-page |
| PO Detail page | ✅ Complete | /procurement/[poId] — vendor info, line items table, delivery challans, vendor payments, data flag button |
| Finance CRUD | ✅ Complete | finance-actions.ts (createInvoice, recordPayment, recordVendorPayment), CreateInvoiceDialog + RecordPaymentDialog, wired on invoices + payments pages |
| File flagging | ✅ Complete | DataFlagButton added to ProjectFiles, LeadFiles, and LeadFilesList — flag icon on hover per file row |
| Create PO flow | ✅ Complete | CreatePODialog: project/vendor selector, dynamic line items (add/remove), category/description/qty/rate/GST, auto-totals. procurement-actions.ts with auto-generated PO number |
| BOI/BOQ/DC tab fix | ✅ Complete | Fixed crash: BOI_CATEGORIES exported from 'use client' file but used in server components — moved to shared lib/boi-constants.ts. Migration file renamed 028→030 to avoid collision |
| Edit Task enhancements | ✅ Complete | Searchable project dropdown (type-to-filter 200+ projects), Done By employee field (auto-marks task completed with timestamp) |
| Migration 032 | ✅ Applied (dev) | Fix create_payment_followup_tasks trigger: `p.status IN ('approved', 'accepted')` → `p.status = 'accepted'` ('approved' is not a valid proposal_status enum value). Was blocking status transitions to in_progress / completed / waiting_net_metering. |
| Projects page bug fixes | ✅ Complete | (1) Pagination bug: SearchInput debounce effect was resetting page=1 on any URL change — fixed by adding early return when `value === urlValue`. (2) Status change errors on in_progress/completed/waiting_net_metering: fixed via migration 032. (3) Bulk actions: status-change dropdown on selection action bar via new `bulkUpdateField` server action. |
| Sticky filter bars | ✅ Complete | Added `sticky top-0 z-20 shadow-sm` to the filter Card on all 12 paginated list pages (projects, leads, proposals, contacts, companies, invoices, procurement, profitability, payments/receipts, tasks, vendors, inventory). Removed redundant Eyebrow + h1 header block from Projects page — topbar already shows "Projects". |
| Migration 033 | ✅ Applied (dev) | Project detail fields: scope_la/scope_civil/scope_meter (shiroi\|client), cable_brand/cable_model, billing_address, location_map_link, order_date, primary_contact_id FK→contacts. project_site_expenses: voucher_number, expense_category, status (pending/approved/rejected/auto_approved), submitted_by/at, approved_by/at, rejected_reason, receipt_file_path. Existing rows marked auto_approved. Indexes on (status, submitted_at) + (project_id). |
| Migration 034 | ✅ Applied (dev) | `estimated_site_expenses_budget NUMERIC(14,2)` on projects — PM-editable planning figure for general site expenses (travel/food/lodging/labour advances), baseline against actual vouchers in BOQ budget analysis. |
| Project detail page overhaul | ✅ Complete | Per Manivel's spec: (1) Status dropdown in header matches 8-status list (editable in-place). (2) Dropped AdvanceStatusButton — replaced with 12-stage horizontal ProjectStepper highlighting completed stages via Check icon (derived from boi_locked, boq_completed, commissioning, etc.). (3) Editable boxes on Details tab: FinancialBox (role-gated PM/founder/finance/marketing, shows contracted value + actual expenses + margin %), SystemConfigBox (size, type, mounting structure with Manivel's 5 options, panel/inverter/battery/cable brand+model, scope_la/civil/meter shiroi\|client, remarks), CustomerInfoBox (contact picker w/ debounced search → primary_contact_id, site addr, billing addr, Google Maps link), TimelineTeamBox (6 date fields + PM + supervisor dropdowns, order_date replaces planned_start label). (4) New Documents tab merges HandoverPack + ProjectFiles + LeadFiles (proposal-files bucket). (5) Removed: Notes card, Milestones/Delays/Change Orders/Reports tabs, side PDF link. |
| Vouchers approval queue | ✅ Complete | New `/vouchers` page — consolidated PM/founder/finance review for site expense vouchers. KPI strip (pending count, pending total, projects with pending), grouped table with Approve + Reject (with reason) actions via Dialog. Sidebar link added to founder, project_manager, finance under new "Approvals" section. site-expenses-actions.ts: submit/approve/reject/getPending/getProject. voucher-actions.tsx client component. Receipt icon in sidebar ICON_MAP. |
| Actuals step | ✅ Complete | New stepper step between Execution and QC. StepActuals: KPI strip (BOQ Total, Site Expenses approved, Actuals Total, Margin % with color coding green≥15 / amber≥5 / red<5), BOQ items table auto-populated from project_boq_items, inline SiteExpenseForm for voucher submission (category / amount / date / description), voucher history with status badges. 12-stage stepper now: Details → Survey → BOI → BOQ → Delivery → Execution → Actuals → QC → Liaison → Commissioning → Free AMC → Documents. |
| BOI estimated site expenses | ✅ Complete | New card at bottom of BOI step — `EditableField` for estimated_site_expenses_budget (single aggregate NUMERIC), formatINR display, explanation sidebar. Feeds into BOQ budget analysis baseline + Actuals step margin calculation. |
| Documents tab overhaul | ✅ Complete | Project detail Documents tab rewritten: separate Card boxes per file category (12 categories + WhatsApp), compact squarish Handover box, Customer Documents box (with lead/proposal files), Site Photos slideshow (auto-rotating carousel), drag-and-drop recategorization between boxes (Supabase Storage move), upload dropdown matches new category list, Excel/Costing as separate box. Categories: Customer Documents, Site Photos, AutoCAD/Design, Layouts/Designs, Purchase Orders, Invoices, Delivery Challans, Warranty Cards, Excel/Costing, Documents/Approvals, SESAL, General. |
| Prod deployment | 🔜 Next | After employee testing week on dev, clone schema to prod |

**Current phase: 3 — Advanced Features + Deployment**
Phase 2C complete. Phase 3 items (61, 64, 65, 67) implemented. Marketing redesign complete.
PM Corrections R2 complete. Data quality overhaul complete: proposals 341→751, BOM lines 7→35,022 (629 proposals), photos 0→1,290.
Google Drive sync: 180 confirmed projects — BOM from Bill of Items, dates, panel/inverter brands, margins, addresses extracted. File sync: 2,151 project files across 136 projects (1,344 from Google Drive + 881 path-fixed).
WhatsApp import pipeline complete: 4,164 records from 3 group chats extracted, enriched, and approved into target tables (activities 3,320, daily reports 210, contacts +275, BOQ items +135, payments +40).
WhatsApp import plan: `docs/superpowers/plans/2026-04-07-whatsapp-import.md`
BOI/BOQ/DC overhaul complete per Manivel's spec: 14 BOI categories, submit/lock, inline BOQ editing, budget analysis with margin calculation, create DC from ready items.
Data verification system complete: data_flags table, DataFlagButton component, /data-quality dashboard, BOM review page.
Inline editing expanded to all key tables: projects (8), proposals (4), vendors (10), POs, BOM (7 editable).
All placeholder pages wired: Design Queue, Price Book, Liaison index now data-driven.
PO detail page complete. Finance CRUD complete (create invoice + record payment + vendor payment).
File flagging complete on all file components. Create PO flow complete with multi-line item form.
Next: Zoho Books import (awaiting CSV exports from Vivek), employee testing week setup.
Performance overhaul complete: 7+ statement timeouts eliminated. 6 indexes, 3 RPC functions, 24 files optimized.
Middleware timeout fixed: /login excluded from matcher, getUser() has 5s timeout to prevent MIDDLEWARE_INVOCATION_TIMEOUT.
WhatsApp import plan: `docs/superpowers/plans/2026-04-07-whatsapp-import.md`

---

## MONOREPO STRUCTURE

```
shiroi-erp/                        ← root, pnpm workspace
├── apps/
│   ├── erp/                       ← Next.js 14 ERP web app ✅
│   │   ├── src/app/               ← App Router pages
│   │   ├── src/components/        ← ERP-specific components
│   │   └── src/lib/               ← utilities, helpers
│   └── mobile/                    ← React Native + Expo (empty, built later)
├── packages/
│   ├── types/                     ← database.ts — auto-generated, never edit
│   ├── supabase/                  ← Supabase client factory ✅ (browser, server, admin, middleware)
│   ├── ui/                        ← Design system (Shiroi brand + shadcn/ui)
│   ├── eslint-config/
│   └── typescript-config/
├── supabase/
│   └── migrations/                ← 28+ SQL files (001–012) — source of truth for schema
├── docs/                          ← Reference documents (read-only, do not edit)
│   ├── SHIROI_MASTER_REFERENCE_3_0.md
│   ├── Shiroi_ERP_Design_System.md  ← V2 design system (merged, single source of truth)
│   ├── Shiroi_Energy_Brand_Guide_V6.html
│   └── [AI Studio TSX reference files]
├── reference/                     ← AI Studio TSX output (reference only, not wired in)
├── .env.local                     ← secrets — NEVER commit, NEVER touch
├── CLAUDE.md                      ← this file
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## TECHNOLOGY STACK — LOCKED, NO DEBATE

| Layer | Technology |
|-------|-----------|
| ERP web | Next.js 14 + TypeScript, App Router |
| Mobile | React Native + Expo SDK 51+ (built later) |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (employees: email+password, customers: phone OTP) |
| File storage | Supabase Storage — database holds path strings ONLY |
| Backend logic | Supabase Edge Functions (Deno/TypeScript) |
| Offline sync | WatermelonDB (mobile only) |
| Automation | n8n self-hosted on spare laptop (port 5678) |
| ERP hosting | Vercel |
| UI components | shadcn/ui + Tailwind CSS |
| Simulation | NREL PVWatts API (primary) → PVLib microservice at port 5001 (fallback) |
| AI narrative | Claude API, model: claude-sonnet-4-20250514 |
| Financial math | decimal.js — never native JS floats for money |

---

## ENVIRONMENT VARIABLES (names only — values in .env.local)

```bash
# DEV
NEXT_PUBLIC_SUPABASE_URL=https://actqtzoxjilqnldnacqz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # client-side safe
SUPABASE_SECRET_KEY=sb_secret_...                          # server/edge ONLY

# PROD
PROD_SUPABASE_URL=https://kfkydkwycgijvexqiysc.supabase.co
PROD_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
PROD_SUPABASE_SECRET_KEY=sb_secret_...

# SENTRY
NEXT_PUBLIC_SENTRY_DSN=           # client-side — must have NEXT_PUBLIC_ prefix
SENTRY_DSN=                       # server-side / build plugin
SENTRY_ORG=                       # Sentry org slug
SENTRY_PROJECT=                   # Sentry project slug

# INTEGRATIONS
ANTHROPIC_API_KEY=
PVWATTS_API_KEY=
PVLIB_MICROSERVICE_URL=           # http://[spare-laptop-ip]:5001
N8N_WEBHOOK_SECRET=
```

**Key format rule:** New Supabase format only. `sb_publishable_` replaces legacy `anon`. `sb_secret_` replaces legacy `service_role`. Do not use legacy key names anywhere.

---

## CODING STANDARDS — NON-NEGOTIABLE

### Error handling — always name the operation

```typescript
export async function someFunction(id: string) {
  const op = '[someFunction]';
  console.log(`${op} Starting for: ${id}`);
  try {
    if (!id) throw new Error(`${op} Missing required parameter: id`);
    // ... work
  } catch (error) {
    console.error(`${op} Failed:`, {
      id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}
```

### Supabase queries — handle error and null separately

```typescript
const { data, error } = await supabase
  .from('projects')
  .select('*, milestones:project_milestones(*)')
  .eq('id', projectId)
  .single();

if (error) {
  console.error('[getProject] Query failed:', { code: error.code, message: error.message, projectId });
  throw new Error(`Failed to fetch project: ${error.message}`);
}
if (!data) { console.warn('[getProject] Not found:', { projectId }); return null; }
return data;
```

### Financial calculations — decimal.js always

```typescript
import Decimal from 'decimal.js';
// NEVER: const gst = 10000 * 0.18  ← floating point error
const amt = new Decimal('10000.00');
const gst = amt.mul('0.18');
const total = amt.add(gst);
```

### Indian number formatting

```typescript
function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount); // → ₹1,23,456
}
function shortINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000)    return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000)      return `₹${(amount / 1_000).toFixed(0)}K`;
  return `₹${amount}`;
}
```

### Dates — UTC stored, IST displayed

```typescript
// Store: UTC ISO strings (timestamps) or 'YYYY-MM-DD' strings (date-only)
// Display: always convert to IST for Indian users
function toIST(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }); // → "20 Mar 2025, 02:30 PM"
}
```

### UUID — generate on client, not server

```typescript
// Enables offline record creation on mobile
const newRecord = {
  id: crypto.randomUUID(),
  created_on_device_at: new Date().toISOString(),
};
```

### Supabase client — use packages/supabase factory

```typescript
// BROWSER — client components. Singleton. RLS enforced.
import { createClient } from '@repo/supabase/client';
const supabase = createClient();

// SERVER — server components, Server Actions, Route Handlers. RLS enforced.
import { createClient } from '@repo/supabase/server';
const supabase = await createClient();

// ADMIN — server only. Bypasses RLS. Use ONLY for system automation, nightly aggregations.
import { createAdminClient } from '@repo/supabase/admin';
const supabase = createAdminClient();

// MIDDLEWARE — session refresh in apps/erp/src/middleware.ts
import { updateSession } from '@repo/supabase/middleware';
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}
```

### Sensitive fields — never in logs

Never log: `bank_account_number`, `aadhar_number`, `pan_number`, `gross_monthly`,
`basic_salary`, `ctc_monthly`, `ctc_annual`, `net_take_home`, `commission_amount`, `pf_employee`.

---

## NEVER DO — ABSOLUTE RULES

1. **Never hardcode** env variables, API keys, or Supabase project IDs in source files
2. **Never commit** `.env.local` — it is gitignored, never touches git
3. **Never use `any`** TypeScript type — always type properly using `packages/types/database.ts`
4. **Never bypass RLS** with secret key except for explicitly labelled admin/system operations
5. **Never use floats** for monetary values — always `decimal.js` or `NUMERIC(14,2)` in SQL
6. **Never edit** `packages/types/database.ts` by hand — it is auto-generated from live schema
7. **Never store files** in the database — Supabase Storage for files, DB stores path strings only
8. **Never write SQL** directly inside React components or page files
9. **Never push** directly to main — feature branch → PR → review → merge (once branching is set up)
10. **Never run** untested migrations on prod — dev first, verify, then prod

---

## DATABASE — KEY FACTS

- **134 tables**, 91 triggers, RLS on every table (verified March 29, 2026)
- **All migrations committed** to `supabase/migrations/` — 28+ files (001 through 012)
- **Run migrations** by pasting SQL into Supabase SQL Editor dashboard — no CLI needed
- **After every schema change**, regenerate types:
  ```bash
  npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
  ```

### System spine (how tables connect)

```
leads → proposals → projects → commissioning_reports → project_handovers
                                       ↓
                              om_contracts → om_visit_schedules → om_visit_reports
                                       ↓
                              customer_checkins → lead_referrals → (back to leads)
```

### The 10 roles (app_role enum)

`founder` | `hr_manager` | `sales_engineer` | `designer` | `project_manager` |
`purchase_officer` | `site_supervisor` | `om_technician` | `finance` | `customer`

**Handoff chain:** Sales → Designer → Sales (closure) → PM (BOM) → Purchase (PO, delivery) → PM (execution) → Supervisor (daily) → PM (QC, commissioning) → O&M

### Three-tier immutability model

- **Tier 1** — freely editable with audit log (operational records, proposals in draft)
- **Tier 2** — correction-by-new-record after lock period (daily site reports after 48h, approved proposals)
- **Tier 3** — immutable forever (invoices, payments, POs, salary history — corrections via counter-entries only)

### Financial year

April 1 boundary. All document numbers reset April 1.
Format: `SHIROI/INV/2025-26/0042`

---

## UI / DESIGN RULES

### Design assets (read before building any screen)

- Design system: `docs/Shiroi_ERP_Design_System.md` and `docs/Shiroi_ERP_Design_System.html`
- Brand guide: `docs/Shiroi_Energy_Brand_Guide_V6.html`
- AI Studio reference screens: `docs/` or `reference/` folder — use as reference for layout intent only

### Three surfaces

| Surface | Device | Style |
|---------|--------|-------|
| ERP web | Desktop | Dense, data-rich. Sidebar nav. Tables not cards. |
| Mobile field app | Smartphone | Large touch targets, offline-capable. Bottom tab nav. |
| Customer app | Smartphone | Consumer polish. Clean, spacious. No jargon. |

### 8 priority screens — ALL BUILT (Phase 1A)

1. ✅ Founder morning dashboard (ERP web) — cash, pipeline, alerts, KPI cards
2. ✅ Lead pipeline + lead detail (ERP web) — sales team daily driver
3. ✅ Proposal creation flow (ERP web) — BOM, margin logic
4. ✅ Project detail + milestones (ERP web) — PM primary workspace + 10-step stepper
5. ✅ Project cash position (ERP web) — most important financial screen
6. ✅ Daily site report (ERP web) — 48h lock, photo upload, Tier 2 correction
7. O&M visit checklist (Mobile) — deferred to Phase 2 (mobile app)
8. Service ticket lifecycle (Customer + ERP) — deferred to Phase 2

### Role-specific dashboards — ALL BUILT (Phase 2A)

- ✅ 10 roles: founder, hr_manager, sales_engineer, designer, project_manager, purchase_officer, site_supervisor, om_technician, finance, customer
- ✅ Role-adaptive /dashboard route with founder role switcher (?view_as=)
- ✅ Sectioned sidebar navigation per role
- ✅ PM 10-step project stepper (Details → Survey → BOM → BOQ → Delivery → Execution → QC → Liaison → Commissioning → AMC)
- ✅ KPI cards + My Tasks widget on every dashboard
- ✅ 142 tests passing, 0 type errors

### All ERP screens — COMPLETE (Phase 2B, April 2 2026)

57+ routes total, 0 type errors, all data-driven with Supabase queries:
- ✅ Procurement: `/procurement` (PO list with filters), `/deliveries`, `/vendor-payments`, `/msme-compliance`
- ✅ Inventory: `/inventory` (stock dashboard with cut-length tracking, filters, low-stock alerts), `/inventory/[id]` (detail + cut-length gauge)
- ✅ Vendors: `/vendors` (full vendor list with search/filter)
- ✅ Tasks: `/tasks` (all tasks across entities), `/my-tasks` (personal)
- ✅ Daily Reports: `/daily-reports` (all), `/my-reports` (personal)
- ✅ Finance: `/invoices`, `/payments` (tabbed: project payments overview + receipts), `/profitability`, `/cash`
- ✅ QC: `/qc-gates` (gate inspections)
- ✅ HR: `/hr/employees`, `/hr/leave`, `/hr/training`, `/hr/certifications`, `/hr/payroll`
- ✅ O&M: `/om/visits`, `/om/tickets`, `/om/amc`
- ✅ Sales: `/leads` (stage-based pipeline), `/leads/[id]` (tabbed detail: details/activities/tasks/proposal/files/payments), `/proposals`
- ✅ Liaison: `/liaison`, `/liaison/net-metering`
- ✅ Design: `/design` (design queue from leads), `/design/[leadId]`
- ✅ Reference: `/price-book`

### Contacts V2 — HubSpot-style CRM (April 4, 2026)

**Architecture:** Person (contacts) and Organization (companies) are separate entities. Company is optional (residential customers have no company). Linked via `contact_company_roles` junction table with role titles and active/ended status.

**Key decisions:**
- `first_name`/`last_name` split with auto-generated `name` display field
- `lifecycle_stage`: subscriber → lead → opportunity → customer → evangelist
- `entity_contacts` polymorphic junction: links contacts to leads, proposals, or projects with role labels
- `activities` + `activity_associations`: HubSpot-style engagement log (note, call, email, meeting, site_visit, whatsapp, task, status_change) linked to any entity
- Company optional for residential contacts — no forced company creation
- Backfill script: smart name splitting, company detection via regex patterns (Pvt, Ltd, LLP, Industries, etc.)

**Files:**
- Queries: `src/lib/contacts-queries.ts`, `src/lib/contacts-actions.ts`
- Components: `src/components/contacts/activity-timeline.tsx`, `contact-form.tsx`, `company-form.tsx`, `add-contact-dialog.tsx`, `entity-contacts-card.tsx`
- Pages: `/contacts`, `/contacts/[id]`, `/contacts/[id]/edit`, `/contacts/new`, `/companies`, `/companies/[id]`, `/companies/[id]/edit`, `/companies/new`

### HubSpot-style DataTable — Reusable (April 4, 2026)

**Architecture:** Single `<DataTable>` component used by leads, proposals, and extensible to all entity types. URL-driven sort/pagination via searchParams. Server-side data fetching.

**Key features:**
- Column picker: slide-out panel with searchable checkbox list (left) + drag-to-reorder (right)
- Saved views: `table_views` DB table persists columns, filters, sort per user. Tab bar UI with create/save/delete
- Per-column config: `column-config.ts` defines sortable, editable, format (badge/currency/date/phone/email), frozen, defaultVisible
- Checkbox selection with bulk action bar
- **Inline editing:** Double-click any editable cell to edit in-place. Supports text, number, select/badge dropdowns, date picker, phone, email. Enter to save, Escape to cancel. Server action with field-level validation and RLS enforcement.
- Column definitions: LEAD_COLUMNS (16), PROPOSAL_COLUMNS (12), PROJECT_COLUMNS (11), CONTACT_COLUMNS (8), COMPANY_COLUMNS (7)
- **All entity pages** now use DataTable: leads, proposals, projects, contacts, companies

**Files:**
- `src/components/data-table/data-table.tsx` — main component (with inline editing)
- `src/components/data-table/column-config.ts` — all column definitions
- `src/components/data-table/column-picker.tsx` — HubSpot-style column selector
- `src/components/data-table/view-tabs.tsx` — saved view tabs
- `src/lib/views-actions.ts` — server actions for view CRUD
- `src/lib/inline-edit-actions.ts` — server action for inline cell editing
- Wrapper components: `leads-table-wrapper.tsx`, `proposals-table-wrapper.tsx`, `projects-table-wrapper.tsx`, `contacts-table-wrapper.tsx`, `companies-table-wrapper.tsx`

### Field friction standards (mobile screens)

- 90-second rule: any mobile form completable in under 90 seconds
- Pre-populate every field that can be inferred
- Mandatory fields first, optional fields below the fold
- Sliders for percentages, quick-tap presets for counts, voice-to-text for free text

---

## WORKFLOW (how this project is built)

```
Claude Code writes code in this repo
  ↓
Vivek reviews every file before committing
  ↓
git add → git commit → git push
  ↓
SQL migrations: paste into Supabase SQL Editor (dev first, then prod)
  ↓
Schema change: regenerate types immediately
```

No autonomous commits to main. No skipping review. No "I'll clean this up later."

**After completing any task or milestone**, immediately update:
1. The **CURRENT STATE** table in this file (`CLAUDE.md`) — mark items as ✅ and update details
2. The **status table + relevant sections** in `docs/SHIROI_MASTER_REFERENCE_3_0.md`
3. Remove completed items from "Immediate next steps" lists in both files
This is automatic — do not wait for Vivek to ask.

---

## KEY INTEGRATIONS

| Integration | Detail |
|------------|--------|
| NREL PVWatts API | Primary simulation. GET `developer.nrel.gov/api/pvwatts/v8.json`. Timeout 8s → fallback |
| PVLib microservice | Fallback simulation. `http://[laptop]:5001/simulate`. POST JSON. |
| Claude API | `claude-sonnet-4-20250514`. Daily report narratives, proposal summaries. Max 500 calls/day. |
| n8n | Webhooks from Supabase → n8n at `X-N8N-Webhook-Secret` header. Failures → `system_webhook_failures` table. |
| Zoho Payroll | ERP is master. Monthly CSV export on 25th → Zoho imports. Format in master reference Section 12.5. |
| HubSpot | ✅ Replaced. One-time cutover complete (Apr 3, 2026). Script: `scripts/migrate-hubspot.ts`. |
| Sungrow / Growatt | Inverter monitoring APIs. Phase 2. Registration in progress (4–8 weeks). |
| WATI.io | WhatsApp direct send. Phase 2. Registration in progress. |

---

## KNOWN COMPLEXITIES — READ BEFORE TOUCHING THESE AREAS

- **CEIG clearance gate:** DB trigger blocks TNEB net metering submission until CEIG is approved. `net_metering_applications` table. Do not work around this trigger.
- **IR test auto-ticket:** IR reading < 0.5 MΩ → DB trigger auto-creates critical service ticket (4h SLA). `commissioning_reports` and `om_visit_reports`. Non-negotiable.
- **Sum-to-100% triggers:** `proposal_payment_schedule` percentages must sum to exactly 100% before a proposal can leave draft status. `project_milestone_weights` must sum to 100% per segment+system_type. DB triggers enforce both.
- **Phone uniqueness:** Partial unique index on `leads.phone` blocks duplicate active leads. Disqualified and lost leads excluded from the uniqueness check.
- **Tasks entity model:** `tasks` table uses `entity_type + entity_id` (not separate task tables per domain). `entity_type` values: `project` | `lead` | `om_ticket` | `procurement` | `hr`.
- **Salary RLS:** `employee_compensation` and `salary_increment_history` — readable ONLY by: the employee (own record), their direct manager, `hr_manager`, `founder`. Strictly enforced at DB level.
- **Offline sync pattern:** Mobile writes go to WatermelonDB first. Background sync to Supabase. `sync_status` column on affected tables: `local_only` | `syncing` | `synced` | `sync_failed`. Never lose data.
- **Financial year boundary:** April 1. Document number sequences reset. `generate_doc_number()` DB function handles this automatically.
- **MSME 45-day rule:** Vendor payments to MSME suppliers legally due within 45 days of delivery. `vendor_payments` table tracks per-payment dates. Alert on Day 40.

---

## REFERENCE DOCUMENTS IN THIS REPO

| File | Read when |
|------|-----------|
| `docs/SHIROI_MASTER_REFERENCE_3_0.md` | Starting any new feature — full business rules and decisions |
| `docs/projects dashboard.md` | Building any projects module screen — PM's workflow intent + data model mapping |
| `docs/Shiroi_ERP_Design_System.md` | Building any UI component — V2.0, single source of truth |
| `docs/Shiroi_Energy_Brand_Guide_V6.html` | Design tokens, colours, typography |
| `docs/superpowers/specs/2026-03-30-role-dashboards-design.md` | Phase 2A design spec — all 8 role dashboards |
| `supabase/migrations/` | Understanding exact table structure before writing queries |
| `packages/types/database.ts` | TypeScript types — always import from here |

---

*This file is maintained by Vivek. Update it whenever a major decision is made.*
*Last updated: April 10, 2026 — BOI V2 + BOQ V2 overhaul. (1) BOI V2: Migration 036 adds project_bois table for multi-version BOI tracking (BOI-1, BOI-2, etc.) with status flow draft→submitted→approved→locked. Adds boi_id FK on project_boq_items. RLS policies (profiles-based role check). Backward compat: auto-creates BOI-1 for existing items (508 linked). Server actions: createBoiVersion, submitBoiVersion, approveBoiVersion, lockBoiVersion, unlockBoiVersion. New step-bom.tsx: multi-BOI cards, per-version status badges + workflow buttons, BoiCategoryFilter (DOM-based, 14 categories), pre-fetched items in parallel, inline add/delete for draft BOIs only, prepared-by/approved-by/locked-by display. Types regenerated. (2) BOQ V2: 5-card summary dashboard (Project Cost editable, Material Budget, Site Expenses editable estimate, Total Outflow, Final Margin % with color-coded bg). Category-wise breakdown table with item counts + subtotals excl/incl GST. New columns: Amount (excl. GST) and Total (incl. GST). Send to Purchase button (bulk yet_to_finalize→yet_to_place). Auto-Price button (applies Price Book rates to zero-price items). Site expenses (approved actuals or estimated budget) integrated in margin calc. New server actions: sendBoqToPurchase, applyPriceBookRates, updateEstimatedSiteExpenses. New queries: getApprovedSiteExpenses, getPriceBookMap. Compact 12px table. 7 files changed, 0 type errors.*
*Earlier on April 10, 2026 — Documents tab overhaul: Replaced single-card ProjectFiles + LeadFiles + HandoverPack with a grid of separate category boxes. 12 document categories (Customer Documents, Site Photos, AutoCAD/Design, Layouts/Designs, Purchase Orders, Invoices, Delivery Challans, Warranty Cards, Excel/Costing, Documents/Approvals, SESAL, General) each as a separate Card. Compact squarish Handover box (just generate/regenerate button + version badge). Customer Documents box (col-span-2) shows project customer-documents files + lead/proposal files with "Proposal" badge. Site Photos has auto-rotating slideshow (5s interval, prev/next arrows, pause on hover, click → lightbox) with file management list below. Drag-and-drop recategorization: drag any file row (GripVertical handle) to a different category box to move it via Supabase Storage `move()` (same bucket) or download+upload+delete (cross-bucket). Upload dropdown matches 12 new categories. WhatsApp photos shown in both slideshow and separate box. Legacy folder names (invoice→invoices) mapped correctly. Old handover-pack.tsx and lead-files.tsx left in place but no longer imported from documents-tab.tsx. 3 files changed, 0 type errors.*
*Earlier on April 10, 2026 — Fix: Project detail page RSC boundary crash (digest 3644683528). `FinancialBox` is a Server Component that was passing a `render={(v) => ...}` function prop to the `EditableField` client component. Functions are not serializable across the RSC boundary, so React threw "An error occurred in the Server Components render" on every /projects/[id] details tab for any user hitting `canEditOrder = true` (founder or finance — i.e. Vivek always). Swapped `render` for `displayValue` (plain JSX) — `EditableField` already supports it via `if (displayValue !== undefined) return displayValue`. Verified on erp.shiroienergy.com: all 4 detail boxes now render correctly for the founder role. Commit 84d9033.*
*Earlier on April 9, 2026 — Project detail page overhaul per Manivel's spec. (1) Migration 033: project detail fields (scope_la/civil/meter, cable_brand/model, billing_address, location_map_link, order_date, primary_contact_id FK→contacts) + project_site_expenses voucher workflow (voucher_number, expense_category, status pending/approved/rejected/auto_approved, submitted_by/at, approved_by/at, rejected_reason, receipt_file_path). Existing rows marked auto_approved so only new submissions enter the queue. (2) Migration 034: estimated_site_expenses_budget on projects — PM-editable aggregate for general site expenses. (3) New detail page layout: ProjectHeader with editable 8-status dropdown, horizontal 12-stage ProjectStepper (Details → Survey → BOI → BOQ → Delivery → Execution → Actuals → QC → Liaison → Commissioning → Free AMC → Documents) with completed-stage highlights from `deriveCompletedStages()`. Dropped AdvanceStatusButton + old tab strip. (4) Details tab now renders 4 editable boxes: FinancialBox (role-gated PM/founder/finance/sales_engineer, contracted value + BOQ total + site expenses + margin %), SystemConfigBox (all dropdowns: size, type on-grid/off-grid/hybrid, mounting elevated/low-raise/minirail/long-rail/customized, panel/inverter/battery/cable brand+model, scope_la/civil/meter shiroi\|client, remarks), CustomerInfoBox (primary_contact_id picker with 250ms debounced search against contacts table, site addr, billing addr, location_map_link Google Maps URL), TimelineTeamBox (6 date fields + PM + site_supervisor dropdowns — Team merged here per spec). (5) New Actuals stepper step: BOQ Total + approved Site Expenses KPI strip, auto-populated BOQ items table, inline voucher form, voucher history with status badges, margin color coding. (6) New Documents tab merges HandoverPack + ProjectFiles + LeadFiles (proposal-files bucket). (7) Removed: Notes card, Milestones/Delays/Change Orders/Reports tabs, side PDF link. (8) `/vouchers` PM approval queue: KPI strip, project rollup, Approve + Reject-with-reason Dialog. Sidebar link under new "Approvals" section for founder/project_manager/finance. Receipt icon registered in sidebar ICON_MAP. (9) BOI step has new "Estimated Site Expenses (General)" card at the bottom — single aggregate EditableField that becomes the baseline in BOQ budget analysis + Actuals margin. (10) `site-expenses-actions.ts` server actions (submit/approve/reject/getPending/getProject), `project-detail-actions.ts` (updateProjectField with FINANCIAL_FIELDS gate, setProjectStatus, getProjectFinancials, searchContactsLite, getActiveEmployeesLite). tsc --noEmit: 0 errors. Next: employee testing week, prod deployment.*
