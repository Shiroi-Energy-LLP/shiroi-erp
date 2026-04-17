# SHIROI ENERGY ERP — MASTER REFERENCE DOCUMENT
**Version 2.6 | Updated March 29, 2026 | Read before every coding session**

> This is the single source of truth for the Shiroi Energy ERP project. Every decision made, every design rule, every business rule, every coding standard, and every constraint is captured here. Anyone joining the project — including Claude in a new chat — reads this first before writing a single line of code or SQL.

---

## CURRENT STATE — READ THIS FIRST (as of March 29, 2026)

**Database and Supabase client are fully built and verified. Next step is Step 7 — Design system setup in packages/ui.**

| Item | Status | Detail |
|------|--------|--------|
| GitHub repo | ✅ Live | github.com/Shiroi-Energy-LLP/shiroi-erp (private) |
| Monorepo | ✅ Scaffolded | Turborepo, pnpm, pushed to main branch |
| Next.js ERP app | ✅ Running | apps/erp, confirmed working on localhost:3000 |
| Supabase dev project | ✅ Created | shiroi-erp-dev, URL: actqtzoxjilqnldnacqz.supabase.co |
| Supabase prod project | ✅ Created | shiroi-erp-prod, URL: kfkydkwycgijvexqiysc.supabase.co |
| .env.local | ✅ Created | In shiroi-erp root, gitignored, never committed |
| Database schema | ✅ Complete | 134 tables, 91 triggers, RLS on all tables — verified |
| TypeScript types | ✅ Generated | packages/types/database.ts — generated from live schema |
| migrations folder | ✅ In repo | supabase/migrations/ — 23 files (001 through 007f) |
| Supabase client | ✅ Complete | packages/supabase — browser, server, admin, middleware clients |
| Vercel | ⏳ Not yet | Set up when first screen is ready to deploy |
| Git branching | ⏳ Not yet | Set up when first screen is ready to deploy |

**Coding workflow (locked):**
Claude writes code/SQL here in chat → Vivek saves files to codebase → git commit and push → done.
SQL migrations are written here and pasted into Supabase SQL Editor on the dashboard. No CLI needed.

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
│   └── migrations/                ← ✅ 23 SQL files, all committed to git
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
│       └── 007f_universal_tasks.sql
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
| `sales_engineer` | **All leads** (team pipeline visibility), all proposals, price_book | All leads + proposals | Others' salary, project financials |
| `project_manager` | All projects, procurement, assigned financials | Assigned projects, procurement | Salary data |
| `site_supervisor` | Assigned projects, own reports, own tasks | Daily reports, photos, issues | All financials |
| `om_technician` | Assigned contracts, tickets, plant data | Visit reports, ticket updates | Financials, HR |
| `finance` | All invoices, payments, project financials, vendor payments | Payment records, vendor payments | Salary data |
| `customer` | Own plant, documents, tickets | Service ticket creation | Any other customer's data |

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
| HubSpot proposals (deal records) | ~1,800 | High | Historical win rate, pipeline analytics |
| Google Drive proposal documents | ~1,800 folders | Low | Archival reference only |

### Import sequence

```
Before go-live:
  1. HubSpot CSV export → leads + proposals tables
  2. 100 projects (full actuals) → project_profitability + project_cost_variances
     Immediately seeds bom_correction_factors with real data
  3. 500 projects (commissioning data) → plants + customers tables

First month post-launch:
  4. Google Drive proposals → archived PDFs in Supabase Storage
  5. Partial project data (200) → import available columns

Nice to have:
  6. Full proposal content extraction from Google Drive documents
```

### Google Drive extraction with Gemini
Gemini Advanced reads Drive natively → extracts headline data → Google Sheet → export CSV → Claude writes import scripts.

### HubSpot export
HubSpot → Deals → Actions → Export → All properties → CSV → share here → Claude writes exact mapping to `leads` and `proposals` tables.

**Duplicate phone handling during migration:** The partial unique index on `leads.phone` will block imports of duplicate active leads. Migration script must deduplicate HubSpot records by phone before import.

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

---

## 13. Security Model

### Authentication
| User type | Method | Session |
|-----------|--------|---------|
| ERP employees | Email + password | 8 hours |
| Mobile field staff | Phone + OTP | 30 days |
| Customer app | Phone + OTP | 90 days |
| WhatsApp training bot | Phone matched to employees table | No session |

### Three core RLS patterns

**Salary data isolation:**
```sql
CREATE POLICY "salary_restricted" ON employee_compensation FOR SELECT USING (
  employee_id = auth.uid()
  OR (SELECT reporting_to_id FROM employees WHERE id = employee_id) = auth.uid()
  OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('hr_manager', 'founder')
);
```

**Cross-project financial isolation:**
```sql
CREATE POLICY "project_cash_by_assignment" ON project_cash_positions FOR SELECT USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'founder'
  OR EXISTS (
    SELECT 1 FROM project_assignments pa
    JOIN employees e ON e.id = pa.employee_id
    WHERE pa.project_id = project_cash_positions.project_id
    AND e.profile_id = auth.uid() AND pa.unassigned_at IS NULL
  )
);
```

**Customer data isolation:**
```sql
CREATE POLICY "customer_own_plant_only" ON plants FOR SELECT USING (
  customer_profile_id = auth.uid()
  OR (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
);
```

### Encryption
- `aadhar_number` and `bank_account_number`: column-level encryption via pgcrypto (already enabled)
- Never in API responses unless explicitly requested by authorised role
- Never in logs, error messages, or audit records

---

## 14. Observability & Monitoring

### Sentry — install on day one
```bash
npm install @sentry/nextjs
npx expo install @sentry/react-native
```
Every unhandled exception → Sentry → email + WhatsApp alert to Vivek.

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

**ERP build — IN PROGRESS 🔜**
- [ ] **Step 7 — Design system: Shiroi brand tokens in packages/ui, Tailwind config, shadcn/ui** ← NEXT
- [ ] Founder morning dashboard
- [ ] Lead pipeline (full CRM)
- [ ] Proposal engine — BOM, correction factors, scope split, GST
- [ ] Project lifecycle — milestones, QC gates, cash positions
- [ ] Procurement — POs, vendor management, three-way match
- [ ] Project cash positions dashboard
- [ ] Daily site reports — basic mobile (online first)
- [ ] HR master — employees, compensation, leave, Zoho payroll export
- [ ] Data migration — HubSpot + 100 projects with actuals

**Deployment — NOT STARTED**
- [ ] Vercel connected to GitHub repo
- [ ] Git branching: main (prod) / staging / feature branches
- [ ] Domain: erp.shiroienergy.com

### Phase 2 — Field & Customer (Weeks 13–24)
- [ ] Offline-first mobile (WatermelonDB)
- [ ] Photo gates, GPS verification, AI narrative
- [ ] Net metering + CEIG full tracking
- [ ] Handover pack auto-generation
- [ ] Customer app (portal, documents, e-card, service tickets)
- [ ] O&M contracts, scheduling, visit checklists
- [ ] Inventory cut-length tracking + DC signatures
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
| Error logging | Named operations, verbose try/catch, Sentry, system_logs table for critical functions. | Mar 2026 |
| HubSpot | Full cutover once lead module stable. One-time data import on cutover day. | Mar 2026 |
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
| @supabase/ssr cookie pattern | Uses getAll/setAll only (not deprecated get/set/remove). Server component setAll wrapped in try/catch for streaming response edge case. | Mar 2026 |
| Admin client design | Not singleton — new instance per call. No autoRefreshToken, no persistSession. Keeps admin operations explicit and short-lived. | Mar 2026 |
| Types package exports fix | Added explicit "./database" export to packages/types/package.json (database.ts lives at root, not in src/). Added database.ts to tsconfig include. | Mar 2026 |

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

---

**Document version:** 2.6
**Table count:** 134 tables verified in shiroi-erp-dev (March 29, 2026)
**Trigger count:** 91 triggers
**RLS status:** Enabled on all 134 tables — verified
**Migration files:** 23 files (001 through 007f) — all committed to git
**TypeScript types:** Generated in packages/types/database.ts
**Supabase client:** 4 files in packages/supabase/src/ — browser, server, admin, middleware
**Last updated:** March 29, 2026

**What changed in v2.6:**
- Step 6 complete: packages/supabase client factory built with 4 typed clients (browser, server, admin, middleware)
- Current state updated: Supabase client marked complete, Step 7 (design system) is next
- Section 2 monorepo tree updated with packages/supabase/src/ file listing
- Section 4.10 rewritten: now shows actual @repo/supabase import paths instead of raw @supabase/ssr
- Build phases: Step 6 moved to complete section with implementation details
- Decisions log: 4 new entries (client architecture, cookie pattern, admin design, types package fix)

**What changed in v2.5:**
- Current state updated: database complete, TypeScript types generated
- Migration folder structure documented with all 23 files
- Section 5 completely rewritten: actual 134-table inventory, all triggers listed, updated RLS matrix
- System spine updated to include vendor_payments and tasks entity model
- New decisions: vendor_payments, sum validation, WhatsApp toggle column, phone dedup, universal tasks, sales engineer visibility, intermediaries deferral, QC checklist approach, O&M corrections
- Build phases updated: database phase marked complete, Step 6 (Supabase client) marked as next
- Edge cases expanded with new scenarios from patch migrations
- Reference documents updated to point to migration files (the actual source of truth)

*Update this document whenever a new decision is made. Add to the Decisions Log (Section 16) with date.*
