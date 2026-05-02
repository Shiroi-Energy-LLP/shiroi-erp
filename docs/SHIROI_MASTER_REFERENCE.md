# Shiroi Energy ERP — Master Reference

> Stable domain and technical knowledge. Read before starting feature work.
> History of what's been shipped: `docs/CHANGELOG.md`. What's in flight: `docs/CURRENT_STATUS.md`. Per-module detail: `docs/modules/*.md`.
> Last structural update: April 17, 2026 (docs restructure).

---

## Table of Contents

1. [Company & Project Context](#1-company--project-context)
2. [Technology Stack](#2-technology-stack)
3. [Development Environment](#3-development-environment)
4. [Coding Standards](#4-coding-standards)
5. [Database](#5-database)
6. [Business Rules by Domain](#6-business-rules-by-domain)
7. [Undo & Correction Model](#7-undo--correction-model)
8. [Field Friction Standards](#8-field-friction-standards)
9. [Completion Percentage Model](#9-completion-percentage-model)
10. [UI/UX](#10-uiux)
11. [Data Migration](#11-data-migration)
12. [Integration Specs](#12-integration-specs)
13. [Security Model](#13-security-model)
14. [Observability](#14-observability)
15. [Known Complexities & Edge Cases](#15-known-complexities--edge-cases)

---

## 1. Company & Project Context

**Shiroi Energy LLP** — Solar EPC, Chennai, Tamil Nadu. Rooftop solar for residential, commercial, industrial customers. Systems: on-grid, hybrid, off-grid. Also net metering to TNEB/DISCOM and AMC. Scale: 500+ projects completed, ~100 active at any time, ~50 employees. Single-tenant — no `company_id` on any table, ever.

**Founder:** Vivek. Reviews every file before commit. No autonomous pushes to production.

### Three surfaces

| Surface | Users | Device |
|---------|-------|--------|
| ERP web app | Founder, sales, PMs, engineers, finance, HR | Desktop/laptop |
| Mobile field app | Site supervisors, O&M technicians | Smartphone — offline capable |
| Customer app | Customers with installed systems | Smartphone |

### Eleven roles (ten employee + customer)

| Role | Primary function |
|------|-----------------|
| `founder` | Full access, cash oversight, approvals |
| `sales_engineer` | Leads, follow-ups, closure, marketing, liaison |
| `marketing_manager` | Sales + design + liaison + payments (Prem's dedicated role) |
| `designer` | AutoCAD layouts, system design, quote generation/approval |
| `project_manager` | 12-step project lifecycle, BOM, QC, O&M |
| `purchase_officer` | Vendor quotes, POs, delivery tracking, price book |
| `site_supervisor` | Daily reports, photos, milestone checklists |
| `om_technician` | Visit reports, service tickets, plant monitoring |
| `finance` | Cash flow, invoices, payments, MSME compliance |
| `hr_manager` | Employees, leave, payroll, certifications |
| `customer` | Own plant monitoring, service tickets (customer app) |

### End-to-end handoff chain

```
Sales Engineer → Designer → Sales Engineer (closure) → PM (BOM) → Purchase Officer
 → PM (execution) → Site Supervisor (daily) → PM (QC, commissioning) → O&M Technician
```

### Five core problems this ERP solves

1. **Cash invisibility** — nobody knows which projects Shiroi is funding from working capital.
2. **Manual quoting** — proposals take too long; margin erodes without feedback from actuals.
3. **Knowledge in phones** — DISCOM contacts, vendor relationships, customer history walk out with people.
4. **No O&M tracking** — service history, warranty, escalation happen informally.
5. **HR/payroll error-prone** — spreadsheets at 50 employees.

Every design decision below traces back to one of these five.

---

## 2. Technology Stack

CLAUDE.md has the canonical stack table and repo layout. This section carries the **non-obvious operational details**.

### The spare laptop server

One always-on laptop runs both **n8n** (port 5678, all automation) and the **PVLib microservice** (port 5001, simulation fallback). Systemd services, auto-start on boot, Ubuntu Server LTS, static local IP. Chosen over cloud-hosted because at current volume it's ~₹0/month vs. ~₹1,500/month for equivalent cloud compute, and latency to our LAN is 5× better than to AWS Mumbai.

**Simulation flow:** Edge Function calls PVWatts first (8s timeout). On timeout/error → local PVLib microservice. Both code paths always implemented — free-tier PVWatts gets rate-limited on busy days.

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

### Two environments — order is mandatory

```
dev/staging  → actqtzoxjilqnldnacqz.supabase.co, Vercel preview URL
production   → kfkydkwycgijvexqiysc.supabase.co, live system, real users, real money
```

**Never broken:**
- No real customer or financial data in dev.
- Every migration tested in dev before prod.
- Production Supabase never used for development.
- Dev migration breaks → fix before touching prod.

### Migration workflow (locked)

Claude writes SQL in chat → pasted into Supabase SQL Editor (**dev first**) → confirmed working → saved as `.sql` in `supabase/migrations/` → committed. No Supabase CLI needed. Every SQL change lands in a migration file immediately — no one-off SQL.

### Task completion workflow (locked)

CLAUDE.md §WORKFLOW step 3 is the authoritative form; recap here so it travels with the dev-environment context:

1. **CI locally before push.** `pnpm check-types && pnpm lint && bash scripts/ci/check-forbidden-patterns.sh`. Mirrors `.github/workflows/ci.yml` exactly. Fix locally; don't push red and rely on remote CI to catch it.
2. **Docs after CI passes.** `docs/CHANGELOG.md` (one line, always), `docs/CURRENT_STATUS.md` (if in-flight state changed), `docs/modules/<module>.md` (if the module gained a capability / table / significant decision). CLAUDE.md does not grow.
3. **Push to main and push to remote.** `git add` → `git commit` → `git push origin main`. The remote tip is the source of truth for "shipped" — a local commit that hasn't been pushed isn't done.

### Type generation

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

A commit that changes schema but not types is incomplete (NEVER-DO #20).

### Env var name list

CLAUDE.md lists the names. Key operational notes:

- **Supabase key format (locked March 2026):** `sb_publishable_…` replaces legacy `anon`; `sb_secret_…` replaces legacy `service_role`. Never use the legacy names in new code.
- **Edge Function limitation:** Edge Functions currently still take JWTs via legacy keys. Workaround is documented where Edge Functions are used.

---

## 4. Coding Standards

CLAUDE.md has the authoritative NEVER-DO list and the canonical code snippets (error handling, Supabase queries, `decimal.js`, `formatINR`, UUID, IST dates, Supabase client factory, sensitive fields). This section carries **only the rationale and the non-obvious patterns**.

### 4.1 The `const op` error pattern — why so verbose

Every server function starts with `const op = '[functionName]';` and every log line prefixes `${op}`. Reason: when production Sentry shows a stack trace for a throw three levels deep, the `op` prefix makes it obvious which business operation failed without having to chase the stack. Failure logs always include `{ ...context, error, timestamp }` — the `timestamp` is redundant with Sentry but invaluable in `system_logs` exports.

### 4.2 Supabase query pattern — error and null are different failures

Check `error` first (RLS denial, network, bad SQL), then check `!data` separately (row not found is not an error). Merging them — `if (error || !data)` — hides the two root causes behind one branch and makes the bug report useless.

### 4.3 `ActionResult<T>` — why no throws across the RSC boundary

Throws from a server action surface to the client as opaque "An error occurred" messages; the error.message gets stripped in production builds. Return a typed discriminated union instead so the call site can `toast.error(result.error)` with the real message.

```typescript
// apps/erp/src/lib/types/actions.ts
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };
export const ok = <T>(data: T): ActionResult<T> => ({ success: true, data });
export const err = (error: string, code?: string): ActionResult<never> =>
  ({ success: false, error, code });
```

The `const op` try/catch pattern still wraps the body — logs flow to Sentry; the `err()` return is what the client sees.

### 4.4 Query file vs. action file vs. component — strict separation

- `*-queries.ts` — pure reads, typed rows out, no React imports. Testable in isolation.
- `*-actions.ts` — `'use server'`. Mutations return `ActionResult<T>`. No React imports.
- Components / pages consume the above. **Never import `createClient` from `@repo/supabase` in a component or `page.tsx`.**

Violations compound: a single inline Supabase call in a page ships a fresh auth client per request, bypasses the query file's type definitions, and cannot be unit-tested. Every one of the 576 `any` violations in the April 14 audit traced back to an inline Supabase call somewhere in the chain.

### 4.5 Financial aggregation — RPC pattern

`SECURITY INVOKER` keeps RLS applied; `STABLE` lets the planner cache within a statement. Don't mark these `SECURITY DEFINER` — a single mistake leaks salary data across roles.

```sql
CREATE OR REPLACE FUNCTION get_pipeline_summary()
RETURNS TABLE (status TEXT, lead_count BIGINT, total_value NUMERIC, weighted_value NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT status::TEXT, COUNT(*)::BIGINT,
         COALESCE(SUM(proposed_value), 0)::NUMERIC,
         COALESCE(SUM(proposed_value * close_probability / 100.0), 0)::NUMERIC
  FROM leads
  WHERE deleted_at IS NULL AND is_archived = false
  GROUP BY status;
$$;
```

At 10× current scale the JS-reduce pattern pushed ~375k rows/minute through the founder-dashboard heap before migration 048 moved aggregations to RPC.

### 4.6 Offline-first pattern (mobile only)

Mobile writes hit WatermelonDB first and sync to Supabase in the background. On sync failure: exponential backoff, data never lost. Tables carrying `sync_status`: `daily_site_reports`, `site_photos`, `om_visit_reports`, `leave_requests`, `form_interaction_metrics`. Enum: `local_only | syncing | synced | sync_failed`.

### 4.7 Row types — why no `as any`

Import `Database['public']['Tables']['x']['Row' | 'Insert' | 'Update']` explicitly. If the generated type is wrong, **regenerate `database.ts`**. Every `as any` compounds schema-drift risk: the audit found that every one of the 576 violations started with "just one cast".

### 4.8 NEVER-DO rules 11–20 — why they exist

CLAUDE.md carries the authoritative list. Each rule is calibrated to a concrete April 14, 2026 audit finding or subsequent incident:

| # | Rule | Driver |
|---|------|--------|
| 11 | No `as any` in Supabase | 576 violations traced to schema drift |
| 12 | No JS aggregation over money | 9 query files reducing monetary columns on dashboard hot path |
| 13 | No `count: 'exact'` >1k rows | Founder dashboard scan of `projects` was 4s+ |
| 14 | No form component >500 LOC | 3 forms >1,000 LOC impossible to maintain / test |
| 15 | No inline Supabase in pages/components | Root cause of most `any` violations |
| 16 | No time-series in regular tables | Inverter telemetry would have buried the DB |
| 17 | Index in same migration as column | Production slowdown always caught at the worst moment |
| 18 | No >5s work in server actions | Vercel function timeout; UX stall |
| 19 | No throws from server actions | Opaque "An error occurred" in production |
| 20 | Regenerate types with every schema change | Types out of sync = silent runtime failures |

Enforcement: CI runs `pnpm check-types` + `pnpm lint` + `scripts/ci/check-forbidden-patterns.sh`. The forbidden-pattern baseline grandfathers existing violations and blocks new ones; it only ratchets down.

### 4.9 Indexes — add with the column, not later

Postgres indexes are cheap to create and cheap to maintain. Adding a filterable / sortable / JOIN-able column without its index is a future production slowdown. Every migration that introduces such a column adds a `CREATE INDEX` in the same file — no "wait and see."

### 4.10 Time-series — declarative partitioning from day 1

Any table taking >1k writes/day sustained (inverter telemetry, IoT, audit streams) uses `PARTITION BY RANGE (<time_col>)` with monthly partitions automated by `pg_cron`. Frontend **never** queries raw partitions — always hits rollup tables (`_hourly`, `_daily`). Reference implementation: migration 050 (inverter telemetry).

### 4.11 Comments — WHY, not WHAT

Code answers *what* already. Comments earn their keep by answering *why this and not the obvious alternative*. "Recompute only the affected project's cash position, not all 500+ active ones — full portfolio recomputation takes ~25 seconds at scale" teaches the next reader something; "// update cash position" doesn't.

---

## 5. Database

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

### 5.2 System spine — how tables connect

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
rfqs → rfq_items + rfq_invitations (UUID token) → rfq_vendor_quotes → purchase_orders
procurement_audit_log ← every mutation in rfq/PO/vendor-portal actions (append-only)
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

The full table inventory lives in the migration files themselves (`supabase/migrations/*.sql`). There is no canonical "list of tables" outside the SQL — read the migrations when you need the schema.

### 5.3 Triggers — categorized (90+ total)

- **`updated_at`** — `set_updated_at()` on every table with an `updated_at` column.
- **Status history** — `log_{lead,proposal,project}_status_change` each write to `*_status_history` (see FK-to-employees pattern in §15).
- **Sum validation** — `proposal_payment_schedule` = 100% before proposal leaves draft; `project_milestone_weights` = 100% per segment+system_type.
- **Cash position** — recomputes `project_cash_positions` on every payment INSERT / PO amount_paid change / invoice total_amount change. Per-project recompute, not portfolio-wide (see §4.11 comment example).
- **Critical business gates** — CEIG block on `net_metering_applications`, IR-test auto-ticket (<0.5 MΩ) on `commissioning_reports` + `om_visit_reports`, auto-create-project on proposal acceptance, auto-create-payout on customer payment, auto-mark-proposal-accepted on lead `won`, payment follow-up task creation, lead files → project migration on project INSERT.
- **Inverter telemetry** — auto-ticket on daily-rollup anomalies (PR<0.70 / offline>60min / fault>0), 7-day dedup.
- **Auth** — `on_auth_user_created` creates `profiles` row on signup.

### 5.4 Computed summary tables

Summary tables are kept fresh by triggers or nightly n8n cron. Frontend always queries the summary, never recomputes.

| Summary table | Source | Refresh |
|---|---|---|
| `project_cash_positions` | customer_payments, vendor_payments, invoices, POs | Trigger on every payment INSERT |
| `company_cashflow_snapshots` | All project_cash_positions | Nightly cron → `generate_cashflow_snapshot()` RPC |
| `leave_balances` | leave_ledger (SUM per employee per type) | Trigger on every leave_ledger INSERT |
| `monthly_attendance_summary` | leave_requests + corrections | On leave approval; locked on 25th |
| `om_profitability` | om_visit_costs + revenue | After each visit report |
| `bom_correction_factors` | project_cost_variances | On project close |
| `price_book_accuracy` | vendor_payments + price_book | Trigger on purchase_order_items INSERT |

Nightly cron (n8n, not DB): `lock_stale_reports()` (48h lock on daily_site_reports + om_visit_reports), `generate_cashflow_snapshot()`.

### 5.5 RLS role access — summary

Per-role access lives in each module doc's "Role Access Summary" section. Shape: `founder` → everything; `hr_manager` → HR only, no project financials; `sales_engineer` / `marketing_manager` / `designer` → sales+design, no salary, no execution financials; `project_manager` → projects end-to-end, no salary, liaison read-only; `purchase_officer` → procurement + vendors; `site_supervisor` → daily reports on assigned projects, no financials; `om_technician` → post-commissioning only; `finance` → invoices + payments, no salary; `customer` → own plant + tickets only. All policies via `get_my_role()` / `get_my_employee_id()` (migration 008a) — never raw profile subqueries.

### 5.6 Three core RLS patterns

All policies use the helpers from migration 008a. **Never** use raw `SELECT … FROM profiles WHERE id = auth.uid()` subqueries — they infinite-recurse. Always `get_my_role()` / `get_my_employee_id()` (both `STABLE + SECURITY DEFINER`).

**1. Salary isolation** — `employee_compensation`, `salary_increment_history`: readable by the employee, their direct manager, `hr_manager`, `founder`. Enforced at DB level, never at application level.

**2. Cross-project financial isolation** — `project_cash_positions`, `project_site_expenses`, etc.: readable when the current user has an active `project_assignments` row for that project (or is `founder`).

**3. Customer data isolation** — `plants`, `om_service_tickets`: `customer_profile_id = auth.uid()` OR `get_my_role() != 'customer'`.

**Sales engineer lead visibility:** All sales engineers see all leads. Team pipeline visibility beats strict ownership at ~5 sales staff.

See migration 008a for the helper definitions; migrations 028/052/054 for representative policies.

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

Sequences: `proposal_number_seq`, `project_number_seq`, `invoice_number_seq`, `credit_note_number_seq`, `receipt_number_seq`, `po_number_seq`, `proforma_number_seq`, `ticket_number_seq`.

### 5.8 File storage architecture

**The rule without exception:** Every document lives in Supabase Storage. The database stores path strings only.

The `generated_documents` table is the central registry for all 60+ document types. Domain tables store a `current_pdf_storage_path` or FK to `generated_documents`. Versioning, signature tracking, and customer access control all live in `generated_documents`.

**Buckets:**
- `project-files` — project-scoped documents (BOM, layouts, invoices, DCs, etc.), 100 MB file limit, expanded mime types (DWG, DOCX, XLSX, PPTX, video, SketchUp)
- `proposal-files` — lead/proposal-scoped documents (now owned by marketing revamp)
- `site-photos` — project site photos + WhatsApp photos

**Storage RLS note:** Supabase Storage `.move()` is implemented as an UPDATE on `storage.objects`. A missing UPDATE policy surfaces as "Object not found" to the client because the row becomes invisible to the post-update visibility check. Every bucket needs SELECT, INSERT, UPDATE, and DELETE policies.

Storage capacity estimate: ~48 GB at scale. Supabase Pro includes 100 GB.

### 5.9 Tasks table — universal entity model

The `tasks` table uses an `entity_type + entity_id` pattern to support tasks across all domains:

```typescript
entity_type: 'project' | 'lead' | 'om_ticket' | 'procurement' | 'hr'
entity_id: UUID  // FK to the relevant domain record
```

For project tasks, `project_id` FK is also populated for efficient JOIN queries. For all other domains, only `entity_id` is used. This enables a unified "my tasks today" view across all domains in the mobile app home screen.

---

## 6. Business Rules by Domain

Each domain has a module doc at `docs/modules/*.md`. This section carries **cross-cutting rules and the domain knowledge that doesn't fit one module**. For day-to-day feature work, load the module doc. Come here for the "why" behind a rule that touches multiple modules.

### 6.1 Sales — cross-cutting

Full detail: `docs/modules/sales.md`. Key domain rules:

- **Closure bands:** green ≥10% margin → auto-won; amber 8–10% → founder approval via `lead_closure_approvals`; red <8% → blocked. Keeps margin discipline without bottlenecking every deal on the founder.
- **Channel partner commissions:** TDS at 5% at source when annual total > ₹10,000 (Indian income tax rule). Commission **locked at partner assignment** (not at close) so the partner can't be swapped to game the rate. Per-tranche payouts created on each customer payment.
- **Referral rewards:** ₹3,000–5,000/kWp residential; commercial negotiated. Same TDS threshold as consultants.
- **VIP contacts:** founder manages personally; system drafts, human sends. Never auto-message VIPs.
- **Blacklisted phones:** `blacklisted_phones` table — never reassigned, never auto-messaged.
- **Automation pause:** all marketing automation stops when customer has an open unresolved complaint.

### 6.2 Proposals — cross-cutting

Full detail: `docs/modules/sales.md`, `docs/modules/design.md`. Key domain rules:

- **Two-stage quoting:** budgetary Quick Quote (instant from price book, no design) → Detailed Proposal (after AutoCAD/SketchUp + complete BOM). Quick Quote is Shiroi's key competitive advantage — we can respond same-day to leads, while competitors take a week.
- **BOM correction factors** shown transparently — engineer sees raw AND corrected side-by-side; override requires reason logged in `proposal_correction_log`. Override rate >80% on a factor auto-flags it for review (the factor is probably wrong).
- **GST split:** equipment supply = 5% (HSN 8541); works contract (installation) = 18%. Different HSN codes on the same proposal.
- **Margin approval:** <₹5L auto-approved; >₹10L requires founder approval.
- **Proposal validity:** 30 days. Expired <7 days → honour old price. Expired >7 days → auto-requote, customer notified.
- **Scope split per BOM line:** Shiroi / client / builder / excluded. Critical for commercial projects where builder provides civil.
- **Simulation:** PVWatts primary → PVLib microservice fallback. **Both code paths always implemented** — free tier PVWatts gets rate-limited.

### 6.3 Projects — cross-cutting

Full detail: `docs/modules/projects.md`. Key domain rules that touch other modules:

- **Three QC gates are payment gates:** Materials QC → unlocks 40% delivery invoice. Mid-install QC (PM visit) → allows electrical work. Pre-commissioning QC → unlocks 20% commissioning invoice. Quality failure = payment hold, which is what actually drives on-site discipline.
- **MSME 45-day maximum** on vendor payments (statutory). System alerts Day 40. `vendor_payments` table tracks per-payment dates as tribunal-ready proof.
- **Three-way match:** PO quantity vs DC quantity vs GRN quantity. Enforced at the procurement module boundary.
- **Delay responsibility recorded:** `shiroi / client / vendor / discom / weather / ceig`. Drives contractual-delay conversations.
- **Project auto-created on proposal acceptance** via `create_project_from_accepted_proposal` trigger. Won cascade (lead → won → proposal accepted → project) runs through the same trigger so Marketing never touches projects directly.

### 6.4 Cash flow — cross-cutting

Full detail: `docs/modules/finance.md`. Key domain rules:

- `is_invested = true` when `net_cash_position < 0` — Shiroi is funding the project from working capital. Founder dashboard's headline number.
- **Soft block: no PO before advance received.** PM override with confirmation — the override is a decision, not an oversight.
- **Uninvoiced milestone alert** after 48h — project hit the milestone but finance never raised the invoice.
- **Customer invoice overdue escalation:** Day 1 sales → Day 5 manager → Day 10 founder → Day 30 legal flag.
- **Vendor invoice overdue:** daily alert; MSME vendors escalate Day 3 (legal risk is sharper).

### 6.5 Inventory

- Every physical item tracked **individually** in `stock_pieces` (not just totals) — warranty chain requires serial-level traceability.
- Cut-length materials: `current_length_m`; below `minimum_usable_length_m` → auto-flag scrap.
- Warranty chain: serial number → purchase invoice → signed DC → commissioning report. All four must exist for a valid warranty claim.

### 6.6 Net metering & liaison

Full detail in the projects module's Liaison step. Key cross-cutting rules:

- **Two parallel processes:** CEIG (for ≥10 kWp on-grid + hybrid) AND TNEB/DISCOM. Sequenced, not parallel.
- **CEIG gate:** DB trigger blocks `discom_status` from advancing from `pending` until `ceig_status = approved`. Non-negotiable — TNEB regulation requires CEIG approval first for ≥10 kWp. Do not work around this trigger.
- **CEIG scope toggle** (`ceig_scope = shiroi | client`, migration 045): when client manages CEIG for their own ≥10 kWp project, the CEIG form hides in the liaison step.
- **Documents in `liaison_documents` / objections in `liaison_objections`** — both queryable relational tables, never jsonb. Objections are high-stakes and deserve their own rows.
- **Owned by marketing_manager**, read-only for project_manager (PM needs visibility to answer client questions but doesn't drive the workflow).

### 6.7 O&M

Full detail: `docs/modules/om.md`. Key cross-cutting rules:

- **Free AMC:** 3 scheduled visits auto-created on commissioning finalization (first at month 1, then 6, then 12).
- **AMC price ceiling:** 12% of customer's annual solar savings. Above this, customer won't renew.
- **Target O&M gross margin:** 30%. `repricing_recommended` auto-set at renewal if actual margin < minimum threshold.
- **O&M visit corrections** (`om_visit_corrections`) mirror `site_report_corrections` — Tier 2 model applies after the 48h lock.

### 6.8 Plant monitoring & inverter telemetry

Full detail: `docs/modules/om.md`. Key cross-cutting rules:

- **Credentials auto-synced** from `commissioning_reports` via AFTER UPDATE trigger when status moves to submitted/finalized — PM never has to re-enter data the commissioning form already captured.
- **Brand auto-detected from portal URL:** sungrow / growatt / sma / huawei / fronius / solis / other. Drives adapter selection in `packages/inverter-adapters`.
- **Readings partitioned monthly** (migration 050); frontend queries rollups (`_hourly`, `_daily`) — never raw readings. Rule #16.
- **Auto-tickets** from daily rollup scan: `PR<0.70 / offline>60min / fault>0` → TKT-NNN with 7-day dedup window.

### 6.9 Service tickets

- Numbering: `TKT-001`, `TKT-002` (3-digit padStart).
- 6 statuses: `open / assigned / in_progress / resolved / closed / escalated`.
- **Auto-created by IR-test trigger** (< 0.5 MΩ → critical, 4h SLA) — applies on BOTH `commissioning_reports` AND `om_visit_reports`. Non-negotiable safety rule (IR failure means risk of fire or shock).
- Auto-created by inverter anomaly scan (see 6.8).
- `service_amount` field for paid service (Free AMC visits carry 0).

### 6.10 HR & Payroll

- **Zoho Payroll stays for the auditors.** ERP is the master data source; Zoho is the export target.
- Payroll export CSV generated on 25th of every month (see §12.5 for format).
- Employee certifications with `blocks_deployment = true`: expiry auto-blocks site assignment.
- Employee exit: ERP access revoked same day as `last_working_day`.
- `leave_ledger` is **immutable** (Tier 3) — corrections via reversal entries only. Dispute resolution always wins on the ledger.
- `aadhar_number` and `bank_account_number` encrypted at column level (pgcrypto).

### 6.11 Training

- Daily microlearning: 3–5 questions per employee at 9am via WhatsApp (n8n).
- Spaced repetition: wrong → tomorrow; 1 correct → +3 days; 2 → +7 days; 3+ → +30 days (mastered).
- Time-sensitive questions (tariff rates, subsidy amounts): `accuracy_review_date` enforced so stale facts don't keep getting asked after policy changes.
- Onboarding gate: safety modules must complete before first site assignment.

### 6.12 WhatsApp

Integration detail in §12.7 + §12.8. Domain rule: all customer-facing automation pauses when customer has an open unresolved complaint (same rule as 6.1 — restated because it keeps getting missed).

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

## 10. UI/UX

**No Figma.** Claude writes screen specs and working Next.js/Tailwind components directly; v0.dev for visually complex ones. Screens are production code from the start.

Design system: Shiroi Brand Guide V6. `packages/ui` holds tokens, shadcn/ui overrides, Tailwind config. Full detail: `docs/design/design-system.md` + `docs/design/brand-guide.html`.

### Three surfaces, three philosophies

- **ERP web:** dense, data-rich, desktop. Sidebar nav. Tables not cards. HubSpot-style DataTable for list pages (column picker, saved views, inline editing).
- **Mobile field app:** minimal, large touch targets, works with gloves. Bottom tab nav. 90-second form rule (§8).
- **Customer app:** consumer-grade polish. Clean, spacious. No jargon.

### Role-adaptive dashboards

Single `/dashboard` route renders different content per role. Founder gets `?view_as=` to preview any role's dashboard. Every dashboard shows a "My Tasks" widget filtered `assigned_to = get_my_employee_id()`. Sidebar curated per role; founder sees all sections.

---

## 11. Data Migration

All one-time migrations complete (HubSpot, Google Drive, Bill of Items, WhatsApp, Price Book) — see `docs/CHANGELOG.md` for timeline and volumes. HubSpot stage → lead_status mapping is canonical: `scripts/fix-hubspot-v2.ts`. **Upcoming:** Zoho Books import (vendors, POs, invoices, payments) — blocked on CSV exports.

---

## 12. Integration Specs

### 12.1 NREL PVWatts + 12.2 PVLib microservice

Primary: `GET https://developer.nrel.gov/api/pvwatts/v8.json` (v8, 1k calls/hour free tier, 8s timeout). Fallback on failure: PVLib microservice on spare laptop port 5001, POST `/simulate` with `{lat, lon, system_capacity_kw, tilt, azimuth, losses_pct}` → returns monthly + p50/p75/p90.

### 12.3 Claude API

Model `claude-sonnet-4-20250514`, `max_tokens: 500`. Uses: daily report narratives, WhatsApp drafts, quarterly check-in reports. Budget ~500 calls/day; daily spend limit set in Anthropic console. **Never log prompt content containing customer personal data.**

### 12.4 Supabase → n8n webhooks

Shared secret via `X-N8N-Webhook-Secret` header. On failure, log to `system_webhook_failures` — n8n polls and retries on startup.

### 12.5 Zoho Payroll CSV export

Generated on the 25th of every month. 18 columns: employee_id, full_name, uan_number, esic_number, paid_days, lop_days, basic_salary, hra, special_allowance, travel_allowance, other_allowances, variable_pay, one_time_additions, one_time_deductions, pf_employee, esic_employee, professional_tax, remarks. Source: `scripts/payroll-export.ts`.

### 12.6 Inverter monitoring APIs

Adapters per brand in `packages/inverter-adapters/` (sungrow, growatt, sma, huawei, fronius — Sungrow + Growatt are implementable, rest are stubs). Edge Function polls per-inverter (5–120 min, default 15). Storage: monthly RANGE partitions on `(inverter_id, recorded_at)`, rollups via nightly pg_cron, 90-day raw retention / indefinite rollups. Missing data: store NULL (not zero — zero = zero generation, NULL = no data). Auto-tickets from daily rollup scan: `PR<0.70 / offline>60min / fault>0` → TKT-NNNN with 7-day dedup. Env flag `SYNTHETIC_INVERTER_READINGS=1` enables synthetic solar-curve data for testing until Sungrow/Growatt API registrations complete.

### 12.7 + 12.8 WhatsApp

**Phase 1 (current):** n8n → employee's WhatsApp → employee forwards to customer. Tracked in `message_delivery_log`. Phase 2 toggle per step via `drip_sequence_steps.delivery_method_active`. Phase 2: WATI.io BSP (~₹3,000/month, existing company number, registration in progress).

**Historical import:** Rule-based (no LLM) pipeline in `scripts/whatsapp-import/` — `parser.ts` handles Android + iPhone ZIPs + U+202F narrow no-break space + Unicode control chars; `extract-local.ts` pulls payments/contacts/POs/BOQ items/daily reports/activities; `enrich-and-approve.ts` does fuzzy project match + Indian amount parsing + bulk insert. Review queue `whatsapp_import_queue` (migration 025) with SHA-256 dedup on `message_hash` — re-runs are safe. Live Baileys bot deferred — scaffolds in `scripts/whatsapp-import/profiles/`.

---

## 13. Security Model

### Authentication

| User type | Method | Session |
|-----------|--------|---------|
| ERP employees | Email + password | 8 hours |
| Mobile field staff | Phone + OTP | 30 days |
| Customer app | Phone + OTP | 90 days |
| WhatsApp training bot | Phone matched to employees table | No session |

### RLS patterns

Three canonical patterns (salary, cross-project, customer-own) via `get_my_role()` / `get_my_employee_id()` helpers — see §5.6 for details, §15 for FK-to-employees bug pattern.

### Encryption

- `aadhar_number` and `bank_account_number`: column-level encryption via `pgcrypto`
- Never in API responses unless explicitly requested by an authorised role
- Never in logs, error messages, or audit records

---

## 14. Observability

**Sentry** (`@sentry/nextjs` v10, `apps/erp`) — production-only, unhandled exception → Sentry → email alert to Vivek. Config: `sentry.{client,server,edge}.config.ts`, `src/instrumentation.ts` (registers `onRequestError`), `src/app/global-error.tsx` (React boundary), `next.config.js` (`withSentryConfig` + `/monitoring` tunnel).

**`system_logs` table** — critical Edge Function operations logged here after completion. Never log sensitive fields (see CLAUDE.md).

**n8n global error handler** — one workflow "Global Error Handler" triggers on any workflow failure, sends WhatsApp to admin.

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

## 15. Known Complexities & Edge Cases

**CLAUDE.md references this section.** Read before touching any of these areas — each one has bitten us at least once.

### Critical DB-enforced gates (non-negotiable)

- **CEIG clearance gate:** DB trigger blocks TNEB net metering submission until CEIG is approved. Driver: TNEB regulation requires CEIG first for ≥10 kWp. Table: `net_metering_applications`. Do not work around this trigger.
- **IR test auto-ticket:** IR reading < 0.5 MΩ → DB trigger auto-creates critical service ticket (4h SLA). Fires on both `commissioning_reports` AND `om_visit_reports`. Safety rule — an IR failure means risk of fire or shock.
- **Sum-to-100% triggers:** `proposal_payment_schedule` percentages must sum to exactly 100% before a proposal leaves draft. `project_milestone_weights` must sum to 100% per segment+system_type. Both enforced at DB level so no path bypasses them (direct SQL, Supabase Studio, API — all blocked).
- **Phone uniqueness:** Partial unique index on `leads.phone` blocks duplicate *active* leads. `disqualified` and `lost` excluded so a lost customer can re-engage.

### Data model subtleties

- **Tasks entity model:** `tasks(entity_type + entity_id)` — not separate task tables per domain. Values: `project | lead | om_ticket | procurement | hr`. Enables the cross-domain "my tasks today" mobile view.
- **Salary RLS:** `employee_compensation` and `salary_increment_history` readable only by the employee, their direct manager, `hr_manager`, `founder`. Enforced at DB level so a bug in an action file can't leak salary data.
- **Offline sync:** Mobile writes hit WatermelonDB first → background sync to Supabase. `sync_status` enum: `local_only | syncing | synced | sync_failed`. Exponential backoff on sync failure — data never lost.
- **Financial year boundary:** April 1. Document number sequences reset. `generate_doc_number()` handles this automatically — don't roll your own numbering.
- **MSME 45-day rule:** Statutory maximum for MSME supplier payments. `vendor_payments` tracks per-payment dates as tribunal-ready proof. Alert on Day 40.
- **FK-to-employees in status triggers:** `changed_by` on `*_status_history` is FK to `employees.id`, but `auth.uid()` returns `profiles.id`. Always look up `SELECT id FROM employees WHERE profile_id = auth.uid() LIMIT 1` with NULL fallback for system ops. Migrations 031 / 055 / 056 fix three separate instances of this bug.

### Financial edge cases

- **Expired proposal accepted:** <7 days → honour old price. >7 days → auto-requote, notify customer.
- **Change order after acceptance:** New OTP acceptance required. Revenue + margin updated. Tracked in `project_change_orders`.
- **Retention outstanding at project close:** Tracked separately — retention invoice released only after retention period ends.

### Project execution edge cases

- **Builder civil scope:** Shiroi can't start until builder confirms civil done (photo evidence). Mandatory gate — we've been burned by starting on half-done civil and having to redo work.
- **Elevated structure by builder:** Shiroi engineer inspects before panels go on. Safety hold.
- **CEIG rejection:** New inspection cycle. Timeline resets. `delay_responsibility = client`.
- **Weather delay >3 consecutive days:** `delay_responsibility = weather`. Customer auto-notified.
- **Supervisor on leave during active project:** `leave_requests.backup_assigned_to`. n8n reroutes notifications.

### Server-side PDF rendering

`@react-pdf/renderer` v4.3.2 depends on `fontkit` / `pdfkit` / `linebreak`, which `require()` font files dynamically — webpack can't statically bundle them for Vercel serverless. Next.js config must list it as external (`experimental.serverComponentsExternalPackages` on 14.2.x, `serverExternalPackages` top-level on 15). Symptom when missing: every PDF route fails silently with an opaque 500. Full detail: `docs/modules/projects.md` gotcha #1.

### Storage RLS — the "Object not found" trap

Supabase Storage `.move()` is an UPDATE on `storage.objects`. A missing UPDATE policy surfaces as "Object not found" because the post-update visibility check fails. Every bucket needs SELECT, INSERT, UPDATE, **and** DELETE. Historical gaps: `project-files` UPDATE (migration 047), `site-photos` UPDATE (migration 054).

---

*Last structural update: April 17, 2026. Per-module docs in `docs/modules/`. Change history in `docs/CHANGELOG.md`. What's in flight: `docs/CURRENT_STATUS.md`.*
