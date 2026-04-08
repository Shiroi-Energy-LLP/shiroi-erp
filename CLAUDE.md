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

## CURRENT STATE (as of April 8, 2026)

| Item | Status | Detail |
|------|--------|--------|
| GitHub repo | ✅ Live | github.com/Shiroi-Energy-LLP/shiroi-erp (private) |
| Monorepo | ✅ Complete | Turborepo + pnpm, all packages wired |
| Next.js ERP app | ✅ Running | apps/erp on localhost:3000 |
| Supabase dev | ✅ Live | actqtzoxjilqnldnacqz.supabase.co |
| Supabase prod | ✅ Live | kfkydkwycgijvexqiysc.supabase.co |
| Database schema | ✅ Complete | 137+ tables, 91+ triggers, RLS on ALL tables |
| TypeScript types | ✅ Generated | packages/types/database.ts — regenerated Apr 6 with pipeline fields (expected_close_date, close_probability, is_archived) |
| Migrations | ✅ Committed | supabase/migrations/ — 32 files (001 through 021) |
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
| Auto-search all pages | ✅ Complete | Debounced SearchInput + instant FilterSelect + FilterBar across 12 pages — no more submit buttons |
| Proposals page fix | ✅ Fixed | Removed non-existent `proposal_type` column from Supabase select (caused PostgREST 400 crash). Derived from `is_budgetary` instead. |
| PM corrections plan | ✅ Planned | 14 tasks across 8 phases: bug fixes, default views, survey overhaul, BOM→BOQ→DC flow, execution milestones + daily logs, QC/liaison/commissioning, AMC/service, PDF exports |
| PM Corrections Phase 0 | ✅ Complete | 5 bug fixes: advance status FK, file delete RLS, BOM gst_type, execution tab error handling, survey values |
| PM Corrections Phase 1 | ✅ Complete | Default views per user (is_default on table_views), auto-apply on 5 entity pages |
| PM Corrections Phase 2 | ✅ Complete | Survey form overhaul: 7-section Manivel format, GPS capture, canvas signatures, ~40 fields |
| PM Corrections Phase 3 | ✅ Complete | BOQ item-level procurement tracker, delivery challan from BOQ, status flow (6 states), seed from BOM |
| PM Corrections Phase 4 | ✅ Complete | Execution milestones: seed defaults (9 milestones), inline status change, date tracking |
| PM Corrections Phase 5 | ✅ Complete | QC summary cards, liaison inline edit forms (DISCOM/CEIG/net meter), commissioning error handling |
| PM Corrections Phase 6 | ✅ Complete | AMC enhancement: error handling, summary cards, overdue detection |
| PM Corrections Phase 7 | ✅ Complete | Project PDF export: API route, react-pdf component, survey/BOQ/QC/commissioning/DC sections |
| PM Corrections Phase 8 | ✅ Complete | Task ↔ Execution interlinking: tasks in execution tab, quick task creation from milestone context |
| Migration 022 | ✅ Applied (dev) | Fix file delete RLS: expands DELETE policies on project-files and site-photos buckets |
| Migration 023 | ✅ Applied (dev) | Survey form overhaul: ~25 new columns (GPS, roof details, electrical, shading, signatures) |
| Migration 024 | ✅ Applied (dev) | BOQ items + delivery challans: project_boq_items, delivery_challans, delivery_challan_items tables |
| Migration 025 | ✅ Applied (dev) | WhatsApp import queue: whatsapp_import_queue table with RLS, 5 indexes, review workflow |
| PM corrections merge | ✅ Merged | Worktree branch `claude/eager-driscoll` merged to main (commit 888250d). Deployed to Vercel. |
| WhatsApp import pipeline | ✅ Complete | Rule-based extraction from 3 group chats. 4,164 records in review queue. Script: `scripts/whatsapp-import/extract-local.ts` |
| WhatsApp data extracted | ✅ Complete | Marketing: 152 records (50 payments, 30 POs, 32 contacts, 40 activities). LLP: 186 records (115 BOQ items, 27 POs, 15 payments, 4 vendor_payments). Shiroi Energy: 3,826 records (403 daily reports, 3,100 activities, 298 contacts, 25 financial). |
| WA Import Queue UI | ✅ Complete | /whatsapp-import — stats grid, paginated review table, approve/reject/reassign actions. Sidebar link added for founder/finance/purchase_officer. |
| Data cleanup | 🔜 Later | ~3 junk leads to review, name normalization, placeholder phones |
| Prod deployment | 🔜 Later | After PM corrections merged + migrations applied + data cleaned on dev |

**Current phase: WhatsApp Import complete → Manivel review + prod deployment next**
Full PM corrections plan: `docs/superpowers/plans/2026-04-07-pm-corrections-final.md`
WhatsApp import plan: `docs/superpowers/plans/2026-04-07-whatsapp-import.md`

### PM Feedback Decisions (April 7, 2026 — from Manivel, witnessed by Vivek)

| Decision | Detail |
|----------|--------|
| Survey format | 7-section solar site survey: Project Details, Mounting & Feasibility, Client Discussion, Equipment Location (4× photo upload), Electrical Connectivity (4× photo upload), Deviations, Sign-off (canvas signatures) |
| Signatures | Canvas-based finger drawing on tablet/browser — used for Survey, DC, Commissioning |
| Partial dispatch | DC supports partial qty dispatch (50 of 100 panels in DC1, rest in DC2) |
| Daily logs as tasks | Each daily activity log entry creates a Task in main tasks table, assignable to different engineers |
| Execution milestones | Fixed 10 categories for all projects (Site Visit → Earth Pit Installation) |
| QC gate | QC must be uploaded AND approved by PM before project moves to Liaison |
| Commissioning lock | 24h after submission → locked. Full detailed format (11 sections). PDF required. |
| Monitoring creds | Visible only to: site engineer (for that project), PM, founder |
| Free AMC | 3 visits/year (every 4 months from commissioning) |
| Paid AMC | Variable: 3, 4, or monthly (cleaning). Revenue tracking (skip invoicing for now). Multiple contracts per project. |
| GST rates | 5%, 18%, 28% only (12% discontinued in India) |
| BOQ lock | After "BOQ Completed" → editable only by PM |
| Default views | Per user only (not role-wide). Auto-loads on page visit. Star indicator. |
| DC transport | Vehicle number, driver name, transport mode fields on delivery challan |
| Commissioning format | Full detailed 11 sections (pages 14-17 of PM doc), not simplified version |

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
*Last updated: April 8, 2026 — WhatsApp Import pipeline complete. Migration 025 applied. 4,164 records extracted from 3 group chats (Marketing, LLP, Shiroi Energy ⚡) into whatsapp_import_queue. Review UI at /whatsapp-import. Rule-based extraction script at scripts/whatsapp-import/extract-local.ts (no LLM needed). Next: Manivel review of WA queue, data cleanup, prod deployment.*