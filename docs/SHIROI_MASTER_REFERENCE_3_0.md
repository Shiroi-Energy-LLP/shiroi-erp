# SHIROI ENERGY ERP — MASTER REFERENCE DOCUMENT
**Version 3.5 | Updated April 10, 2026 | Read before every coding session**

> This is the single source of truth for the Shiroi Energy ERP project. Every decision made, every design rule, every business rule, every coding standard, and every constraint is captured here. Anyone joining the project — including Claude in a new chat — reads this first before writing a single line of code or SQL.

---

## CURRENT STATE — READ THIS FIRST (as of April 6, 2026)

**Phase 1A + 2A + 2B + 2C COMPLETE. All 60+ screens built. HubSpot cutover done. Marketing redesign + Payments overview complete. Next: Marketing manager feedback + prod deployment.**

| Item | Status | Detail |
|------|--------|--------|
| GitHub repo | ✅ Live | github.com/Shiroi-Energy-LLP/shiroi-erp (private) |
| Monorepo | ✅ Complete | Turborepo + pnpm, all packages wired |
| Next.js ERP app | ✅ Running | apps/erp on localhost:3000 |
| Supabase dev | ✅ Live | actqtzoxjilqnldnacqz.supabase.co |
| Supabase prod | ✅ Live | kfkydkwycgijvexqiysc.supabase.co |
| Database schema | ✅ Complete | 137+ tables, 91+ triggers, RLS on all tables |
| TypeScript types | ✅ Generated | packages/types/database.ts — regenerated Apr 6 with pipeline fields |
| Migrations | ✅ Committed | supabase/migrations/ — 32 files (001 through 021) |
| Supabase client | ✅ Complete | packages/supabase — browser, server, admin, middleware |
| Design system | ✅ V2.2 Complete | packages/ui — 22 components (11 new in R1+R2), Radix primitives, form infra, skeleton loading, Logo/Eyebrow patterns |
| Auth + App Shell | ✅ Complete | Login w/ Logo, collapsible sidebar (desktop toggle + mobile hamburger/Sheet), skip-to-content, topbar with role switcher |
| Phase 1A Screens | ✅ Complete | Founder dashboard, leads, proposals, projects, procurement, cash, HR, daily reports |
| Phase 2A Dashboards | ✅ Complete | 8 role-adaptive dashboards, PM 10-step stepper, founder role switcher |
| Phase 2B All Screens | ✅ Complete | 60+ routes total — all sidebar links are real data-driven pages, 0 placeholders |
| Marketing redesign | ✅ Complete | Stage-based leads pipeline, weighted KPIs, tabbed lead detail, task-centric follow-ups, mandatory follow-up dates, payment follow-up trigger |
| Payments overview | ✅ Complete | Project payments tracker: P&L, payment stages, next milestone, expected collections, invested vs received |
| Migration 020 | ✅ Applied (dev) | Pipeline fields: expected_close_date, close_probability, is_archived on leads |
| Migration 021 | ✅ Applied (dev) | Payment follow-up trigger: auto-creates tasks when project hits payment milestones |
| Sentry | ✅ Live | @sentry/nextjs v10, client+server+edge+onRequestError, DSN configured |
| Migration 010 | ✅ Applied (dev) | lead_status 'converted' + project_site_expenses + project-files bucket |
| Migration 011 | ✅ Applied (dev) | lead_status 'design_confirmed' enum value (after proposal_sent) |
| Migration 012 | ✅ Applied (dev) | lead_status_history.changed_by nullable for system/migration operations |
| HubSpot migration | ✅ Complete | 1,115 leads, 314 proposals, 314 projects, 30 payments. 0 unmatched payments. |
| Google Drive migration | ✅ Complete | 108 vendors, ~160 projects, 850 POs (2,348 items), 1,164 expenses, 916 files |
| RLS recursion fix | ✅ Applied | get_my_role() + get_my_employee_id() — migration 008a |
| New roles migration | ✅ Applied (dev) | migration 009 — designer + purchase_officer roles + RLS |
| Leads pagination + bulk actions | ✅ Complete | 50/page server-side, bulk assign/status/delete/merge, segment + assignee filters, checkbox selection |
| Proposals pagination | ✅ Complete | 50/page server-side, budgetary/detailed filter, system type filter, type badge column |
| Projects pagination | ✅ Complete | 50/page server-side, preserves all existing filters |
| PM Dashboard v2 | ✅ Complete | Correct KPIs (System Size, Clients, Sales, Profit %), donut chart, operations widget, dark today panel |
| Design system v2.1 | ✅ Complete | packages/ui — 11 components (+Checkbox, +Pagination), recharts added to ERP |
| UI/UX Overhaul R1 | ✅ Complete | 15 improvements: sidebar collapse, Radix Dialog/Sheet/Tabs/Tooltip/Dropdown, Logo, Eyebrow, EmptyState, Skeleton, Breadcrumbs, Form infra, skip-to-content, accessibility, responsive fonts |
| UI/UX Overhaul R2 | ✅ Complete | 9 items: hex→token purge (45+ files), 15 loading skeletons, EmptyState on 15 more pages, Eyebrow on 25 more pages, Breadcrumbs on 4 more pages, toast on 5 more forms, semantic status tokens |
| Tests | ✅ 142 pass | 11 test files, 0 failures, 0 type errors |
| Vercel | ⏳ Ready | Config done, connect when ready to deploy |
| Data quality overhaul | ✅ Complete | Full extraction pipeline. Proposals: 341→751. Financials: 52→647. BOM: 35,022 lines (629 proposals). 1,290 photos. 180 GDrive confirmed projects synced (BOM, dates, brands, margins, addresses). |
| Google Drive file sync | ✅ Complete | 1,344 files from 159 confirmed projects synced to Supabase. 881 old-path files fixed. **2,151 total project files across 136 projects**, 0 orphans. |
| Migrations 022a–024a | ✅ Applied (dev) | PM corrections: 022a file delete RLS, 023a survey form overhaul (~25 cols), 024a BOQ items + delivery challans |
| Migrations 022b–026 | ✅ Applied (dev) | Data quality: 022b processing_jobs, 023b BOM categories, 024b storage mime fix, 025 electricity_bill_number, 026 site_photos lead_id (project_id nullable) |
| Migration 027b | ✅ Applied (dev) | Expanded project-files bucket mime types (DWG, DOCX, XLSX, PPTX, video, SketchUp) + 100MB limit |
| Migration 029 | ✅ Applied (dev) | data_flags table, data_verified_by/at on leads/projects/proposals, get_flag_count + get_data_flag_summary RPCs |
| Migration 030 | ✅ Applied (dev) | BOI/BOQ project fields: boi_locked, boi_locked_at, boi_locked_by, boq_completed, boq_completed_at, project_cost_manual + category index |
| Migration 031 | ✅ Applied (dev) | Project status overhaul: collapse project_status 11→8 (order_received, yet_to_start, in_progress, completed, holding_shiroi, holding_client, waiting_net_metering, meter_client_scope). FK fix on log_project_status_change trigger. Auto-create Project on proposal acceptance. |
| Migration 032 | ✅ Applied (dev) | Fix `create_payment_followup_tasks` trigger: `p.status IN ('approved', 'accepted')` → `p.status = 'accepted'` ('approved' is not in proposal_status enum — was blocking status transitions to in_progress/completed/waiting_net_metering). |
| Migration 033 | ✅ Applied (dev) | Project detail fields: scope_la/scope_civil/scope_meter, cable_brand/model, billing_address, location_map_link, order_date, primary_contact_id FK→contacts. project_site_expenses voucher workflow fields (voucher_number, expense_category, status, submitted_by/at, approved_by/at, rejected_reason, receipt_file_path). Existing rows → auto_approved. Indexes on (status, submitted_at DESC) + (project_id). |
| Migration 034 | ✅ Applied (dev) | `estimated_site_expenses_budget NUMERIC(14,2)` on projects — PM-editable planning figure (travel/food/lodging/labour advances) used as baseline in BOQ budget analysis and Actuals margin. |
| BOI module overhaul | ✅ Complete | BOM→BOI rename, 14 Manivel categories, submit/lock workflow, Prepared By display, inline add/delete items |
| BOQ Budget Analysis | ✅ Complete | Inline rate/GST editing, add/delete items, category filter, grand total, Final Summary (Project Cost / Actual Budget / Expected Margin %), Mark BOQ Complete checkbox |
| Delivery Challan V2 | ✅ Complete | Full DC module: Create DC from "Ready to Dispatch" BOQ items, auto-fill Ship-To from project site address, individual DC PDF generation (company header, items table, transport details, Engineer + Client signatures, footer), API route GET `/api/projects/[id]/dc/[dcId]`, expandable DC rows with PDF download + Submit (draft→dispatched), sequential DC listing (DC1, DC2, DC3...), status summary pills |
| Projects screen overhaul | ✅ Complete | Per Manivel's spec: remarks column hidden by default, project numbers shortened (SHIROI/PROJ/ prefix stripped), customer_name clickable → project detail, 8 status options in filter dropdown, inline status edit works (FK error fixed), accepted proposals auto-create projects |
| Project detail page overhaul | ✅ Complete | Per Manivel's spec. Header: editable 8-status dropdown (replaces AdvanceStatusButton). 12-stage horizontal ProjectStepper (Details → Survey → BOI → BOQ → Delivery → Execution → Actuals → QC → Liaison → Commissioning → Free AMC → Documents) with completed-stage highlights. Details tab: 4 editable boxes — FinancialBox (role-gated PM/founder/finance/sales_engineer), SystemConfigBox (size/type/mounting/panel/inverter/battery/cable/scope_la/civil/meter/remarks, all dropdowns), CustomerInfoBox (contact picker w/ 250ms debounced search → primary_contact_id, addresses, Google Maps link), TimelineTeamBox (6 date fields + PM + supervisor dropdowns, Team merged in). New Actuals step (BOQ + vouchers + margin color coding). New Documents tab (HandoverPack + ProjectFiles + LeadFiles merged). Removed: Notes card, Milestones/Delays/Change Orders/Reports tabs, side PDF link. |
| Vouchers approval queue | ✅ Complete | New `/vouchers` page — consolidated PM/founder/finance review for site expense vouchers. KPI strip (pending count, pending total, projects with pending), grouped project rollup, Approve + Reject-with-reason Dialog. Sidebar link under new "Approvals" section for founder/project_manager/finance. `site-expenses-actions.ts` (submit/approve/reject/getPending/getProject). |
| BOI estimated site expenses | ✅ Complete | New card at bottom of BOI stepper step — single aggregate EditableField for `projects.estimated_site_expenses_budget` (NUMERIC(14,2)). Feeds into BOQ budget analysis baseline + Actuals step margin calculation. Planning fidelity is a single number, not a per-category breakdown — real record lives in `project_site_expenses`. |
| Data verification system | ✅ Complete | DataFlagButton component, /data-quality dashboard (summary cards, flags table, resolve action), sidebar links for founder/purchase/finance |
| Marketing mgr feedback | 🔜 **NEXT** | Get Prem's feedback on marketing redesign (same cycle as PM feedback) |
| Inline editing expansion | ✅ Complete | Projects (8 new editable), proposals (4), vendors (10), POs (3), BOM (7), contacts (3 new). Column configs + inline-edit-actions extended |
| Placeholder pages | ✅ Complete | Design Queue (leads with survey done), Price Book (35 items), Liaison index (net meter summary cards) — all data-driven |
| BOM Review page | ✅ Complete | /bom-review — 35K lines, category filters, summary cards, inline editing, flag per row, pagination (100/page) |
| PO Detail page | ✅ Complete | /procurement/[poId] — vendor info, line items, delivery challans, vendor payments section |
| Finance CRUD | ✅ Complete | createInvoice (GST split, auto-number), recordPayment (updates invoice status), recordVendorPayment (MSME compliance). Dialogs on invoices + payments pages |
| Create PO flow | ✅ Complete | CreatePODialog with project/vendor selector, dynamic line items, category/description/qty/rate/GST, auto-totals. procurement-actions.ts server action |
| File flagging | ✅ Complete | DataFlagButton on ProjectFiles, LeadFiles, LeadFilesList — flag wrong_file/wrong_category/duplicate per file |
| BOI/BOQ/DC tab fix | ✅ Complete | Fixed crash: BOI_CATEGORIES from 'use client' file used in server components — moved to shared lib/boi-constants.ts |
| Edit Task enhancements | ✅ Complete | Searchable project dropdown (type-to-filter), Done By employee field (auto-marks completed) |
| Documents tab overhaul | ✅ Complete | Project detail Documents tab rewritten: separate Card boxes per file category (12 categories + WhatsApp), compact Handover box, Customer Documents box with lead files, Site Photos slideshow, drag-and-drop recategorization between boxes, upload dropdown matches new category list |
| Zoho Books import | 🔜 Next | Import vendors, POs, invoices, payments from Zoho Books CSVs — dedup against existing 108 vendors, 850 POs |
| Employee testing week | 🔜 Next | 5-6 employees review data on dev for 1 week. Data flags + inline edit + verification |
| Prod deployment | 🔜 After testing | Schema clone + selective data migration to prod after employee testing week |

**Coding workflow (locked):**
Claude Code writes code directly in the repo → Vivek reviews every file → git commit and push.
SQL migrations: pasted into Supabase SQL Editor (dev first, then prod). Every SQL change documented in migrations immediately.
**After completing any task or milestone**, Claude Code must immediately update the status tables and next-steps lists in both `CLAUDE.md` and this file. This is automatic — do not wait to be asked.

**TypeScript type generation command (run after every schema change):**
```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

---

## TABLE OF CONTENTS

1. [Company & Project Context](#1-company--project-context)
2. [Technology Stack — Locked](#2-technology-stack--locked)
3. [Development Environment](#3-development-environment)
4. [Coding Standards — Non-Negotiable](#4-coding-standards--non-negotiable)
5. [Database Schema — 134 Tables](#5-database-schema--134-tables)
6. [Business Rules by Domain](#6-business-rules-by-domain)
7. [Undo & Correction Model](#7-undo--correction-model)
8. [Field Friction Standards](#8-field-friction-standards)
9. [Completion Percentage Model](#9-completion-percentage-model)
10. [UI/UX Approach & Design System](#10-uiux-approach--design-system)
11. [Data Migration Strategy](#11-data-migration-strategy)
12. [Integration Specifications](#12-integration-specifications)
13. [Security Model](#13-security-model)
14. [Observability & Monitoring](#14-observability--monitoring)
15. [Build Phases & Roadmap](#15-build-phases--roadmap)
16. [All Decisions Log](#16-all-decisions-log)
17. [External Registrations In Progress](#17-external-registrations-in-progress)
18. [Edge Cases & Known Complexities](#18-edge-cases--known-complexities)
19. [Reference Documents](#19-reference-documents)
20. [Role-Specific Dashboards & Workspaces](#20-role-specific-dashboards--workspaces)

---

## 1. Company & Project Context

**Shiroi Energy Private Limited** — Solar EPC company, Chennai, Tamil Nadu, India.

**What they do:** Rooftop solar installation for residential, commercial, and industrial customers. Systems: on-grid, hybrid (with battery), off-grid. Also: net metering applications to TNEB/DISCOM, annual maintenance contracts (AMC). Scale: 500+ projects completed, ~100 active at any time, ~50 employees.

**This ERP is for Shiroi Energy only.** Single-tenant. No other companies in scope. No `company_id` on any table.

### Three surfaces being built

| Surface | Users | Device |
|---------|-------|--------|
| ERP web app | Vivek (founder), sales, PMs, engineers, finance, HR | Desktop/laptop |
| Mobile field app | Site supervisors, O&M technicians | Smartphone — offline capable |
| Customer app | Customers with installed systems | Smartphone |

### Ten employee roles and handoff chain

| Role | Person | Primary function |
|------|--------|-----------------|
| `founder` | Vivek | Full access, cash oversight, approvals |
| `sales_engineer` | Sales team (~5) | Leads, follow-ups, closure, marketing, liaison |
| `designer` | System designer | AutoCAD layouts, system design, quote generation/approval |
| `project_manager` | PMs | 10-step project lifecycle, BOM, QC, O&M |
| `purchase_officer` | Purchase team | Vendor quotes, POs, delivery tracking, price book |
| `site_supervisor` | Field staff | Daily reports, photos, milestone checklists |
| `om_technician` | O&M team | Visit reports, service tickets, plant monitoring |
| `finance` | Finance team | Cash flow, invoices, payments, MSME compliance |
| `hr_manager` | HR | Employees, leave, payroll, certifications |
| `customer` | End customers | Own plant monitoring, service tickets (customer app) |

**End-to-end handoff chain:**
```
Sales Engineer → Designer → Sales Engineer (closure) → PM (BOM) → Purchase Officer (quotes, PO, delivery, DC, GRN) → PM (execution) → Site Supervisor (daily) → PM (QC, commissioning) → O&M Technician
```

### Five core problems this system solves

1. **Cash invisibility** — nobody knows which projects Shiroi is funding from its own working capital
2. **Manual quoting** — proposals take too long, margin erodes because no feedback loop from actuals
3. **Knowledge in phones** — DISCOM contacts, vendor relationships, customer history leave when people leave
4. **No O&M tracking** — service history, warranty status, escalation happen informally
5. **HR/payroll is error-prone** — leave, attendance, payroll managed in spreadsheets

---

## 2. Technology Stack — Locked

### Monorepo structure (Turborepo) — actual current state

```
shiroi-erp/                        ← root, pnpm workspace
├── apps/
│   ├── erp/                       ← Next.js 14 ERP web app ✅ scaffolded
│   │   ├── src/app/               ← App Router pages
│   │   ├── src/components/        ← ERP components
│   │   ├── src/lib/               ← utilities, helpers
│   │   ├── next.config.js
│   │   ├── tsconfig.json
│   │   └── package.json           ← @repo/erp
│   └── mobile/                    ← React Native + Expo (empty, built later)
├── packages/
│   ├── types/                     ← Shared TypeScript types ✅ generated from schema
│   │   └── database.ts            ← Auto-generated. Never edit by hand.
│   ├── supabase/                  ← Supabase client factory ✅ (browser, server, admin, middleware)
│   │   └── src/
│   │       ├── client.ts          ← createClient() — browser singleton, RLS enforced
│   │       ├── server.ts          ← createClient() — async, Next.js cookies, RLS enforced
│   │       ├── admin.ts           ← createAdminClient() — secret key, bypasses RLS
│   │       └── middleware.ts      ← updateSession() — refreshes auth session per request
│   ├── ui/                        ← Design system (Shiroi brand tokens + shadcn/ui overrides)
│   ├── eslint-config/             ← Shared ESLint rules
│   └── typescript-config/         ← Shared TS config
├── supabase/
│   └── migrations/                ← ✅ 28 SQL files (001–012), all committed to git
│       ├── 001_foundation.sql
│       ├── 002a_leads_core.sql
│       ├── 002b_leads_extended.sql
│       ├── 003a_proposals_core.sql
│       ├── 003b_proposals_pricing.sql
│       ├── 003c_proposals_acceptance.sql
│       ├── 004a_projects_core.sql
│       ├── 004b_projects_procurement.sql
│       ├── 004c_projects_site_reports.sql
│       ├── 004d_projects_financials.sql
│       ├── 005a_hr_master.sql
│       ├── 005b_leave_payroll.sql
│       ├── 005c_training.sql
│       ├── 005d_om.sql
│       ├── 006a_inventory.sql
│       ├── 006b_marketing_documents.sql
│       ├── 006c_audit_triggers.sql
│       ├── 007a_vendor_payments.sql
│       ├── 007b_sum_validation.sql
│       ├── 007c_whatsapp_tracking.sql
│       ├── 007d_leads_fixes.sql
│       ├── 007e_trigger_fixes.sql
│       ├── 007f_universal_tasks.sql
│       └── 008a_fix_rls_recursion.sql  ← get_my_role() + get_my_employee_id()
├── .env.local                     ← secrets, gitignored, never committed
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### All technology choices — locked, no debate

| Layer | Technology | Notes |
|-------|-----------|-------|
| ERP web | Next.js 14 + TypeScript | App Router, SSR for dashboards |
| Mobile | React Native + Expo SDK 51+ | iOS + Android from one codebase |
| Database | Supabase (PostgreSQL) | Auth + Storage + Edge Functions + RLS bundled |
| Auth | Supabase Auth | Employee: email+password. Customer: phone OTP |
| File storage | Supabase Storage + Cloudflare CDN | Photos, documents, PDFs |
| Backend logic | Supabase Edge Functions (Deno/TypeScript) | Triggers, PDF gen, API calls |
| Offline sync | WatermelonDB | Field mobile app — production-grade offline-first |
| Automation | n8n self-hosted on spare laptop | WhatsApp, scheduled jobs, workflows |
| ERP hosting | Vercel | Zero-config Next.js, preview URLs per branch |
| Mobile builds | Expo EAS Build | App Store + Play Store |
| UI components | shadcn/ui + Tailwind CSS | ERP web only |
| Simulation primary | NREL PVWatts API | Free HTTP API, works from Edge Functions |
| Simulation fallback | PVLib Python microservice | Same laptop as n8n, port 5001 |
| AI narrative | Claude API (claude-sonnet-4-20250514) | Reports, proposals, check-ins |

### The spare laptop server

One dedicated always-on laptop runs both:
- **n8n** (port 5678) — all automation workflows
- **PVLib microservice** (port 5001) — simulation fallback

Both run as systemd services (auto-start on boot). Ubuntu Server LTS. Static local IP required.

**Simulation flow:** Edge Function calls PVWatts first. On timeout/error → call local PVLib microservice. Both code paths always implemented.

### Monthly infrastructure cost estimate

| Service | Cost |
|---------|------|
| Supabase Pro | ~₹2,100/month |
| Vercel Pro | ~₹1,700/month |
| Expo EAS Build | ~₹2,400/month |
| Cloudflare R2 + CDN | ~₹800/month |
| Claude API (~500 calls/day) | ~₹2,000–4,000/month |
| **Phase 1 total** | **~₹9,000–11,000/month** |
| WhatsApp BSP (Phase 2) | +₹3,000/month |

---

## 3. Development Environment

### Two environments — this order is mandatory

```
dev/staging  → shiroi-erp-dev Supabase project, Vercel preview URL
production   → shiroi-erp-prod Supabase project, live system, real users, real money
```

**Rules never broken:**
- Never put real customer or financial data in the dev project
- Every migration tested in dev before running on prod
- Production Supabase never used for development
- Dev migration breaks → fix before touching production

### Migration workflow (locked)

SQL is written by Claude in chat → pasted into Supabase SQL Editor (dev project) → confirmed working → saved as `.sql` file in `supabase/migrations/` → committed to git. No Supabase CLI needed.

### TypeScript type generation — mandatory after every schema change

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

Never write database TypeScript types by hand. Always generate from schema. Run after every migration.

### Environment variables — never hardcode, never commit

```bash
# .env.local (in .gitignore — never committed, never shared)
# Supabase new key format (projects created after Nov 2025)

# DEV PROJECT
NEXT_PUBLIC_SUPABASE_URL=https://actqtzoxjilqnldnacqz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # client-side safe
SUPABASE_SECRET_KEY=sb_secret_...                          # server/edge only — NEVER in client code

# PROD PROJECT
PROD_SUPABASE_URL=https://kfkydkwycgijvexqiysc.supabase.co
PROD_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
PROD_SUPABASE_SECRET_KEY=sb_secret_...

# OTHER INTEGRATIONS
ANTHROPIC_API_KEY=
PVWATTS_API_KEY=                  # free at developer.nrel.gov
PVLIB_MICROSERVICE_URL=           # http://[laptop-static-ip]:5001
N8N_WEBHOOK_SECRET=               # random string verified in every webhook
```

**Supabase key naming — new format (locked March 2026):**
- `sb_publishable_...` replaces legacy `anon` key — safe in browser and mobile client code
- `sb_secret_...` replaces legacy `service_role` key — server and Edge Functions only
- **Known Edge Function limitation:** Edge Functions currently only support JWT via legacy keys. Workaround to be documented when Edge Functions are built.

---

## 4. Coding Standards — Non-Negotiable

### 4.1 Error handling — verbose, always name the operation

```typescript
export async function generateHandoverPack(projectId: string) {
  const op = '[generateHandoverPack]';
  console.log(`${op} Starting for project: ${projectId}`);
  try {
    if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);
    const project = await fetchProject(projectId);
    if (!project) { console.warn(`${op} Not found: ${projectId}`); return null; }
    const docs = await assembleDocuments(project);
    console.log(`${op} Complete. ${docs.length} documents for project: ${projectId}`);
    return { projectId, documents: docs };
  } catch (error) {
    console.error(`${op} Failed:`, {
      projectId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}
```

### 4.2 Supabase queries — always handle error and null separately

```typescript
const { data: project, error } = await supabase
  .from('projects')
  .select('*, milestones:project_milestones(*)')
  .eq('id', projectId)
  .single();

if (error) {
  console.error('[getProject] Query failed:', { code: error.code, message: error.message, projectId });
  throw new Error(`Failed to fetch project: ${error.message}`);
}
if (!project) { console.warn('[getProject] Not found:', { projectId }); return null; }
return project;
```

### 4.3 Financial calculations — never use JavaScript floating point

```typescript
import Decimal from 'decimal.js';
// ❌ WRONG — 10000 * 0.18 = 1800.0000000000002
// ✅ CORRECT
const amt = new Decimal('10000.00');
const gst = amt.mul('0.18');   // Decimal('1800.00')
const total = amt.add(gst);    // Decimal('11800.00')
```

### 4.4 UUID generation — on device, not server

```typescript
// Client-generated UUIDs enable offline record creation on mobile
const newReport = {
  id: crypto.randomUUID(),
  report_date: new Date().toISOString().split('T')[0], // 'YYYY-MM-DD'
  created_on_device_at: new Date().toISOString(),
};
```

### 4.5 Indian number formatting

```typescript
function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount); // → ₹1,23,456
}
function shortINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount/10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000)    return `₹${(amount/100_000).toFixed(1)}L`;
  if (amount >= 1_000)      return `₹${(amount/1_000).toFixed(0)}K`;
  return `₹${amount}`;
}
```

### 4.6 Dates — UTC stored, IST displayed

```typescript
// All timestamps stored UTC. Date-only fields stored as 'YYYY-MM-DD' TEXT.
function toIST(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }); // → "20 Mar 2025, 02:30 PM"
}
```

### 4.7 Sensitive fields — never in logs

```typescript
// NEVER in logs: bank_account_number, aadhar_number, pan_number,
// gross_monthly, basic_salary, ctc_monthly, ctc_annual, net_take_home,
// commission_amount, pf_employee
console.error('[processPayroll] Failed for employee:', { employeeId: emp.id }); // ✅
```

### 4.8 Offline-first pattern (mobile app only)

```typescript
// Every mobile write: 1. Write to WatermelonDB (immediate, offline)
// 2. Background sync to Supabase when connected
// 3. On sync failure: exponential backoff — data NEVER lost
type SyncStatus = 'local_only' | 'syncing' | 'synced' | 'sync_failed';
// Tables with sync_status: daily_site_reports, site_photos, om_visit_reports,
// leave_requests, form_interaction_metrics
```

### 4.9 Comments — explain WHY, not WHAT

```typescript
// ✅ GOOD — explains a non-obvious decision
// Recompute only the affected project's cash position (not all 500+ active projects).
// Full portfolio recomputation takes ~25 seconds at scale.
const updated = await recomputeProjectCash(projectId);
```

### 4.10 Supabase client — use packages/supabase factory

```typescript
// BROWSER — client components. Singleton. RLS enforced.
import { createClient } from '@repo/supabase/client';
const supabase = createClient();

// SERVER — server components, Server Actions, Route Handlers. RLS enforced.
import { createClient } from '@repo/supabase/server';
const supabase = await createClient();  // async — reads cookies

// ADMIN — server only. Bypasses RLS. ONLY for system automation, nightly aggregations.
import { createAdminClient } from '@repo/supabase/admin';
const supabase = createAdminClient();

// MIDDLEWARE — session refresh in apps/erp/src/middleware.ts
import { updateSession } from '@repo/supabase/middleware';
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}
```

---

## 5. Database Schema — 134 Tables

### 5.0 Schema verification (as of March 29, 2026)

```
Total tables:    134
Total triggers:  91
RLS enabled:     ALL tables (verified — zero tables missing RLS)
Sequences:       proposal_number_seq, project_number_seq, invoice_number_seq,
                 credit_note_number_seq, receipt_number_seq, po_number_seq,
                 proforma_number_seq, ticket_number_seq
```

### 5.1 Universal conventions

```sql
-- Every table has:
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()  -- client-generated, not serial
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()

-- Soft delete (operational records only):
deleted_at  TIMESTAMPTZ  -- NULL = active, timestamp = deleted

-- Financial records (invoices, payments, POs, salary history):
-- NO deleted_at — immutable, never deleted, never soft-deleted

-- All monetary values:
amount      NUMERIC(14,2)  -- NEVER FLOAT or REAL

-- All IDs: UUID, generated on client device (enables offline creation)
```

### 5.2 Complete table inventory — all 134 tables

| Domain | Tables | Tables in schema |
|--------|--------|-----------------|
| Foundation | 2 | profiles, employees |
| Lead management | 19 | leads, lead_activities, lead_status_history, lead_documents, lead_site_surveys, lead_assignments, lead_competitors, lead_referrals, referral_rewards, lead_loss_reasons, lead_source_analytics, vip_contacts, vip_contact_interactions, channel_partners, channel_partner_leads, blacklisted_phones, regulatory_ecosystem_contacts, form_interaction_metrics, vendors |
| Proposal | 14 | proposals, proposal_revisions, proposal_bom_lines, proposal_simulations, price_book, proposal_scope_split, bom_correction_factors, proposal_correction_log, proposal_scenarios, proposal_digital_acceptance, proposal_otp_log, proposal_payment_schedule, proposal_analytics, proposal_status_history |
| Projects core | 11 | projects, project_assignments, project_milestones, project_milestone_weights, project_completion_components, project_change_orders, project_delay_log, tasks, project_issues, project_status_history, project_status_history |
| Projects procurement | 12 | qc_gate_inspections, qc_non_conformance_reports, purchase_orders, purchase_order_items, purchase_order_amendments, vendor_delivery_challans, vendor_delivery_challan_items, dc_signatures, goods_receipt_notes, grn_items, three_way_match, bill_clearing_packages |
| Installation & photos | 5 | daily_site_reports, site_report_corrections, site_photos, photo_gate_verifications, commissioning_reports |
| Financials & cash flow | 13 | invoices, invoice_credit_notes, customer_payments, vendor_payments, project_cash_positions, company_cashflow_snapshots, net_metering_applications, liaison_documents, liaison_objections, project_handovers, customer_checkins, project_profitability, project_cost_variances |
| Profitability | 1 | bom_correction_factor_updates |
| HR master | 9 | employee_compensation, salary_increment_history, employee_skills, employee_certifications, employee_documents, employee_lifecycle_events, employee_exit_checklists, system_logs, system_webhook_failures |
| Leave, payroll, insurance | 8 | leave_requests, leave_ledger, leave_balances, attendance_corrections, monthly_attendance_summary, payroll_monthly_inputs, payroll_export_files, employee_insurance |
| Training | 8 | training_modules, training_questions, employee_question_progress, onboarding_tracks, onboarding_track_assignments, daily_question_delivery_log, training_assessment_results, language_training_scenarios |
| O&M | 11 | om_contracts, om_pricing_rules, om_visit_schedules, om_visit_reports, om_visit_checklist_items, om_visit_corrections, om_service_tickets, plants, plant_data_readings, plant_daily_summaries, om_profitability |
| Inventory | 9 | stock_pieces, warranty_registrations, warranty_claims, stock_replacement_history, price_book_accuracy, rfq_requests, rfq_responses, subcontractor_work_orders, letters_of_intent |
| Marketing | 6 | drip_sequences, drip_sequence_steps, drip_sequence_enrollments, marketing_campaigns, marketing_campaign_deliveries, message_delivery_log |
| Document management | 11 | generated_documents, proforma_invoices, payment_receipts, hr_letters, customer_quarterly_reports, finance_reports, — (+ document numbering via sequences) |
| Audit & undo | 1 | record_audit_log |
| **TOTAL** | **134** | |

### 5.3 System spine — how tables connect

```
leads → proposals → projects → commissioning_reports → project_handovers
                                        ↓
                               om_contracts → om_visit_schedules → om_visit_reports
                                        ↓
                               customer_checkins → lead_referrals → (back to leads)
```

```
purchase_orders → vendor_payments → project_cash_positions
purchase_orders → vendor_delivery_challans → dc_signatures → bill_clearing_packages
purchase_orders → purchase_order_items → stock_pieces → warranty_registrations
```

```
employees → employee_compensation → salary_increment_history
         → employee_certifications (expiry blocks deployment)
         → leave_requests → leave_ledger → leave_balances
         → monthly_attendance_summary → payroll_monthly_inputs → payroll_export_files
```

```
tasks (entity_type + entity_id) → leads / projects / om_service_tickets / purchase_orders / employees
```

### 5.4 Computed summary tables

These are derived from source data. Kept in sync via database triggers and nightly n8n cron jobs.

| Summary table | Source tables | Refresh trigger |
|---------------|--------------|-----------------|
| `project_cash_positions` | customer_payments, vendor_payments, invoices, purchase_orders | Trigger on every payment INSERT + vendor payment INSERT |
| `company_cashflow_snapshots` | All project_cash_positions | Nightly cron → `generate_cashflow_snapshot()` RPC |
| `leave_balances` | leave_ledger (SUM per employee per type) | Trigger on every leave_ledger INSERT |
| `monthly_attendance_summary` | leave_requests + corrections | On leave approval, locked on 25th |
| `om_profitability` | om_visit_costs + revenue | After each visit report |
| `bom_correction_factors` | project_cost_variances | On project close via `bom_correction_factor_updates` |
| `price_book_accuracy` | vendor_payments + price_book | Trigger on purchase_order_items INSERT |

**Nightly cron functions (called by n8n, not DB triggers):**
- `lock_stale_reports()` — locks daily_site_reports and om_visit_reports older than 48h
- `generate_cashflow_snapshot()` — aggregates all project positions into company snapshot

### 5.5 All database triggers (91 total)

**updated_at triggers** — on every table with an updated_at column (fires set_updated_at() function)

**Business rule triggers:**
| Trigger | Table | What it does |
|---------|-------|-------------|
| `trigger_refresh_leave_balance` | leave_ledger | Upserts leave_balances after every INSERT |
| `trigger_refresh_cash_position` | customer_payments | Recomputes project_cash_positions |
| `trigger_refresh_cash_position_po` | purchase_orders | Recomputes on amount_paid change |
| `trigger_refresh_cash_position_inv` | invoices | Recomputes on total_amount change |
| `trigger_refresh_cash_position_vendor` | vendor_payments | Recomputes on vendor payment INSERT |
| `trigger_update_po_amount_paid` | vendor_payments | Keeps purchase_orders.amount_paid in sync |
| `trigger_update_price_book_accuracy` | purchase_order_items | Logs variance, sets update_recommended flag |
| `trigger_update_proposal_totals` | proposal_bom_lines | Recomputes all proposal financial fields |
| `trigger_ceig_block` | net_metering_applications | Blocks TNEB submission before CEIG approval |
| `trigger_ir_test_ticket` | commissioning_reports | Auto-creates critical ticket when IR < 0.5 MΩ |
| `trigger_ir_test_ticket_om` | om_visit_reports | Auto-creates critical ticket when IR < 0.5 MΩ |
| `trigger_update_override_rate` | proposal_correction_log | Updates correction factor override rate |
| `trigger_lead_status_change` | leads | Writes to lead_status_history |
| `trigger_proposal_status_change` | proposals | Writes to proposal_status_history |
| `trigger_project_status_change` | projects | Writes to project_status_history |
| `trigger_validate_payment_schedule` | proposal_payment_schedule | Enforces sum-to-100% (when proposal not draft) |
| `trigger_validate_milestone_weights` | project_milestone_weights | Enforces sum-to-100% per segment+system_type |
| `on_auth_user_created` | auth.users | Auto-creates profiles row on signup |

### 5.6 RLS role access matrix

| Role | Reads | Writes | Cannot see |
|------|-------|--------|-----------|
| `founder` | Everything | Everything | — |
| `hr_manager` | All HR/employee | All HR tables | Project financials |
| `sales_engineer` | **All leads** (team pipeline visibility), all proposals, price_book, marketing | All leads + proposals | Others' salary, project financials |
| `designer` | Qualified leads, proposals (own), price_book, correction_factors, lead_documents | Proposals (own draft), lead_documents (design files) | Salary, project execution, financials |
| `project_manager` | All assigned projects, procurement, O&M, tasks | Assigned projects, procurement, tasks | Salary data |
| `purchase_officer` | POs, vendors, price_book, RFQs, DCs, GRNs | POs, RFQs, DCs, GRNs, price_book | Salary, non-procurement financials |
| `site_supervisor` | Assigned + historical projects, own reports, own tasks | Daily reports, photos, issues | All financials |
| `om_technician` | Assigned contracts, tickets, plant data | Visit reports, ticket updates | Financials, HR |
| `finance` | All invoices, payments, project financials, vendor payments | Payment records, vendor payments | Salary data |
| `customer` | Own plant, documents, tickets | Service ticket creation | Any other customer's data |

**RLS helper functions (CRITICAL — never bypass):**
```sql
-- ALWAYS use these in RLS policies. NEVER use raw subqueries on profiles or employees.
get_my_role()          -- returns current user's app_role (SECURITY DEFINER, bypasses RLS)
get_my_employee_id()   -- returns current user's employee UUID (SECURITY DEFINER, bypasses RLS)
```
**RULE: NEVER write `(SELECT role FROM profiles WHERE id = auth.uid())` in any RLS policy. This causes infinite recursion. ALWAYS use `get_my_role()` instead. Same applies to employee lookups — use `get_my_employee_id()`.**

**Salary special rule:** `employee_compensation` and `salary_increment_history` — readable only by: the employee (own record), direct manager (direct reports), `hr_manager`, `founder`. Enforced at DB level.

**Sales engineer lead visibility decision (March 2026):** All sales engineers see all leads. Team pipeline visibility is more useful than strict ownership at Shiroi's current scale of ~5 sales staff. Can be tightened to own-leads-only in a future migration if needed.

### 5.7 Document numbering system

All outward documents get DB-generated reference numbers. Never manual. Sequences reset April 1 each financial year.

```
generate_doc_number('PROP') → 'SHIROI/PROP/2025-26/0042'
generate_doc_number('PROJ') → 'SHIROI/PROJ/2025-26/0087'
generate_doc_number('INV')  → 'SHIROI/INV/2025-26/0178'
generate_doc_number('CN')   → 'SHIROI/CN/2025-26/0003'
generate_doc_number('REC')  → 'SHIROI/REC/2025-26/0456'
generate_doc_number('PO')   → 'SHIROI/PO/2025-26/0234'
generate_doc_number('PI')   → 'SHIROI/PI/2025-26/0042'
```

### 5.8 File storage architecture

**The rule without exception:** Every document lives in Supabase Storage. The database stores path strings only.

The `generated_documents` table is the central registry for all 60 document types. Domain tables store a `current_pdf_storage_path` or FK to `generated_documents`. Versioning, signature tracking, and customer access control are all in `generated_documents`.

Storage capacity estimate: ~48 GB at scale. Supabase Pro includes 100 GB.

### 5.9 Tasks table — universal entity model

The `tasks` table (formerly `project_tasks`) uses an `entity_type + entity_id` pattern to support tasks across all domains:

```typescript
entity_type: 'project' | 'lead' | 'om_ticket' | 'procurement' | 'hr'
entity_id: UUID  // FK to the relevant domain record
```

For project tasks, `project_id` FK is also populated for efficient JOIN queries. For all other domains, only `entity_id` is used. This enables a unified "my tasks today" view across all domains in the mobile app home screen.

---

## 6. Business Rules by Domain

### 6.1 Leads & CRM

**Lead status flow (`lead_status` enum):**
```
new → contacted → site_survey_scheduled → site_survey_done → proposal_sent → design_confirmed → negotiation → won / lost / on_hold / disqualified
```
After `won`: lead status changes to `converted` when project is created. Terminal states: `lost`, `disqualified`, `converted`.

- Lead sources: referral, website, builder_tie_up, channel_partner, cold_call, exhibition, social_media, walkin
- A lead becomes a project ONLY after: proposal accepted AND advance payment received
- VIP contacts: founder manages personally; system drafts communications, human sends
- Blacklisted phones (`blacklisted_phones` table): never reassigned, never auto-messaged
- Channel partner commissions: TDS deducted at source if annual total > ₹10,000
- Referral rewards: ₹3,000–5,000/kWp residential, commercial negotiated; TDS above ₹10,000
- All automation pauses when customer has an open unresolved complaint
- **Duplicate phone prevention:** Partial unique index on `leads.phone` — same phone cannot appear in two active leads. Disqualified and lost leads are excluded from the uniqueness check so re-entry is possible.

### 6.2 Proposals
- BOM correction factors shown transparently — engineer sees raw AND corrected side-by-side
- Engineer can override — MUST provide reason (logged in `proposal_correction_log`)
- If override rate for a factor exceeds 80%: factor is flagged for review
- GST: equipment supply = 5% (HSN 8541); works contract (installation) = 18%
- Margin approval: below ₹5L auto-approved; above ₹10L requires founder approval
- Proposals valid 30 days. Expired <7 days: honour old price. Expired >7 days: auto-requote
- Scope split: each BOM line tagged Shiroi / client / builder / excluded
- Proposal numbering: `SHIROI/PROP/FY2025-26/0042/R1`
- **Payment schedule validation:** Sum of all milestone percentages must equal exactly 100% before proposal can be sent (enforced by DB trigger)
- Simulation: PVWatts primary → PVLib microservice fallback. Both always implemented.

### 6.3 Projects
- Three QC gates are also payment gates:
  - Gate 1: Materials QC → unlocks delivery invoice (40% milestone)
  - Gate 2: Mid-installation QC (PM visit) → allows electrical work
  - Gate 3: Pre-commissioning QC → unlocks commissioning invoice (20%)
- MSME vendor payments: 45-day maximum (legal). System alerts Day 40. `vendor_payments` table tracks individual payment dates for MSME compliance proof.
- Three-way match enforced: PO quantity vs DC quantity vs GRN quantity
- Change orders required for any scope change post-acceptance
- Delay responsibility always recorded: shiroi / client / vendor / discom / weather / ceig

### 6.4 Cash flow
- `is_invested = true` when net_cash_position < 0 — Shiroi is funding the project
- Soft block: no PO before advance received (PM override with confirmation)
- Uninvoiced milestone alert: Finance notified after 48 hours
- Overdue customer invoice escalation: Day 1 sales → Day 5 manager → Day 10 founder → Day 30 legal flag
- Overdue vendor invoice: daily alert; MSME vendors escalate Day 3
- `vendor_payments` table: individual payment records with date, method, reference — MSME tribunal-ready

### 6.5 Inventory
- Every physical item tracked individually in `stock_pieces` (not just totals)
- Cut-length materials: track by `current_length_m`; below `minimum_usable_length_m` → auto-flag scrap
- Warranty chain: serial number → purchase invoice → signed DC → commissioning report
- CEIG approval required for >10kW commercial before TNEB — hard DB trigger block

### 6.6 Net metering & liaisoning
- Two parallel processes: CEIG (for >10kW) AND TNEB/DISCOM
- CEIG block enforced by DB trigger: `ceig_status` must be `approved` before `discom_status` can advance from `pending`
- Documents in `liaison_documents` table (each has its own lifecycle)
- Objections in `liaison_objections` table (queryable — not jsonb)
- Automatic follow-up tasks: Day 7/14/21 after TNEB submission, Day 30/45 escalation

### 6.7 O&M
- 4 free quarterly visits in Year 1 (warranty period) — auto-created on commissioning
- AMC quote auto-generated and included in handover pack
- Visit cost baseline: ₹1,100 local residential → ₹4,300+ outstation commercial
- AMC price ceiling: 12% of customer's annual solar savings
- Target O&M gross margin: 30%
- `repricing_recommended` auto-set at renewal if actual margin < minimum threshold
- **O&M visit corrections:** `om_visit_corrections` table mirrors `site_report_corrections` — Tier 2 correction model applies to O&M visit reports after 48h lock

### 6.8 HR & Payroll
- **Zoho Payroll stays for auditors.** ERP is the master data source.
- Payroll export: ERP generates Zoho-compatible CSV on 25th of every month
- Employee certifications with `blocks_deployment = true`: expiry → auto-blocks site assignment
- Employee exit: ERP access revoked same day as `last_working_day`
- Leave ledger is immutable — corrections via reversal entries only
- Sensitive fields encrypted at column level: Aadhar, bank account number (pgcrypto)

### 6.9 Training
- Daily microlearning: 3–5 questions per employee at 9am via WhatsApp (n8n)
- Spaced repetition: wrong → tomorrow; 1 correct → +3 days; 2 → +7 days; 3+ → +30 days (mastered)
- Time-sensitive questions (tariff rates, subsidy amounts): `accuracy_review_date` enforced
- Onboarding tracks gate deployment: safety modules must complete before site assignment

### 6.10 WhatsApp
- **Phase 1 (immediate):** n8n generates message → employee's WhatsApp → employee forwards to customer
- **Phase 2 (after BSP registration):** Direct sending via WATI.io
- `drip_sequence_steps.delivery_method_active` column: flip from `employee_forward` to `direct_api` per step when Phase 2 goes live. No migration needed.
- `message_delivery_log` table: tracks the employee forwarding leg — which employee received, whether they forwarded, and when
- All automation pauses when customer has open unresolved complaint

---

## 7. Undo & Correction Model

Every record belongs to exactly one tier. Before writing any update/delete endpoint, identify the tier.

### Tier 1 — Freely editable
**Records:** Lead details, daily site reports (within 48h), tasks, open issues, draft proposals, pending leave requests, training questions, upcoming maintenance schedule items.

**Rules:** Direct edit allowed. Every edit logged in `record_audit_log` in same transaction.

### Tier 2 — Correction-by-new-record
**Records:** Daily reports locked (>48h), O&M visit reports locked (>48h), QC inspections after PM sign-off, attendance after payroll export, approved leave.

**Tables:** `site_report_corrections`, `om_visit_corrections`, `attendance_corrections`

**Rules:** Cannot edit in place. Correction request submitted with mandatory reason. Manager approves → correction record created, original flagged `has_correction = true`.

### Tier 3 — Immutable forever
**Records:** Sent invoices, processed payments (customer and vendor), signed DCs, commissioning reports, salary increment history, all leave_ledger entries, signed proposals, proposal OTP logs.

**Rules:** No edit. No delete. Ever. Corrections via credit notes / reversal entries / addenda only.

---

## 8. Field Friction Standards

**The 90-second rule:** Any mobile form must complete in under 90 seconds for the common case.

### Pre-population mandate
- Today's date → always pre-filled
- Active project → auto-selected from supervisor's assignment
- Current milestone → from project schedule
- Worker count → default to yesterday's count, one-tap confirm or change
- Weather → default sunny, one-tap to change

### Progressive disclosure
Mandatory fields first. Optional detail behind "Add more →" tap. Submit available after mandatory fields.

### Alert thresholds (rolling 7-day average)
- `daily_report` > 180s → alert
- `lead_entry` > 90s → alert
- `om_checklist` > 420s → alert

Tracked in `form_interaction_metrics` table.

---

## 9. Completion Percentage Model

**Principle:** Supervisors enter facts. The system calculates the percentage. No subjective estimates.

| Milestone | Calculated from | Supervisor inputs |
|-----------|----------------|-------------------|
| Material delivery | items_received / BOM_total | Tick: panels / inverter / structure / cables received |
| Structure installation | 5-step checklist | Tick: columns / rails / bracing / tilt verified / torque done |
| Panel installation | panels_cumulative / panels_total × 100 | Tap: how many panels today |
| Electrical work | 5-component checklist | Tick: inverter / ACDB / strings / AC cable / earthing |
| Commissioning | 4-gate checklist | Tick: QC pass / inverter live / generation confirmed / customer signed |

**Project-level:** Weighted average of milestone percentages.
Default weights: delivery 15% · structure 15% · panels 25% · electrical 20% · commissioning 10% · testing 5% · civil 5% · net metering 5%.

**Milestone weight validation:** DB trigger enforces weights sum to exactly 100% per segment+system_type combination.

---

## 10. UI/UX Approach & Design System

### No Figma required
```
1. Claude writes screen specification (data, interactions, states, edge cases)
2. Claude generates working Next.js/Tailwind component
3. Reviewed in browser on local dev server
4. v0.dev for visually complex components — paste spec, iterate, copy code
5. Screens are production code from the start
```

### Design system
Shiroi Brand Guide V6 as foundation. `packages/ui` holds tokens, shadcn/ui overrides, Tailwind config.

**packages/ui v2.2 — 22 components:**
- Core: Button, Input, Label, Select, Badge, Card, Table, Checkbox, Pagination
- Radix primitives: Dialog (focus-trap), Sheet (slide-over), Tabs, Tooltip, DropdownMenu
- Patterns: Logo/LogoMark (SVG brand mark), Eyebrow (V2 section label), EmptyState, Skeleton/TableSkeleton/KpiCardSkeleton, Breadcrumb, SkipToContent
- Form infra: Form/FormField/FormItem/FormLabel/FormControl/FormMessage (react-hook-form + Zod)
- Toast: Toaster/useToast (non-destructive notifications)
- Accessibility: skip-to-content, visited link styles, prefers-reduced-motion, responsive font scaling
- All hex colors replaced with Tailwind tokens (shiroi-*, n-*, status-*) — zero hardcoded hex in components

### 8 priority screens — build in this order

| # | Screen | Surface | Why critical |
|---|--------|---------|-------------|
| 1 | Founder morning dashboard | ERP web | Cash, pipeline, alerts |
| 2 | Lead pipeline + lead detail | ERP web | Sales team daily driver |
| 3 | Proposal creation flow | ERP web | BOM complexity, margin logic |
| 4 | Project detail + milestones | ERP web | PM primary workspace |
| 5 | Project cash position | ERP web | Most important financial screen |
| 6 | Daily site report | Mobile | 90-second constraint, offline |
| 7 | O&M visit checklist | Mobile | Checklist + photos + readings |
| 8 | Service ticket lifecycle | Customer + ERP | Multi-actor, SLA enforcement |

### Design principles per surface
- **ERP web:** Dense, data-rich, desktop. Sidebar navigation. Tables not cards.
- **Mobile field app:** Minimal, large touch targets, works with gloves. Bottom tab navigation.
- **Customer app:** Consumer-grade polish. Clean, spacious. No jargon.

---

## 11. Data Migration Strategy

### What data exists and import priority

| Data | Volume | Priority | Value |
|------|--------|----------|-------|
| Projects — full actual vs budgeted | ~100 | **Critical — do first** | Seeds BOM correction factors |
| Projects — partial data | ~200 | High | Customer portal, O&M baseline |
| Projects — commissioning data only | ~200 | Medium | Plant records, customer app |
| HubSpot proposals (deal records) | ✅ 1,115 leads migrated | High | Historical win rate, pipeline analytics |
| Google Drive proposal documents | ~1,800 folders | Low | Archival reference only |

### Import sequence

```
Before go-live:
  1. ✅ DONE — HubSpot CSV export → 1,115 leads + 314 proposals + 314 projects + 30 payments (V2: 0 unmatched)
  2. ✅ DONE — Google Drive projects (full actuals) → 108 vendors, ~160 projects, 850 POs, 2,348 items, 1,164 expenses, 916 files
  3. 🔜 NEXT — 1,300 proposals from Google Drive folders → proposals table + archived PDFs
  4. 🔜 — Full Drive scan → upload all remaining files to Supabase Storage

First month post-launch:
  5. Partial project data reconciliation → cross-check all sources
  6. Commissioning data → plants + customers tables

Nice to have:
  7. Full proposal content extraction from Google Drive documents
```

### Google Drive extraction with Gemini
Gemini Advanced reads Drive natively → extracts headline data → Google Sheet → export CSV → Claude writes import scripts.

### HubSpot export — ✅ COMPLETE (April 3, 2026)
Scripts: `scripts/migrate-hubspot.ts` (V1) + `scripts/fix-hubspot-v2.ts` (V2 fixes) — two-phase (deals + payments), idempotent, dry-run support.

**Final stats (after V2 fixes):**
- **1,115 leads**, 314 proposals, 314 projects, 30 payments
- Project FY distribution: 2024-25: 50, 2025-26: 264
- **0 unmatched payments** — all stages properly mapped
- Three-tier dedup: hubspot_deal_id exact → customer_name+size → customer_name fuzzy (209 records audited, 18 flagged)
- PV number parsing: strips HTML tags, extracts `PV###/YY-YY`, normalizes FY format (V2 fixed dash format for 329 more)
- Won deals create full chain: lead (status:won) → proposal (status:approved) → project
- V2 created 6 new projects (Maharajan, Subramaniam Nithya, Rakshas Enterprises, Radiance Splendour Coimbatore, GRN Rajagopal, Navins Hanging Garden)
- V2 fixed false-positive dedup matches (RCC/Adroit/Srestha)
- Data integrity verified: 0 orphaned proposals/projects, all FKs valid

**HubSpot stage → lead_status mapping:**
| HubSpot Stage | ERP lead_status | Notes |
|---------------|----------------|-------|
| To check | `new` | Default/unworked leads |
| Appointment Scheduled | `site_survey_scheduled` | |
| Site Visit Completed | `site_survey_done` | |
| Proposal Sent | `proposal_sent` | |
| Design Confirmation | `design_confirmed` | New enum value, migration 011 |
| Negotiation / Final Negotiation | `negotiation` | Both HubSpot stages map to same status |
| Closed Won | `won` | Creates full lead → proposal → project chain |
| Closed Lost | `lost` | |

**HubSpot payment stage mapping:**
| HubSpot Payment Stage | ERP mapping | Notes |
|----------------------|-------------|-------|
| Advance | `customer_payments` with `is_advance = true` | |
| Supply / Installation / Commissioning / Retention | `customer_payments` with `is_advance = false` | Stage name stored in payment notes |

**Duplicate phone handling during migration:** The partial unique index on `leads.phone` will block imports of duplicate active leads. Migration script deduplicated by name+size before import.

---

## 12. Integration Specifications

### 12.1 NREL PVWatts API (primary simulation)
```
Endpoint: GET https://developer.nrel.gov/api/pvwatts/v8.json
Params:   api_key, system_capacity, lat, lon, tilt, azimuth, losses
Response: ac_monthly[] — 12 monthly kWh values
Limit:    1,000 calls/hour (free tier)
Timeout:  8 seconds → on failure, call PVLib microservice
```

### 12.2 PVLib microservice (fallback)
```
Location: Spare laptop, port 5001
URL:      http://[laptop-static-ip]:5001/simulate
Method:   POST
Body:     { lat, lon, system_capacity_kw, tilt, azimuth, losses_pct }
Response: { monthly_kwh[], annual_kwh, p50, p75, p90 }
```

### 12.3 Claude API
```typescript
model: 'claude-sonnet-4-20250514'
max_tokens: 500
// Uses: daily report AI narratives, WhatsApp draft, quarterly check-in reports
// Budget: ~500 calls/day — set daily spend limit in Anthropic console
// NEVER log prompt content containing customer personal data
```

### 12.4 Supabase → n8n webhooks
```
Auth:    Shared secret in HTTP header X-N8N-Webhook-Secret
Failure: Log to system_webhook_failures → n8n polls and retries on startup
```

### 12.5 Zoho Payroll CSV export format
```
Columns: employee_id, full_name, uan_number, esic_number, paid_days, lop_days,
         basic_salary, hra, special_allowance, travel_allowance, other_allowances,
         variable_pay, one_time_additions, one_time_deductions, pf_employee,
         esic_employee, professional_tax, remarks
Generated: 25th of every month
```

### 12.6 Inverter monitoring APIs
```
Sungrow:  iSolarCloud API (4–8 weeks approval)
Growatt:  server-api.growatt.com (similar timeline)
Frequency: Pull every 15 minutes → raw data in plant_data_readings
Nightly:  Aggregate to plant_daily_summaries
Missing:  Store NULL (not zero) — zero = zero generation; NULL = no data
```

### 12.7 WhatsApp Phase 1 (employee forward)
```
n8n generates message → sends to employee → employee forwards to customer
Tracked in: message_delivery_log table
Toggle to Phase 2: flip drip_sequence_steps.delivery_method_active per step
```

### 12.8 WhatsApp Phase 2 (WATI.io direct)
```
BSP: WATI.io — registration in progress
Cost: ~₹3,000/month
Number: Existing Shiroi company number
```

### 12.9 WhatsApp Historical Import (Phase 1 — Complete, Approved)

**Purpose:** Extract structured data from 3 WhatsApp group chat exports, enrich, and insert into ERP target tables.

**Groups processed:**
| Group | Chat Size | Records Extracted | Key Data Types |
|-------|-----------|-------------------|----------------|
| Shiroi Marketing | 7,771 lines | 152 | 50 customer_payments, 30 POs, 32 contacts, 40 activities |
| Shiroi Energy LLP / rooftop / Purchase | ~4,800 lines | 186 | 115 BOQ items, 27 POs, 15 customer_payments, 24 activities |
| Shiroi Energy ⚡ (main ops) | 40,621 lines | 3,826 | 403 daily_reports, 3,100 activities, 298 contacts, 25 financial |

**Data inserted into target tables (April 9, 2026):**
| Table | Before | After | Added |
|-------|--------|-------|-------|
| activities | 0 | 3,320 | +3,320 |
| daily_site_reports | 0 | 210 | +210 |
| contacts | 1,115 | 1,390 | +275 |
| project_boq_items | 116 | 251 | +135 |
| customer_payments | 30 | 70 | +40 |

All 4,164 queue records: **0 pending**, all approved. 46 duplicate contacts cleaned (phone dedup). 0 FK violations.

**Architecture:**
- ZIP export parser: `scripts/whatsapp-import/parser.ts` — handles Android/iPhone format, U+202F narrow no-break space in timestamps, Unicode control chars
- Rule-based extractor (no LLM): `scripts/whatsapp-import/extract-local.ts` — pattern-matching for payments, contacts, POs, BOQ items, daily reports, activities
- Enrichment + batch approve: `scripts/whatsapp-import/enrich-and-approve.ts` — fuzzy project matching, Indian amount parsing, activity type validation, bulk insert into target tables
- Large ZIP support (3.3 GB): `node-stream-zip` for streaming extraction without loading into memory
- Review queue: `whatsapp_import_queue` table (migration 025) — all records staged, enriched, and approved
- Review UI: `/whatsapp-import` — stats grid, filter tabs, paginated table, approve/reject/reassign actions
- Approval actions: `whatsapp-import-actions.ts` — customer_payment, task, activity, daily_report, contact, boq_item cases + batch approve/reject

**Dedup:** SHA-256 hash of `timestamp|sender|text[:100]` stored as UNIQUE index on `message_hash`. Re-running the script is safe.

**To re-run extraction:** `cd scripts/whatsapp-import && npx tsx extract-local.ts`
**To re-run enrichment + approval:** `cd scripts/whatsapp-import && npx tsx enrich-and-approve.ts` (or `--dry-run`)

**Phase 2 (live Baileys bot):** Deferred. Scaffolded profiles in `scripts/whatsapp-import/profiles/` ready. Needs dedicated phone number + bot setup.

---

## 13. Security Model

### Authentication
| User type | Method | Session |
|-----------|--------|---------|
| ERP employees | Email + password | 8 hours |
| Mobile field staff | Phone + OTP | 30 days |
| Customer app | Phone + OTP | 90 days |
| WhatsApp training bot | Phone matched to employees table | No session |

### Three core RLS patterns (using helper functions — NEVER raw subqueries)

**Salary data isolation:**
```sql
CREATE POLICY "salary_restricted" ON employee_compensation FOR SELECT USING (
  employee_id = get_my_employee_id()
  OR employee_id IN (SELECT id FROM employees WHERE reporting_to_id = get_my_employee_id())
  OR get_my_role() IN ('hr_manager', 'founder')
);
```

**Cross-project financial isolation:**
```sql
CREATE POLICY "project_cash_by_assignment" ON project_cash_positions FOR SELECT USING (
  get_my_role() = 'founder'
  OR EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = project_cash_positions.project_id
    AND pa.employee_id = get_my_employee_id() AND pa.unassigned_at IS NULL
  )
);
```

**Customer data isolation:**
```sql
CREATE POLICY "customer_own_plant_only" ON plants FOR SELECT USING (
  customer_profile_id = auth.uid()
  OR get_my_role() != 'customer'
);
```

**CRITICAL RLS RULE:** Never use `(SELECT role FROM profiles WHERE id = auth.uid())` or `(SELECT id FROM employees WHERE profile_id = auth.uid())` in any RLS policy. These cause infinite recursion. Always use `get_my_role()` and `get_my_employee_id()` which are SECURITY DEFINER functions that bypass RLS. See migration 008a.

### Encryption
- `aadhar_number` and `bank_account_number`: column-level encryption via pgcrypto (already enabled)
- Never in API responses unless explicitly requested by authorised role
- Never in logs, error messages, or audit records

---

## 14. Observability & Monitoring

### Sentry — LIVE (April 2, 2026)

**Package:** `@sentry/nextjs` v10.46.0 (installed in apps/erp)

**Configuration files:**
- `apps/erp/sentry.client.config.ts` — browser SDK, 10% traces, 100% error replays
- `apps/erp/sentry.server.config.ts` — Node.js server SDK, 10% traces
- `apps/erp/sentry.edge.config.ts` — Edge runtime SDK, 10% traces
- `apps/erp/src/instrumentation.ts` — registers server/edge configs + `onRequestError` capture
- `apps/erp/src/app/global-error.tsx` — React error boundary, reports to Sentry
- `apps/erp/next.config.js` — `withSentryConfig` wrapper, source maps, `/monitoring` tunnel route

**Env vars (all in .env.local):**
- `NEXT_PUBLIC_SENTRY_DSN` — client-side (must have NEXT_PUBLIC_ prefix for browser)
- `SENTRY_DSN` — server-side / webpack build plugin
- `SENTRY_ORG` — org slug for source map uploads
- `SENTRY_PROJECT` — project slug

**Behaviour:** SDK enabled in production only. Every unhandled exception → Sentry → email alert to Vivek.

**Mobile (future):** `npx expo install @sentry/react-native` when React Native app is built.

### system_logs table
Critical edge function operations logged here after completion. Never log: salary, Aadhar, bank account, PAN.

### n8n global error handler
One workflow "Global Error Handler" triggers on any workflow failure. Sends WhatsApp to admin.

### Business alert thresholds
| Condition | Alert to | Urgency |
|-----------|---------|---------|
| Project cash-negative >3 days | Vivek daily digest | High |
| No daily report by 7pm | PM via WhatsApp | Medium |
| Payroll export not generated by 25th | Vivek immediate | Critical |
| Employee certification expires in 30 days | Employee + manager | High |
| Insurance addition pending >25 days from join | HR | High |
| DISCOM objection open >14 days | PM | Medium |
| Service ticket approaching SLA breach | Technician + escalation | High |
| Plant no monitoring data for 24h | O&M technician | Medium |
| MSME vendor payment approaching Day 40 | Finance | High |

---

## 15. Build Phases & Roadmap

### Phase 1 — Foundation (Weeks 1–12)
**Goal:** Vivek opens ERP at 8am → sees cash-negative projects, pending proposals, overdue reports, this month's payroll.

**Environment setup — COMPLETE ✅**
- [x] GitHub organisation and repo created
- [x] Node 24, pnpm, Git installed on Windows Surface Pro dev machine
- [x] Turborepo monorepo scaffolded and pushed to GitHub
- [x] apps/erp (Next.js 14) running on localhost:3000
- [x] Supabase dev + prod projects created
- [x] .env.local configured with new key format
- [x] git config core.autocrlf false

**Database build — COMPLETE ✅**
- [x] Foundation tables: profiles, app_role enum, employees (001)
- [x] Lead domain: vendors, leads, activities, surveys, referrals, channel partners, blacklist, VIP contacts, regulatory contacts (002a, 002b)
- [x] Proposal domain: proposals, BOM, simulations, price book, correction factors, digital acceptance, payment schedule (003a, 003b, 003c)
- [x] Project domain: projects, milestones, QC gates, procurement, DCs, GRN, three-way match, site reports, photos, commissioning (004a, 004b, 004c)
- [x] Financial domain: invoices, payments, cash positions, net metering, handover, P&L, cost variances (004d)
- [x] HR domain: compensation, skills, certifications, lifecycle, exit checklists, system logs (005a)
- [x] Leave, payroll, insurance (005b)
- [x] Training domain: microlearning, spaced repetition, onboarding tracks (005c)
- [x] O&M domain: contracts, visits, checklists, tickets, plants, monitoring, profitability (005d)
- [x] Inventory: stock pieces, warranties, RFQ, work orders (006a)
- [x] Marketing + document management: drip sequences, campaigns, generated_documents registry (006b)
- [x] Audit log + all system triggers (006c)
- [x] Patches: vendor_payments, sum validation, WhatsApp tracking, phone dedup, trigger fixes, universal tasks (007a–007f)
- [x] Schema verified: 134 tables, 91 triggers, RLS on all tables
- [x] TypeScript types generated: packages/types/database.ts

**Supabase client — COMPLETE ✅**
- [x] Step 6 — packages/supabase: browser client (client.ts), server client (server.ts), admin client (admin.ts), middleware helper (middleware.ts)
- [x] All clients typed against Database from packages/types/database.ts
- [x] Uses @supabase/ssr v0.9.0 with getAll/setAll cookie pattern (no deprecated get/set/remove)
- [x] Full monorepo type check passes (4/4 packages, zero errors)

**Phase 1A ERP build — COMPLETE ✅ (March 30, 2026)**
- [x] Step 7 — Design system: packages/ui with 22 components (v2.2), Radix primitives, Logo/Eyebrow patterns, form infra, formatters (8 tests)
- [x] Step 8 — Auth + app shell: login, middleware, role-based sidebar, topbar (5 tests)
- [x] Step 9 — Founder morning dashboard: cash alerts, pipeline, approvals, overdue reports (4 tests)
- [x] Step 10 — Lead pipeline: list, detail, creation, status transitions, activity feed (13 tests)
- [x] Step 11 — Proposal engine: BOM, GST, PVWatts/PVLib, payment schedule, wizard (19 tests)
- [x] Step 12 — Project lifecycle: list, detail (5 tabs), milestones, QC, change orders, delays (9 tests)
- [x] Step 13 — Procurement: POs, DCs, GRN, three-way match, MSME compliance (17 tests)
- [x] Step 14 — Cash position dashboard: company + per-project, invoice escalation (18 tests)
- [x] Step 15 — HR master: employees, compensation (server-gated), leave, payroll CSV (9 tests)
- [x] Step 16 — Daily site reports: 48h lock, photo upload, Tier 2 correction (11 tests)
- [x] Step 17 — Deployment setup: Sentry config, global error boundary
- [x] Step 18 — Data migration scripts: HubSpot, actuals, commissioning (17 tests via utils)
- [x] Migration 008a — RLS recursion fix: get_my_role() + get_my_employee_id()
- [x] Total: 113 tests passing, 0 type errors, 23 pages, 21 components, 29 lib files

**Deployment — READY FOR SETUP**
- [ ] Vercel connected to GitHub repo
- [ ] Git branching: main (prod) / staging / feature branches
- [ ] Domain: erp.shiroienergy.com

**Phase 2A — Role-Specific Dashboards — COMPLETE ✅ (April 1, 2026)**
- [x] Step 19 — DB migration 009: `designer` + `purchase_officer` roles + 25 RLS policy updates (SQL ready, paste into SQL Editor)
- [x] Step 20 — Role-adaptive dashboard router + sectioned sidebar (10 roles) + founder role switcher (?view_as=)
- [x] Step 21 — PM Dashboard (4 KPIs, project summary, overdue alerts) + 10-step project stepper (10 step components, queries, page route)
- [x] Step 22 — Designer dashboard (4 KPIs, design queue table) + design queue page + workspace page
- [x] Step 23 — Purchase officer dashboard (4 KPIs, MSME alerts, PO table) + vendors + price book pages
- [x] Step 24 — Site supervisor dashboard (active project card, report status CTA, recent reports)
- [x] Step 25 — Sales dashboard (4 KPIs, follow-ups, lead funnel) + marketing + liaison pages
- [x] Step 26 — Finance dashboard (4 KPIs, cash alerts) + invoices + payments + profitability pages
- [x] Step 27 — HR dashboard (4 KPIs, cert alerts, leave requests) + leave + training + certifications pages
- [x] Step 28 — Founder dashboard enhanced with 4 KPI cards
- [x] Step 29 — Cross-role testing: 142 tests passing, 0 type errors, 0 V1 colors remaining
- [x] V2 Design System applied: DM Sans headings, warm-gray neutrals, all V1 colors purged

**Phase 2B — All Screens + Data Migration — COMPLETE ✅ (April 3, 2026)**
- [x] Step 30 — Migration 010: lead_status 'converted' enum + project_site_expenses table + project-files storage bucket
- [x] Step 31 — Google Drive migration script (scripts/migrate-google-drive.ts) — 5-phase pipeline with caching + timeouts
- [x] Step 32 — Phase 1: 108 vendors migrated from Google Drive project folders
- [x] Step 33 — Phase 2: ~160 projects migrated (leads → proposals → projects chain)
- [x] Step 34 — Phase 3: 850 purchase orders with 2,348 line items
- [x] Step 35 — Phase 4: 1,164 project site expenses
- [x] Step 36 — Phase 5: 916 files uploaded to Supabase Storage (15 expected failures: DWG format, oversize, transient)
- [x] Step 37 — All 53 ERP route pages built with real Supabase queries (0 placeholders remaining)
- [x] Step 38 — 20 type errors fixed across 12 files (wrong column names corrected against database.ts)
- [x] Step 39 — Full build verified: 53 routes, 0 TypeScript errors
- [x] Step 40 — Migration 011: `design_confirmed` lead_status enum value for HubSpot stage mapping
- [x] Step 41 — Migration 012: lead_status_history.changed_by nullable for migration/admin operations
- [x] Step 42 — HubSpot V2 migration: 1,115 leads, 314 proposals, 314 projects, 30 payments, 0 unmatched

**New screens built in Phase 2B:**
- Procurement: /procurement, /deliveries, /vendor-payments, /msme-compliance
- Vendors: /vendors (full vendor list with search/filter)
- Tasks: /tasks (all tasks), /my-tasks (personal)
- Daily Reports: /daily-reports (all), /my-reports (personal)
- Finance: /invoices, /payments, /profitability
- QC: /qc-gates (gate inspections)
- HR: /hr/employees, /hr/leave, /hr/training, /hr/certifications
- O&M: /om/visits, /om/tickets, /om/amc
- Sales: /marketing (overview), /marketing/campaigns
- Liaison: /liaison (overview), /liaison/net-metering
- Design: /design (design queue from leads)
- Reference: /price-book

**UI/UX Overhaul — Round 1 + Round 2 — COMPLETE ✅ (April 5, 2026)**

Round 1 (15 improvements):
- [x] Sidebar collapse/expand (desktop toggle w/ localStorage, mobile hamburger via Sheet)
- [x] Table overflow-x-auto for horizontal scroll on small screens
- [x] Form validation infra (react-hook-form + Zod, Form components in packages/ui)
- [x] Hardcoded hex → Tailwind design tokens (initial pass)
- [x] EmptyState component deployed to 23 pages
- [x] Skeleton loading screens (7 loading.tsx files: dashboard, leads, projects, contacts, procurement, cash, hr)
- [x] Radix Dialog rewrite (focus trapping, Escape key, animations)
- [x] Skip-to-content accessibility landmark
- [x] Responsive font scaling (mobile: 9→10px, 10→11px, 11→12px)
- [x] Visited link styling (shiroi-green-dark)
- [x] Toast notifications on login + contact + company forms
- [x] New Radix components: Sheet, Tabs, Tooltip, DropdownMenu
- [x] Breadcrumbs on 4 detail pages (contact, company, lead, proposal)
- [x] Column picker drag-drop visual feedback (opacity + green border)
- [x] Logo/LogoMark SVG component deployed to sidebar + login
- [x] Eyebrow pattern deployed to 6 pages
- [x] prefers-reduced-motion support in globals.css

Round 2 (post-audit, 9 items):
- [x] R2-1: Hex → token purge across 45+ component files (11 UI + 34 ERP)
- [x] R2-2: 15 new loading.tsx skeleton screens (companies through marketing/campaigns)
- [x] R2-3: EmptyState on 15 more pages (detail sub-sections, dashboard widgets, HR error states)
- [x] R2-4: Eyebrow pattern on 25 more pages (total: 31 pages)
- [x] R2-5: Breadcrumbs on 4 more detail pages (design, cash, HR employee, lead)
- [x] R2-6: Toast notifications on 5 more forms (lead, activity, employee, leave, proposals)
- [x] R2-7: Sidebar hardcoded colors → design tokens
- [x] R2-8: Dashboard component tokens (KPI cards, charts, tables)
- [x] R2-9: Status badge colors use status-* semantic tokens
- [x] R2-10: Form migration to react-hook-form+Zod — deferred for incremental migration during feature work (infra already in place)

Total: 105 files changed, 0 TypeScript errors. Design system: 22 components in packages/ui.

### Phase 2 — Field & Customer (Weeks 13–24)
- [ ] Offline-first mobile (WatermelonDB)
- [ ] Photo gates, GPS verification
- [x] AI daily report narrative (Claude API, Apr 4 2026)
- [x] Net metering + CEIG full tracking (Apr 4 2026)
- [x] Handover pack auto-generation (Apr 4 2026)
- [ ] Customer app (portal, documents, e-card, service tickets)
- [ ] O&M contracts, scheduling, visit checklists
- [x] Inventory cut-length tracking (Apr 4 2026) — DC signatures pending
- [ ] n8n WhatsApp automations (Phase 1 employee-forward)
- [ ] Completion percentage model (objective tracking)
- [ ] Intermediaries table (billing-through-architect commercial arrangement)

### Phase 3 — Intelligence (Weeks 25–36)
- [ ] Plant monitoring (Sungrow/Growatt APIs)
- [ ] Quarterly check-ins with AI narrative
- [ ] BOM correction factor active feedback loop
- [ ] Daily microlearning WhatsApp engine
- [ ] Onboarding tracks and assessments
- [ ] O&M profitability analytics
- [ ] PVLib microservice (higher accuracy simulation)
- [ ] Google Drive historical proposals archiving

### Phase 4 — Scale (Weeks 37–52)
- [ ] WhatsApp Business API direct (WATI.io, after registration)
- [ ] GST e-invoicing (if approaching ₹5Cr threshold)
- [ ] Full referral program automation
- [ ] Language training bilingual scenarios
- [ ] Market salary benchmarking analytics
- [ ] External customer-facing proposal portal
- [ ] OpenRouter for model flexibility

---

## 16. All Decisions Log

| Decision | Resolution | Date |
|----------|-----------|------|
| Multi-entity | Single-tenant — Shiroi Energy only. No `company_id` on any table. | Mar 2026 |
| File storage | Files stored in Supabase Storage — never in DB. DB stores path strings only. | Mar 2026 |
| Historical proposals | 1,800 old Google Drive PDFs migrate to Supabase Storage `proposals/historical/`. Gemini extracts data, Claude writes import scripts. | Mar 2026 |
| Document registry | Single `generated_documents` table is master registry for all 60 document types. Centralises versioning, status, signature tracking, access control. | Mar 2026 |
| Document numbering | All outward docs get SHIROI/TYPE/FY/SEQ reference numbers. DB sequences. Reset April 1. | Mar 2026 |
| Payroll tool | Zoho Payroll stays for auditors. ERP is master. Monthly CSV export to Zoho. | Mar 2026 |
| Simulation primary | NREL PVWatts API — free, HTTP, works from Edge Functions | Mar 2026 |
| Simulation fallback | PVLib Python microservice on spare laptop — same machine as n8n | Mar 2026 |
| Server hardware | Spare laptop: n8n (5678) + PVLib (5001). Ubuntu. Always-on. systemd services. | Mar 2026 |
| Build approach | Vivek + Claude only. No Codex, no Cursor, no multi-agent. Claude writes all code/SQL in chat. Vivek copies, commits, pushes. | Mar 2026 |
| Supabase environments | Two projects only: shiroi-erp-dev and shiroi-erp-prod. Third if needed at go-live. | Mar 2026 |
| Supabase CLI | Deferred. Migrations via Supabase SQL Editor. CLI added only if local dev becomes necessary. | Mar 2026 |
| Supabase API keys | New format only: sb_publishable_ (client), sb_secret_ (server). No legacy anon/service_role anywhere. | Mar 2026 |
| Edge Function key limitation | Edge Functions only support JWT via legacy keys. Workaround to be documented when Edge Functions are built. | Mar 2026 |
| GitHub | Org: github.com/Shiroi-Energy-LLP. Repo: shiroi-erp. Private. Personal account used. | Mar 2026 |
| Vercel | Deferred until first screen ready. | Mar 2026 |
| Git branching | Deferred until first screen ready. Will use: main / staging / feature branches. | Mar 2026 |
| Dev machine | Windows, Surface Pro. Git Bash inside Windows Terminal. | Mar 2026 |
| Node version | Node 24 (installed directly, not via nvm). | Mar 2026 |
| Error logging | Named operations, verbose try/catch, Sentry (live, @sentry/nextjs v10), system_logs table for critical functions. | Apr 2026 |
| HubSpot | ✅ Cutover COMPLETE. 1,115 leads, 314 proposals, 314 projects, 30 payments migrated. HubSpot no longer needed. | Apr 2026 |
| UI/UX tooling | No Figma. Claude generates specs + components directly. v0.dev for complex visuals. | Mar 2026 |
| Design system | Shiroi Brand Guide V6 as foundation. packages/ui holds tokens, shadcn/ui overrides, Tailwind config. | Mar 2026 |
| WhatsApp Phase 1 | Employee-forward. n8n generates → employee forwards to customer. Zero BSP cost. | Mar 2026 |
| WhatsApp Phase 2 | WATI.io BSP. Existing Shiroi company number. Starts after registration approved. | Mar 2026 |
| WhatsApp toggle | drip_sequence_steps.delivery_method_active column: flip per step from employee_forward to direct_api. No migration needed for Phase 2 cutover. | Mar 2026 |
| Google Drive import | Gemini Advanced extracts ~1,800 proposal folders. Claude writes import scripts. | Mar 2026 |
| Data import sequence | 100 projects with actuals first (seeds correction factors with real data). | Mar 2026 |
| Completion % | Calculated from objective sub-components — not supervisor's estimate. | Mar 2026 |
| Correction model | Three tiers: free edit / correction record / immutable. Applied to daily reports AND O&M visit reports. | Mar 2026 |
| Table total | 134 tables in database (verified March 29, 2026). | Mar 2026 |
| Vendor payments | Separate `vendor_payments` table for individual payment records. MSME 45-day compliance requires proof of payment date, not just PO totals. | Mar 2026 |
| Sum validation | DB triggers enforce proposal payment schedule percentages sum to 100%. DB triggers enforce project milestone weights sum to 100% per segment+system_type. | Mar 2026 |
| Intermediaries table | Deferred to Phase 2. Billing-through-architect arrangement not needed in Phase 1. | Mar 2026 |
| Sales engineer lead visibility | All sales engineers see all leads (team pipeline visibility). Not restricted to own assigned leads. Can be tightened in future migration if needed. | Mar 2026 |
| Universal tasks table | project_tasks renamed to tasks. Added entity_type + entity_id pattern. Enables unified "my tasks" view across projects, leads, O&M, procurement, HR domains. | Mar 2026 |
| Phone deduplication | Partial unique index on leads.phone — blocks duplicate active leads. Disqualified and lost leads excluded from uniqueness check. | Mar 2026 |
| QC checklist storage | JSONB accepted for Phase 1. qc_gate_inspections.checklist_items stores array of {item, passed, notes}. Separate qc_checklist_items table deferred to Phase 2 when QC analytics are built. | Mar 2026 |
| O&M visit corrections | om_visit_corrections table added. Tier 2 correction model (correction-by-new-record) now applies to O&M visit reports after 48h lock, same as daily site reports. | Mar 2026 |
| Multi-agent tooling | Decided against. No CrewAI, AutoGen, LangGraph. | Mar 2026 |
| Supabase client architecture | Four files in packages/supabase/src/: client.ts (browser singleton), server.ts (async, Next.js cookies), admin.ts (secret key, no session), middleware.ts (session refresh). All typed against Database. | Mar 2026 |
| RLS recursion fix | get_my_role() and get_my_employee_id() SECURITY DEFINER functions replace all 200+ recursive subqueries in RLS policies. Migration 008a. NEVER use raw profile/employee subqueries in policies again. | Mar 30, 2026 |
| handle_new_user trigger fix | Defaults to 'customer' role when metadata missing (previously crashed on NULL cast). | Mar 30, 2026 |
| Designer role | New `designer` app_role. Receives qualified leads, creates system designs + AutoCAD uploads, generates/approves automated proposals. Sees financial data for quote approval. | Mar 30, 2026 |
| Purchase Officer role | New `purchase_officer` app_role. Manages full PO lifecycle from BOM to delivery. Maintains master price book (key input for quote automation). | Mar 30, 2026 |
| Founder role switcher | Founder can view any role's dashboard via `?view_as=` URL parameter. Layout changes, RLS permissions unchanged. | Mar 30, 2026 |
| Role-adaptive dashboard | Single `/dashboard` route renders different content per role. 8 distinct dashboard views for 10 roles. | Mar 30, 2026 |
| SQL changes → migrations rule | Every SQL change made in Supabase SQL Editor must be documented in a migration file immediately. No exceptions. | Mar 30, 2026 |
| Green brand identity | Confirmed: #00B050 primary, #001F0D sidebar, #F6FAF6 light bg. Not blue. Matches Shiroi_ERP_Design_System.md. | Mar 30, 2026 |
| Phase 1A complete | 113 tests, 0 type errors, 23 pages, 21 components, 29 lib files. Steps 7-18. | Mar 30, 2026 |
| Handoff chain confirmed | Sales → Designer → Sales (closure) → PM (BOM) → Purchase (PO, delivery) → PM (execution) → Supervisor → O&M | Mar 30, 2026 |
| Universal tasks on dashboard | Every role sees "My Tasks" widget on their dashboard landing page. Tasks from universal `tasks` table. | Mar 30, 2026 |
| @supabase/ssr cookie pattern | Uses getAll/setAll only (not deprecated get/set/remove). Server component setAll wrapped in try/catch for streaming response edge case. | Mar 2026 |
| Admin client design | Not singleton — new instance per call. No autoRefreshToken, no persistSession. Keeps admin operations explicit and short-lived. | Mar 2026 |
| Types package exports fix | Added explicit "./database" export to packages/types/package.json (database.ts lives at root, not in src/). Added database.ts to tsconfig include. | Mar 2026 |
| Phase 2B complete | 53 routes, 0 type errors, 0 placeholders. All sidebar links are real data-driven pages. Google Drive migration complete (108 vendors, ~160 projects, 850 POs, 1,164 expenses, 916 files). | Apr 3, 2026 |
| Daily file sync: Option C | n8n cron (catches Google Drive stragglers) + in-ERP upload UI (new primary path). Drive usage fades naturally. | Apr 3, 2026 |
| HubSpot cutover: DONE (V2) | ✅ Final: 1,115 leads, 314 proposals, 314 projects, 30 payments. 0 unmatched payments. FY distribution: 2024-25: 50, 2025-26: 264. V2 fixes: matched all payments, created 6 new projects, fixed PV parser for dash format (329 more), fixed RCC/Adroit/Srestha false matches. Dedup audit: 209 records, 18 flagged. Scripts: `migrate-hubspot.ts` + `fix-hubspot-v2.ts`. | Apr 3, 2026 |
| HubSpot stage mapping | To check→new, Appointment Scheduled→site_survey_scheduled, Site Visit Completed→site_survey_done, Proposal Sent→proposal_sent, Design Confirmation→design_confirmed (new enum, migration 011), Negotiation/Final Negotiation→negotiation, Closed Won→won, Closed Lost→lost. Payment stages: Advance (is_advance=true), Supply/Installation/Commissioning/Retention (is_advance=false, stage in notes). | Apr 3, 2026 |
| Rakshas Enterprises | Confirmed project in 2025-26 folder. Google Drive: https://drive.google.com/drive/folders/1r22qXIGtS3Zhx4VkaUcISlEjCAHbb30q. Created as SHIROI/PROJ/2026-27/0147, 20 kWp, commissioned. | Apr 3, 2026 |
| Proposals migration source | 1,300 proposals from multiple Google Drive folders (shared via same service account API key). Dedup by project name + system size + phone number. | Apr 3, 2026 |
| Two-stage quoting | Budgetary quote (instant from price book, no design needed) → detailed final quote (after AutoCAD/SketchUp design + complete BOM). Both auto-generated. | Apr 3, 2026 |
| Branded proposal PDF | Shiroi letterhead, T&C, system specs, payment schedule, warranty. Auto-generated from proposal data. Phase 2C. | Apr 3, 2026 |
| Completion % in Phase 2C | Objective model from sub-components (structure %, electrical %, panels installed/total, inverter, net meter). Not supervisor estimate. Moved to current phase. | Apr 3, 2026 |
| Prod DB approach | Clean schema — run all migrations 001–010 on prod SQL Editor. No pg_dump clone. Migrate only verified data. | Apr 3, 2026 |
| Domain | erp.shiroienergy.com on GoDaddy. CNAME to Vercel at deployment. | Apr 3, 2026 |
| Full Drive scan now | Moved from Phase 4 to Phase 2C. Scan entire Shiroi Energy drive, upload all remaining files to Supabase Storage. | Apr 3, 2026 |
| Phase 2C roadmap | 19 steps (40–58). Full roadmap spec: docs/superpowers/specs/2026-04-03-phase2c-roadmap-design.md | Apr 3, 2026 |
| Leads pagination + bulk actions | Server-side pagination (50/page via Supabase `.range()` + `count: 'exact'`). Bulk assign, status change, soft-delete, merge (side-by-side modal). New filters: segment, assigned_to. Checkbox selection with `data-[state=selected]` row styling. Spec: `docs/superpowers/specs/2026-04-04-pm-leads-proposals-design.md`. | Apr 4, 2026 |
| Proposals pagination | Same pagination pattern as leads. New filters: budgetary/detailed (is_budgetary), system_type. Added type badge column. | Apr 4, 2026 |
| Projects pagination | Same pagination pattern. Preserves status/search filters. | Apr 4, 2026 |
| PM Dashboard v2 | Fixed 3/4 KPIs to match PM spec (Total System Size, Total Clients, Total Sales, Avg Profit %). Added: recharts donut chart (project status), operations widget (progress bars: tasks/services/AMCs), dark #001F0D today panel (priority projects). | Apr 4, 2026 |
| Design system: Checkbox + Pagination | Two new UI components in packages/ui. Checkbox: @radix-ui/react-checkbox, Shiroi green active state. Pagination: server-side URL-based, 5-page window, "Showing X–Y of Z" counter. | Apr 4, 2026 |
| UI/UX Overhaul R1 | 15 improvements: sidebar collapse (localStorage), mobile Sheet nav, Radix Dialog/Sheet/Tabs/Tooltip/DropdownMenu, Logo SVG, Eyebrow pattern, EmptyState, Skeleton loading (7 pages), Breadcrumbs (4 pages), Form infra (react-hook-form+Zod), skip-to-content, responsive fonts, visited links, toast on 3 forms, drag-drop feedback, prefers-reduced-motion. 60+ files. | Apr 4, 2026 |
| UI/UX Overhaul R2 | Post-audit cleanup: all hardcoded hex→tokens (45+ files), 15 new loading skeletons, EmptyState on 15 more pages, Eyebrow on 25 more pages, Breadcrumbs on 4 more pages, toast on 5 more forms, status-* semantic tokens for badges, sidebar/dashboard token cleanup. 105 files, 0 TS errors. | Apr 5, 2026 |
| Design system v2.2 | packages/ui now has 22 components (was 11). New: Dialog (Radix rewrite), Sheet, Tabs, Tooltip, DropdownMenu, Logo, Eyebrow, EmptyState, Skeleton, Breadcrumb, SkipToContent, Form. Zero hardcoded hex in any component. | Apr 5, 2026 |
| Form migration strategy | react-hook-form + Zod infra shipped in packages/ui (Form components). Existing forms migrated incrementally during feature work, not bulk-converted. | Apr 5, 2026 |

---

## 17. External Registrations In Progress

| Item | Where | Blocks | Status |
|------|-------|--------|--------|
| NREL PVWatts API key | developer.nrel.gov | Phase 1 simulation | **Register now — 15 minutes, free** |
| Sungrow iSolarCloud API | isolarcloud.com/developer | Phase 2 monitoring | Registration started, 4–8 weeks |
| Growatt API | server-api.growatt.com | Phase 2 monitoring | Registration started, 4–8 weeks |
| WATI.io WhatsApp BSP | wati.io | Phase 2 direct sending | Registration started, 2–4 weeks |
| Facebook Business Manager | business.facebook.com | Required for WATI.io | Part of WATI registration |

---

## 18. Edge Cases & Known Complexities

### Financial
- **Expired proposal accepted:** <7 days → honour old price. >7 days → auto-requote, notify customer.
- **Change order after acceptance:** New OTP acceptance required. Revenue and margin updated. Tracked in `project_change_orders`.
- **MSME vendor credit exceeded:** 45-day legal maximum. Alert Day 40. `vendor_payments` table proves compliance date-by-date.
- **Retention outstanding at project close:** Tracked separately. Retention invoice released only after retention period ends.
- **Payment schedule doesn't sum to 100%:** DB trigger blocks proposal from being sent until percentages sum exactly to 100%.

### Project execution
- **Builder civil scope:** Shiroi cannot start until builder confirms civil is done (photo evidence). Mandatory gate.
- **Elevated structure by builder:** Shiroi engineer must inspect before panels go on. Safety hold.
- **CEIG rejection:** New inspection cycle. Timeline resets. Delay responsibility = client.
- **Weather delay >3 consecutive days:** `delay_responsibility = weather`. Customer notified automatically.
- **Supervisor on leave during active project:** Backup assigned in `leave_requests.backup_assigned_to`. n8n reroutes notifications.

### Data integrity
- **Offline conflict:** Supervisor edits report offline, PM edits online → last-write-wins, both versions in `site_report_revisions`.
- **Wrong panel count after 48h:** Tier 2 — correction request required via `site_report_corrections`.
- **Wrong O&M reading after 48h:** Tier 2 — correction via `om_visit_corrections`.
- **Leave balance dispute:** `leave_ledger` has every transaction ever. Dispute resolved by the ledger.
- **Duplicate lead from same phone:** Partial unique index blocks active duplicate. System also checks `blacklisted_phones`.
- **Price book staleness:** Actual purchase price diverges >5% on 3+ purchases → `update_recommended` flag via DB trigger.

### Solar technical
- **IR test below minimum:** 0.5 MΩ → DB trigger auto-creates critical service ticket (4h SLA). Cannot be ignored.
- **Panel degradation in simulation:** Degradation-adjusted baseline used for all generation comparisons.
- **Inverter recurring fault codes:** Pattern across 3+ visits → flag for warranty claim review.
- **Battery SOH below guaranteed minimum:** Capacity warranty claim triggered automatically.
- **New shading source:** Quarterly check-in flags unexplained generation drop → technician assessment task created.

### Operational
- **Employee resignation during active project:** Exit checklist gates F&F. Project handover mandatory before last day.
- **DISCOM officer transferred:** `regulatory_ecosystem_contacts.career_status` updated. Task created to find new contact.
- **Warranty card lost:** Digital copy with full document chain in `warranty_claims`. Physical card is not the primary record.
- **Customer in active dispute:** All marketing automation paused. Only transactional messages permitted.
- **Commission structure change mid-year:** Old structure applies to pipeline deals. New structure for new deals only.
- **QC milestone weights don't sum to 100%:** DB trigger raises exception — cannot save incomplete weight configuration.

---

## 19. Reference Documents

All detailed domain design documents:

| File | Contents |
|------|----------|
| `supabase/migrations/001_foundation.sql` | profiles, app_role enum, employees |
| `supabase/migrations/002a_leads_core.sql` | vendors, leads, activities, surveys, assignments, competitors |
| `supabase/migrations/002b_leads_extended.sql` | VIP contacts, channel partners, referrals, blacklist, regulatory contacts |
| `supabase/migrations/003a_proposals_core.sql` | proposals, BOM lines, simulations, revisions |
| `supabase/migrations/003b_proposals_pricing.sql` | price book, scope split, correction factors, scenarios |
| `supabase/migrations/003c_proposals_acceptance.sql` | digital acceptance, OTP log, payment schedule, analytics |
| `supabase/migrations/004a_projects_core.sql` | projects, milestones, tasks, completion, change orders, delay log |
| `supabase/migrations/004b_projects_procurement.sql` | QC gates, POs, DCs, GRN, three-way match, bill clearing |
| `supabase/migrations/004c_projects_site_reports.sql` | daily reports, site photos, photo gates, commissioning |
| `supabase/migrations/004d_projects_financials.sql` | invoices, payments, cash positions, net metering, handover, P&L |
| `supabase/migrations/005a_hr_master.sql` | compensation, skills, certifications, lifecycle, system logs |
| `supabase/migrations/005b_leave_payroll.sql` | leave ledger, attendance, payroll export, insurance |
| `supabase/migrations/005c_training.sql` | microlearning, spaced repetition, onboarding tracks |
| `supabase/migrations/005d_om.sql` | O&M contracts, visits, plants, monitoring, service tickets |
| `supabase/migrations/006a_inventory.sql` | stock pieces, warranties, RFQ, work orders |
| `supabase/migrations/006b_marketing_documents.sql` | drip sequences, campaigns, generated_documents registry |
| `supabase/migrations/006c_audit_triggers.sql` | record_audit_log, document numbering, all system triggers |
| `supabase/migrations/007a_vendor_payments.sql` | vendor_payments table, MSME compliance, PO amount_paid sync |
| `supabase/migrations/007b_sum_validation.sql` | sum-to-100% triggers for payment schedule + milestone weights |
| `supabase/migrations/007c_whatsapp_tracking.sql` | delivery_method_active column, message_delivery_log table |
| `supabase/migrations/007d_leads_fixes.sql` | phone uniqueness index, leads_read RLS fix |
| `supabase/migrations/007e_trigger_fixes.sql` | CEIG trigger fix, cash position fix, om_visit_corrections |
| `supabase/migrations/007f_universal_tasks.sql` | tasks rename, entity_type+entity_id model |
| `supabase/migrations/008a_fix_rls_recursion.sql` | get_my_role(), get_my_employee_id(), fix 200+ recursive policies |
| `supabase/migrations/009_new_roles.sql` | designer + purchase_officer app_role values + 25 RLS policy updates |
| `supabase/migrations/010_project_site_expenses.sql` | lead_status 'converted', project_site_expenses, project-files bucket |
| `supabase/migrations/011_design_confirmed_status.sql` | lead_status 'design_confirmed' enum value (HubSpot stage mapping) |
| `supabase/migrations/012_lead_status_history_allow_system.sql` | lead_status_history.changed_by nullable for migration/admin ops |
| `docs/superpowers/specs/2026-03-30-role-dashboards-design.md` | Phase 2A design spec — all 8 role dashboards |
| `docs/superpowers/plans/2026-03-30-phase1-complete-build.md` | Phase 1A build plan (Steps 7-18) |
| `docs/projects dashboard.md` | PM's 10-step project lifecycle intent |

---

---

## 20. Role-Specific Dashboards & Workspaces

> Full design spec: `docs/superpowers/specs/2026-03-30-role-dashboards-design.md`

### 20.1 Architecture

Single `/dashboard` route — renders role-specific content based on `get_my_role()`. Founder gets a role switcher dropdown to view any dashboard via `?view_as=` parameter.

Every dashboard shows a **"My Tasks" widget** as the first section after KPI cards — tasks from the universal `tasks` table filtered by `assigned_to = get_my_employee_id()`.

### 20.2 Sidebar Workspaces Per Role

Each role gets a curated sidebar with grouped nav sections (not just a dashboard). Founder sees ALL sections.

**Founder:** Overview | Sales | Design | Projects | Procurement | O&M | Finance | HR
**PM + O&M Tech:** Overview | Projects | Execution | Procurement | O&M | Liaison
**Site Supervisor:** Overview | My Work | Projects (read-only for old client lookups)
**Sales Engineer:** Overview | Sales | Marketing | Liaison
**Designer:** Overview | Design | Reference (leads read-only, price book, correction factors)
**Purchase Officer:** Overview | Procurement | Vendor Management (owns master price book)
**Finance:** Overview | Cash | Billing | Vendor | Analysis
**HR Manager:** Overview | People | Leave & Attendance | Payroll | Development

### 20.3 Dashboard Summaries

**Founder:** Cash-negative projects, pipeline value, pending approvals, overdue reports, payroll countdown. Add: donut chart, revenue trend, team utilization. Role switcher.

**PM + O&M:** KPIs (active projects, system size, open tasks, open tickets). Donut chart by status. Operations widget. Today's priorities. 10-step stepper project detail (Project Details → Site Survey → BOM → BOQ Analysis → Delivery Notes → Execution → Quality Check → Liaison → Commissioning → Free AMC).

**Site Supervisor:** Active project card, today's report status, my tasks (overdue first), recent reports with lock status. Can access all projects (read-only) for old client lookups. 90-second report form with pre-populated fields.

**Sales + Marketing:** KPIs (new leads, pipeline value, won this month, conversion rate). Lead funnel chart. My follow-ups today. Marketing campaigns, channel partners, drip sequences. Liaison net metering status.

**Designer:** KPIs (pending designs, in progress, completed this month, avg design time). Design queue table. Design workspace per lead: left panel (lead context + survey + photos) + right panel (system config, AutoCAD upload, simulation trigger, auto-quote generation, review + approve). Files stored in `designs/{leadId}/`.

**Purchase Officer:** KPIs (pending POs, active POs, pending deliveries, MSME alerts). MSME alert banner. Workflow: get vendor quotes → compare → place PO → track delivery → DC → GRN → three-way match → hand back to PM. **Owns the master price book** — editable, bulk update from vendor CSV, staleness flags, history, vendor comparison.

**Finance:** KPIs (invested capital, receivables, MSME due this week, overdue invoices). 6-month cashflow chart. Escalation summary. Invoice/payment management, profitability analytics.

**HR Manager:** KPIs (active employees, pending leave, certs expiring, days to payroll). Department breakdown. Alerts (cert expiry, insurance pending, exit checklists). Leave approval, training delivery, onboarding.

### 20.4 DB Migration Required (Step 19)

```sql
ALTER TYPE app_role ADD VALUE 'designer';
ALTER TYPE app_role ADD VALUE 'purchase_officer';
```

Plus new RLS policies for both roles and updates to existing policies where these roles need access.

### 20.5 Build Order (Steps 19-29)

| Step | What | Depends On |
|------|------|------------|
| 19 | DB migration: new roles + RLS | — |
| 20 | Role-adaptive dashboard router + founder role switcher | 19 |
| 21 | PM Dashboard + 10-step project detail stepper | 20 |
| 22 | Designer dashboard + design queue + workspace + auto-quote | 20 |
| 23 | Purchase officer dashboard + workflow + price book | 20 |
| 24 | Site supervisor dashboard + enhanced report form | 20 |
| 25 | Sales dashboard + marketing + liaison tabs | 20 |
| 26 | Finance dashboard + invoice/payment management | 20 |
| 27 | HR dashboard + training + certifications | 20 |
| 28 | Founder dashboard enhancements (charts, role switcher) | 20 |
| 29 | Cross-role testing + nav verification | 21-28 |

---

**Document version:** 3.6
**Table count:** 134 tables verified in shiroi-erp-dev
**Trigger count:** 91 triggers
**RLS status:** Enabled on all 134 tables — recursive subqueries replaced with helper functions (migration 008a)
**Migration files:** 34 files (001 through 034) — all committed to git
**TypeScript types:** Generated in packages/types/database.ts
**Supabase client:** 4 files in packages/supabase/src/ — browser, server, admin, middleware
**ERP app:** 58+ routes, 0 type errors
**Last updated:** April 9, 2026 (v3.6 — Project detail page overhaul per Manivel's spec: editable boxes, horizontal stepper, Vouchers queue, Actuals step, BOI estimated site expenses. Migrations 033+034.)

**What changed in v3.4:**
- HubSpot migration V2 complete: final counts — 1,115 leads, 314 proposals, 314 projects, 30 payments
- Project FY distribution: 2024-25: 50, 2025-26: 264
- 0 unmatched payments (V2 fixed all 24 previously unmatched from V1)
- V2 created 6 new projects, fixed PV parser for dash format (329 more), fixed false-positive dedup (RCC/Adroit/Srestha)
- Dedup audit: 209 records, 18 flagged for review
- Migration 011 applied (dev): `design_confirmed` added to lead_status enum
- Migration 012 applied (dev): lead_status_history.changed_by nullable for system/migration ops
- Lead status flow documented in Section 6.1: new → contacted → site_survey_scheduled → site_survey_done → proposal_sent → design_confirmed → negotiation → won/lost/on_hold/disqualified
- HubSpot stage mapping table added to Section 11 (To check→new, Appointment Scheduled→site_survey_scheduled, Design Confirmation→design_confirmed, etc.)
- Payment stage mapping documented: Advance (is_advance=true), Supply/Installation/Commissioning/Retention (is_advance=false)
- Migration file count updated: 28 files (001 through 012)

**What changed in v3.5 (April 4, 2026):**
- Contacts V2: HubSpot-style person/company separation (inspired by HubSpot CRM data model)
  - Person (contacts) and Organization (companies) are separate entities
  - `first_name`/`last_name` split with auto-generated `name` display field via DB trigger
  - `lifecycle_stage` on contacts: subscriber → lead → opportunity → customer → evangelist
  - Company optional for residential customers (no forced company creation)
  - `contact_company_roles` junction: contacts linked to companies with role titles, active/ended status
  - `entity_contacts` polymorphic junction: contacts linked to leads/proposals/projects with role labels
  - Activity timeline: `activities` + `activity_associations` tables — 8 engagement types (note, call, email, meeting, site_visit, whatsapp, task, status_change) linked to any entity
  - Edit pages: `/contacts/[id]/edit`, `/companies/[id]/edit`
  - Source tracking, secondary phone, owner_id on contacts; PAN, industry, company_size on companies
- Migration 017 applied (dev): Contacts V2 schema changes — nuke bad backfill, add new columns, create activities system
- Migration 018 applied (dev): `table_views` table for HubSpot-style saved views
- HubSpot-style DataTable: reusable `<DataTable>` component for all entity list pages
  - Column picker: slide-out panel with searchable checkbox list + drag-to-reorder
  - Saved views: `table_views` table persists columns/filters/sort per user, tab bar UI
  - URL-driven sort/pagination via searchParams, server-side data fetching
  - Column definitions: LEAD_COLUMNS (16), PROPOSAL_COLUMNS (12), PROJECT_COLUMNS (11), CONTACT_COLUMNS (8), COMPANY_COLUMNS (7)
  - Checkbox selection with bulk action support
- Leads page rebuilt with DataTable (column picker, saved views, 16 configurable columns)
- Proposals page rebuilt with DataTable (column picker, saved views, 12 configurable columns)
- Projects page rebuilt with DataTable (column picker, saved views, 11 configurable columns)
- Contacts page rebuilt with DataTable (column picker, saved views, 8 configurable columns)
- Companies page rebuilt with DataTable (column picker, saved views, 7 configurable columns)
- Inline editing: double-click-to-edit cells in DataTable. Supports text, number, select, date, phone, email fields. Server action (`inline-edit-actions.ts`) with field-level validation and RLS enforcement.
- Smart contacts backfill: ~1,115 contacts + ~56 companies created from leads
  - Residential → contact only, no company
  - C&I → regex detection for company names (Pvt, Ltd, LLP, Industries, etc.), create company + contact
  - Name splitting: first/last from customer_name, lifecycle_stage from lead status
- Contact dedup completed: 284 duplicate groups merged by phone, 0 remaining duplicates
- Backfill retry completed: 364 leads linked to contacts, 3 junk leads excluded
- Route fix: added missing page.tsx for /om (redirect to /om/visits) and /projects/[id]/reports/[reportId] (redirect to reports list) — fixed parallelRoutes.get TypeError on production
- TypeScript types regenerated with all new tables/columns, all `as any` workarounds removed
- Migration file count: 30 files (001 through 018)

**What changed in v3.5 (UI/UX Overhaul):**
- packages/ui upgraded to v2.2: 22 components (11 new), all built on Radix UI primitives
- New components: Dialog (Radix rewrite), Sheet, Tabs, Tooltip, DropdownMenu, Logo/LogoMark, Eyebrow, EmptyState, Skeleton/TableSkeleton/KpiCardSkeleton, Breadcrumb, SkipToContent, Form (react-hook-form+Zod)
- Sidebar: desktop collapse/expand (localStorage persist) + mobile hamburger (Sheet slide-over)
- Logo SVG deployed to sidebar + login page
- Eyebrow pattern deployed to 31 pages, EmptyState on 38+ pages
- Skeleton loading screens: 22 loading.tsx files across all major routes
- Breadcrumbs on 8 detail pages, toast notifications on 8 forms
- Accessibility: skip-to-content, visited links, prefers-reduced-motion, responsive font scaling
- All hardcoded hex colors replaced with Tailwind tokens across 45+ files
- Status badge colors use semantic status-* tokens
- Column picker drag-drop: state-based tracking with visual feedback
- 0 TypeScript errors across entire monorepo

**What changed in v3.4 (Apr 6, 2026):**
- Marketing redesign: 20-task implementation — stage-based leads pipeline, weighted pipeline KPIs, tab-based lead detail
- Lead detail tabs: Details, Activities, Tasks, Proposal, Files, Payments (conditional on won/converted)
- Task-centric workflow: Quick-add tasks on lead, complete-task button, mandatory follow-up dates on status changes
- Default close probabilities: auto-set on status change (new=5%, qualified=20%, site_visit=40%, proposal_sent=50%, negotiation=75%, won=100%)
- Pipeline queries: getLeadStageCounts(), getLeadsClosingBetween() with weighted values using decimal.js
- Lead archival: is_archived flag, archive/unarchive server actions, "Archived" tab in stage nav
- Status change enforces next_followup_date for non-terminal statuses
- Migration 020: expected_close_date, close_probability, is_archived on leads + performance indexes
- Migration 021: create_payment_followup_tasks() trigger — auto-creates high-priority tasks when project status advances to payment milestone stages
- Payments overview page: /payments rewritten as project payments tracker with layout + tab nav (Project Payments / Receipts)
- Payments summary: Total Contracted, Received, Outstanding, Invested, Net Position, Expected This Week/Month
- Payments table: project value, received, outstanding, payment stage (e.g. "2/4 Paid"), next milestone, P&L, PM
- Old /marketing and /marketing/campaigns pages removed, sidebar updated
- New files: leads-pipeline-queries.ts, leads-task-actions.ts, payments-overview-queries.ts, lead-stage-nav.tsx, pipeline-summary.tsx, lead-tabs.tsx, quick-add-task.tsx, complete-task-button.tsx, lead-files-list.tsx, payments-nav.tsx
- Modified: leads-queries.ts, leads-helpers.ts, leads-actions.ts, status-change.tsx, add-activity-form.tsx, column-config.ts, roles.ts
- Types regenerated with pipeline fields
- 0 TypeScript errors across entire monorepo

**What changed in v3.3:**
- HubSpot cutover V1: 963 leads, 144 proposals, 144 projects from 1,210-deal CSV; 15 payments from 65-record payments CSV
- Three-tier dedup: hubspot_deal_id → customer_name+system_size → customer_name fuzzy (237 deduped)
- PV number parsing from HTML-wrapped Quote IDs (e.g., `<p>PV321/25-26&nbsp;</p>`)
- Won deals create full chain: lead (status:won) → proposal (status:approved) → project
- Payments matched to projects by PV number cross-reference (15 matched, 24 unmatched warnings)
- Migration script: scripts/migrate-hubspot.ts — two-phase (deals + payments), idempotent, dry-run support
- Data integrity verified: 0 orphaned proposals/projects, all FKs valid
- Phase 2C roadmap spec written: 19 steps (40–58), 12 architecture decisions logged

**What changed in v3.6 (Apr 8, 2026):**
- BOM category fix: bom-line-form.tsx dropdown now sends DB-valid snake_case values (panel, inverter, structure, etc.) instead of display labels that violated proposal_bom_lines_item_category_check
- AMC module visibility: Added amcSchedule to founder + om_technician sidebar nav in roles.ts
- AMC page enhanced: /om/amc now shows summary cards (total contracts, active, upcoming visits, overdue) + upcoming AMC visits table with project links, visit #, scheduled date, engineer, status
- Founder dashboard: Added "AMC This Month" card with progress bar and link to /om/amc
- New query: getAmcMonthlySummary() in dashboard-queries.ts
- Proposals page timeout fix: Added idx_proposals_created_at DESC index, changed count:'exact' to count:'estimated', replaced !inner join with regular join + not-null filter (751 proposals after doc extraction exceeded Supabase statement timeout)
- Project file visibility fix: ProjectFiles component now scans both `{projectId}/{category}/` and `projects/{projectId}/{category}/` paths in project-files bucket (909 GDrive-migrated files were invisible due to path prefix mismatch). Added missing categories: purchase-orders, layouts, delivery-challans, invoices (plural), sesal.
- Lead files on project page: New LeadFiles component shows all files from proposal-files bucket (grouped by type: images, PDFs, Word, Excel, presentations, design files, videos). 7,636 files across 933 leads now accessible from project detail page.
- WhatsApp photos on project page: ProjectFiles scans site-photos bucket at `projects/{projectId}/whatsapp/` — 196 WhatsApp photos across 54 projects surfaced.
- Image viewer lightbox: New ImageViewer component (Radix Dialog, no external deps). Click any image in ProjectFiles or LeadFiles → full-screen modal with prev/next arrows, keyboard navigation (arrow keys), download button, image counter.
- Task module overhaul: Migration 027a adds category (10 milestone-aligned values), remarks, assigned_date columns to tasks + task_work_logs table
- Task CRUD: updateTask, deleteTask (soft-delete), addWorkLog, getWorkLogs server actions. EditTaskDialog + DeleteTaskButton components
- Task page enhanced: Category, Done By, Remarks columns; edit/delete buttons; category filter; project links to ?tab=execution
- Daily work logs: task_work_logs table with RLS, expandable per-task timeline, add entry form (date, description, progress %, hours), lazy-loaded on expand
- Performance overhaul (Apr 8, 2026): Fixed 7+ Supabase statement timeouts. Root causes: duplicate getProject() on project detail (8-join query ran 2x), payments page fetched all 751 proposals, 3 aggregations done in JS instead of SQL, 13 pages had no query limits, ProjectFiles ran 22-44 sequential storage API calls, stepper queries ran sequentially.
- Migration 028: 6 new indexes (daily_site_reports report_date, leads pipeline composite, proposals lead+accepted, cash_positions invested, bom_lines proposal+order, projects status+created_at) + 3 RPC functions (get_lead_stage_counts, get_company_cash_summary, get_msme_due_count).
- New getProjectHeader() function: lightweight 12-column query for layout header, replacing the expensive full getProject() with 8 nested joins.
- Payments overview: proposals query now filtered by `.in('lead_id', projectLeadIds)` instead of fetching all 751 accepted proposals.
- Lead stage counts: replaced JS-side Decimal grouping of 1,115 leads with SQL GROUP BY via get_lead_stage_counts RPC.
- Cash summary: replaced JS-side iteration with get_company_cash_summary RPC (SQL SUM/COUNT).
- MSME due count: replaced client-side PO filter with get_msme_due_count RPC (SQL JOIN + COUNT).
- Stepper parallelization: getStepDetailsData, getStepExecutionData, getStepLiaisonData now use Promise.all() instead of sequential queries.
- Profitability page: status filter + sort pushed to DB query (was JS-side filter on all projects).
- ProjectFiles component: 22+ sequential storage .list() calls → all parallel via Promise.all(). WhatsApp photo scanning limited to last 6 months. ~100ms instead of ~4s.
- 13 pages paginated with .limit(100): invoices, payments, procurement, deliveries, vendor-payments, qc-gates, tasks, my-tasks, om/visits, om/tickets, om/amc, hr/leave, hr/training.
- List page timeout fix (Apr 8, 2026): 5 paginated list pages changed from `count: 'exact'` to `count: 'estimated'` — projects, leads, contacts, companies, whatsapp-import. `count: 'exact'` forces PostgreSQL to scan every matching row; `estimated` uses table statistics. Same fix pattern as proposals timeout (commit 4bdb489).
- Migration 029 (027_list_page_indexes.sql): 4 DESC sort-column indexes — idx_projects_created_at, idx_leads_created_at, idx_contacts_created_at, idx_whatsapp_queue_timestamp. These cover the default sort order for each paginated list page.
- Middleware timeout fix (Apr 8, 2026): Two changes to prevent MIDDLEWARE_INVOCATION_TIMEOUT on Vercel production. (1) Excluded `/login` from middleware matcher — no point calling getUser() on the login page. (2) Added 5s Promise.race timeout to `supabase.auth.getUser()` in `packages/supabase/src/middleware.ts` — if Supabase Auth is slow/504, middleware fails fast instead of hanging for 30s. The `(erp)/layout.tsx` `requireAuth()` provides the safety net for page-level auth enforcement.
- Survey step: replaced SELECT * with explicit column list (future-proofed without overfetching).

**What changed in v3.5 (Apr 7, 2026):**
- PM Corrections R2: 16 files changed addressing PM Manivel's field testing feedback
- Tasks page overhauled: Project Name column, Assigned To filter, Project filter, inline completion toggle
- My Tasks page: completion toggle, project link, overdue detection, shows both pending+completed
- QuickTaskForm (execution step): Added "Assigned To" engineer dropdown with employees list
- TaskCompletionToggle: New client component for inline task complete/uncomplete in all task views
- Commissioning: Edit form support — updateCommissioningReport server action, CommissioningForm with existingReport prop
- QC inspection form: Fixed constraint violations (pass→passed, fail→failed), fixed textarea id mismatch
- Liaison: Fixed discom_status 'not_started' → 'pending' per DB CHECK constraint
- Project status history: Fixed column names (from_status/to_status/reason instead of old_status/new_status/notes)
- O&M visits page: Now shows both scheduled visits (from om_visit_schedules) and completed reports
- AMC actions: Revalidates /om/visits and project path on schedule creation
- PDF: Hardened with safeStr() for null/type safety, API route filters empty sections before rendering
- New server actions: toggleTaskCompletion, updateCommissioningReport, getActiveEmployeesForProject
- New component: task-completion-toggle.tsx

**What changed in v3.3 (Apr 4, 2026):**
- Phase 3 items implemented: AI narrative (Step 61), Net metering + CEIG workflow (Step 64), Handover pack (Step 65), Inventory cut-length tracking (Step 67)
- Data integrity check script: scripts/data-integrity-check.ts — FK validation, orphan detection, financial integrity, MSME compliance
- Project file upload: Drag-drop on project detail, 6 categories (General, AutoCAD, Photos, Documents, Warranty, Invoices), Supabase Storage
- AI daily report narrative: Claude API (claude-sonnet-4-20250514), structured prompt from report fields, generate/regenerate button
- Net metering + CEIG: Full CEIG/DISCOM/net-meter status forms, followup tracking, CEIG gate enforcement with user-friendly error
- Handover pack: Auto-generate structured JSON, versioned in generated_documents, warranty summary, handover checklist
- Inventory: /inventory dashboard with summary cards, cut-length gauge bars, low-stock alerts, filter by category/location/condition
- Inventory detail: /inventory/[id] with cut-length tracker (visual gauge, record cuts, auto-scrap below minimum), location management, scrap action
- New nav item: Inventory added to founder, project_manager, purchase_officer sidebars
- New files: inventory-queries.ts, inventory-actions.ts, report-ai-actions.ts, liaison-queries.ts, liaison-actions.ts, handover-actions.ts
- New components: cut-length-tracker.tsx, ai-narrative.tsx, net-metering-detail.tsx, handover-pack.tsx, project-files.tsx
- 57+ routes total (up from 53)

**What changed in v3.2:**
- Phase 2B complete: All 53 ERP screens built with real Supabase queries (0 placeholders remaining)
- Migration 010 applied (dev): lead_status 'converted' enum + project_site_expenses table + project-files storage bucket
- Google Drive data migration complete: 108 vendors, ~160 projects, 850 POs (2,348 items), 1,164 expenses, 916 files
- Migration script: scripts/migrate-google-drive.ts — 5-phase pipeline with caching, timeouts, dedup
- 20 type errors fixed across 12 files (column names corrected against database.ts)
- New query files: vendor-queries.ts, all-tasks-queries.ts, invoice-queries.ts, payment-queries.ts, profitability-queries.ts
- New screens: procurement, deliveries, vendor-payments, msme-compliance, daily-reports, qc-gates, my-tasks, my-reports, hr/employees, hr/leave, hr/training, hr/certifications, om/visits, om/tickets, om/amc, marketing/campaigns, liaison/net-metering, price-book, design queue, marketing overview, liaison overview

**What changed in v3.1:**
- V2 Design System applied: DM Sans headings, warm-gray neutrals (#111318 sidebar, #F8F9FB page bg), all V1 green-tinted colors purged
- Design system docs merged: V1 + V2 → single `docs/Shiroi_ERP_Design_System.md` (V2.0)
- Phase 2A complete: Steps 19-29 built — 8 role dashboards, PM 10-step stepper, sectioned sidebar, role switcher
- Migration 009: designer + purchase_officer roles + 25 RLS policy updates (SQL ready for SQL Editor)
- 142 tests (up from 113), 11 test files, 0 type errors
- 14 placeholder pages for new nav items (replaced by real pages in v3.2)
- Shared KPI card component + My Tasks widget used by all dashboards

**What changed in v3.0:**
- Phase 1A complete: Steps 7-18 built — design system through data migration (113 tests, 0 type errors)
- 2 new app_role values: `designer` (system design + quote approval) and `purchase_officer` (PO lifecycle + price book)
- 10-role handoff chain documented: Sales → Designer → Sales → PM → Purchase → PM → Supervisor → O&M
- Section 1: added 10-role table and handoff chain
- Section 5.6: updated RLS matrix with designer and purchase_officer rows, documented get_my_role()/get_my_employee_id() helper functions
- Section 13: updated all RLS patterns to use helper functions instead of recursive subqueries
- Section 15: Phase 1A marked complete, Phase 2A (Steps 19-29) added as next
- Section 16: 12 new decision log entries (RLS fix, new roles, role switcher, green brand, etc.)
- Section 19: added migration 008a and design spec references
- NEW Section 20: Role-Specific Dashboards & Workspaces — 8 dashboard designs, sidebar workspaces per role, universal tasks widget, founder role switcher, build order

**What changed in v2.6:**
- Step 6 complete: packages/supabase client factory built with 4 typed clients
- Current state updated: Supabase client marked complete, Step 7 (design system) is next

**What changed in v2.5:**
- Current state updated: database complete, TypeScript types generated
- Section 5 completely rewritten: actual 134-table inventory, all triggers, updated RLS matrix

*Update this document whenever a new decision is made. Add to the Decisions Log (Section 16) with date.*
