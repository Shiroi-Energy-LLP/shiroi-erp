# Finance Module V2 — Zoho Books Integration — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, pending implementation plan
**Ships starting at:** next migration after the in-flight Expenses module (so migration 067+, since expenses lands as 066)
**Author:** Vivek (brainstormed with Claude)
**Related specs:** `2026-04-17-expenses-module-design.md` (runs adjacent — Expenses module rename `project_site_expenses → expenses` happens first, this work picks it up downstream)

---

## 1. Problem

Shiroi runs Zoho Books as its full accounting system today. Three years of operational data live there: 248 projects, ~900 customer invoices, ~2,000 vendor bills (Zoho calls them "Bills"), ~1,200 customer payments, ~3,400 vendor payments, ~5,300 expense lines, ~1,500 purchase orders — plus chart of accounts, vendors with MSME/GSTIN/PAN/bank details, items with HSN codes, and general ledger journals. The auditor uses Zoho Books exclusively and trusts it.

The ERP needs to **own the operational experience** (PO → Bill → Vendor Payment, Invoice → Customer Payment, project-tagged Expenses) so employees enter data once in ERP instead of twice (ERP for operations, Zoho for finance). But Zoho must stay authoritative for the auditor for at least 12 months — until the auditor trusts ERP's outputs enough to skip Zoho.

Four problems follow from this:

1. **Project-level P&L is incomplete in ERP.** Today the ERP has `/profitability` but the numbers don't include Zoho-only bill data. Site supervisor enters vouchers in ERP; vendor bills land in Zoho; neither system sees a complete picture.
2. **The `vendor_bills` schema gap.** ERP today has PO → `vendor_payments` with no bill layer in between. Zoho has PO → Bill → Payment. MSME 45-day clock statutorily starts at **bill date**, not delivery; ERP is measuring from delivery, which is non-compliant. Plus the ~2,000 Zoho bill rows represent the actual material cost of every project — without a bill table in ERP, there's nowhere to land them.
3. **Double entry is happening.** Manivel enters POs in ERP; KS Vinodh (accountant) re-keys everything into Zoho Books. This is what the user asked to eliminate.
4. **No historical data in ERP** for projects older than roughly early 2025 when ERP started capturing material — any drill into a 2024 project's costs gives a near-empty screen.

Solution: build **Finance Module V2** — fill the `vendor_bills` gap, import all 3 years of Zoho data into ERP (with fuzzy project matching), add essential Finance UI, and set up one-way ERP → Zoho sync via n8n so new ERP entries flow to Zoho without double entry.

## 2. Scope

### In scope (this spec)

- **Schema additions:**
  - `vendor_bills` + `vendor_bill_items` tables (new)
  - `zoho_sync_queue` — outbound sync queue
  - `zoho_project_mapping` — Zoho project ID ↔ ERP project ID lookup
  - `zoho_account_codes` — Chart of Accounts lookup (seeded from `Chart_of_Accounts.xls`)
  - `zoho_tax_codes` — Tax ID / Tax Name lookup (seeded from `Tax.xls` + backfilled from invoice/bill line-item tax columns for any codes used but not in the export)
  - `zoho_monthly_summary` — company-wide P&L lines (salary, rent, etc.) pulled monthly from Zoho API
  - `reconciliation_discrepancies` — drift between ERP and Zoho
  - New columns on existing tables: `zoho_invoice_id`, `zoho_customer_payment_id`, `zoho_bill_id`, `zoho_vendor_payment_id`, `zoho_po_id`, `zoho_expense_id`, `zoho_contact_id`, `zoho_vendor_id`, `zoho_project_id`
  - `vendor_payments.vendor_bill_id` FK so payments apply to bills not just POs
  - `vendor_bills.bill_date` drives MSME 45-day clock (replaces delivery-date-based calculation)

- **Historical import (one-time):**
  - Parse the 15 relevant Zoho `.xls` exports in `docs/Zoho data/` (masters, parties, projects, AR, AP, expenses, journals). Out-of-scope files listed in §2 below.
  - Project matching engine (fuzzy on customer + size + name) with manual review queue
  - Contact + vendor matching/merging against existing ERP rows
  - Item master import (945 items → `zoho_items` reference table; not merged with BOQ)
  - Ingest everything there is — no date cutoff (data starts May 2023, FY 2023-24)
  - All imported rows carry `source = 'zoho_import'` and `zoho_*_id` for traceability
  - Reconciliation report: per-project totals ERP vs Zoho, drift flagged

- **Finance UI additions:**
  - `/vendor-bills` — list + detail + `Record Bill` dialog (three-way match: PO → DC → Bill)
  - `/vendor-payments` — upgrade from PO-centric to bill-centric; "Pay Bill" flow; MSME aging strip
  - `/profitability` — project P&L card: invoiced, received, outstanding AR; bills + expenses, paid/unpaid, margin
  - `/cash` — includes Zoho monthly summary subtraction; shows ERP vs Zoho reconciliation status
  - `/vendors/[id]` detail page — MSME aging, outstanding bills, payment history, TDS/GSTIN
  - Founder dashboard sync health card (queue depth, last sync time, drift count)

- **ERP → Zoho sync engine (n8n on spare laptop):**
  - n8n workflow reads `zoho_sync_queue` every 5 minutes
  - Maps ERP row → Zoho Books API payload
  - POSTs to Zoho Books REST API (`books.zoho.in/api/v3/...`)
  - Handles: invoices, customer_payments, purchase_orders, vendor_bills, vendor_payments, contacts, vendors, project-tagged expenses
  - On success: stamps `zoho_*_id` on ERP row, marks queue row `synced`
  - On failure: up to 3 total attempts (initial + 2 retries, one per 5-min cron tick — ~10 min total), then alert Vivek + mark `failed`

- **Monthly Zoho summary puller (n8n):**
  - Runs 2nd of every month, pulls previous month's totals per account from Zoho API
  - Stores in `zoho_monthly_summary` (year, month, account_code, debit_total, credit_total)
  - Feeds `/cash` company-wide view

- **Nightly reconciliation (n8n):**
  - Runs 2 AM daily
  - Fetches per-project invoice/bill/payment totals from Zoho API
  - Compares to ERP aggregates
  - Writes drift to `reconciliation_discrepancies`; alerts Vivek on new drift

### Out of scope (this spec)

- `/journal-entries` UI — journals stay Zoho-only
- `/credit-notes` creation UI — historical credit notes imported read-only; new ones still created in Zoho (low volume)
- `/bank-reconciliation` — Zoho-only
- GSTR-1 / GSTR-3B reports — Zoho-only (auditor files)
- Chart of Accounts UI — read-only view, editing stays in Zoho
- Fixed assets — Zoho-only
- Inventory module — called out by user as separate future module
- Expense claims for employee reimbursement — covered by the Expenses module spec
- Zoho-originated data flowing back to ERP (Zoho → ERP) — only the monthly summary puller is bi-directional; everything else is ERP → Zoho one-way
- Auto-filing GST returns — manual, auditor-driven
- Mobile parity for `/vendor-bills` and `/vendor-payments`

## 3. Users & Roles

| Action | `finance` | `founder` | `project_manager` | `purchase_officer` | `site_supervisor` | Others |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View all bills | ✅ | ✅ | ✅ (own projects) | ✅ | ❌ | ❌ |
| Record new bill | ✅ | ✅ | ✅ (own projects) | ✅ | ❌ | ❌ |
| Edit unpaid bill | ✅ | ✅ | ✅ (own projects, bill status = `draft` only) | ✅ | ❌ | ❌ |
| Pay bill | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View vendor master | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View profitability | ✅ | ✅ | ✅ (own projects) | ❌ | ❌ | ❌ |
| View company cash | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View reconciliation / sync health | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Resolve reconciliation discrepancy | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manually queue Zoho sync retry | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

Enforcement via RLS helpers `get_my_role()` and `get_my_employee_id()` per master reference §5.6.

## 4. Architecture

Three independent layers, each deployable on its own:

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1 — SCHEMA + UI (ERP operational source of truth)     │
│  vendor_bills, zoho_sync_queue, zoho_project_mapping, etc.   │
│  /vendor-bills, /vendor-payments, /profitability, /cash UI   │
└──────────────────────────────────────────────────────────────┘
                │
                │ writes to zoho_sync_queue on every mutation
                ▼
┌──────────────────────────────────────────────────────────────┐
│  LAYER 2 — HISTORICAL IMPORT (one-time, manual script)       │
│  TSX script parses 44 xls files → staging → ERP tables       │
│  Project matching engine + review queue                      │
│  Reconciliation report                                       │
└──────────────────────────────────────────────────────────────┘
                │
                │ backfills ERP, sets source='zoho_import'
                ▼
┌──────────────────────────────────────────────────────────────┐
│  LAYER 3 — LIVE SYNC (n8n on spare laptop)                   │
│  Every 5 min: queue → Zoho Books API → stamp zoho_*_id       │
│  Monthly: pull zoho_monthly_summary                          │
│  Nightly: reconciliation drift check                         │
└──────────────────────────────────────────────────────────────┘
```

**Why n8n and not Edge Functions:** n8n already runs on the spare laptop (port 5678) per master reference §2. Visual debugging is faster for an operational process that Vivek will have to eyeball during rollout. Edge Functions are the right call when logic is settled and in the codebase; this is settling-in workflow that will change several times in the first month. Move it to a repo-checked Edge Function in a follow-up once stable.

**Why one-way sync (ERP → Zoho only):** bidirectional sync causes silent merge conflicts. Zoho edits post-cutover are disallowed as policy. Only exception: the monthly summary puller brings Zoho → ERP a compressed read-only view for `/cash`.

## 5. Data Model

### 5.1 New tables

```sql
-- ============================================================
-- VENDOR BILLS (fills the PO → Bill → Payment gap)
-- ============================================================

CREATE TYPE vendor_bill_status AS ENUM (
  'draft',          -- entered but not finalized
  'pending',        -- finalized, awaiting payment
  'partially_paid', -- one or more payments applied, balance > 0
  'paid',           -- fully paid
  'cancelled'       -- voided (soft cancel, immutable)
);

CREATE TABLE vendor_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number TEXT NOT NULL,                      -- vendor's invoice number (e.g., "3SSOL2023-2045")
  bill_date DATE NOT NULL,                        -- MSME 45-day clock start
  due_date DATE,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),  -- nullable: some bills have no PO
  project_id UUID REFERENCES projects(id),        -- project attribution
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) DEFAULT 0,
  sgst_amount NUMERIC(14,2) DEFAULT 0,
  igst_amount NUMERIC(14,2) DEFAULT 0,
  cess_amount NUMERIC(14,2) DEFAULT 0,
  tds_amount NUMERIC(14,2) DEFAULT 0,
  round_off NUMERIC(14,2) DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(14,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  status vendor_bill_status NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'erp',              -- 'erp' | 'zoho_import'
  zoho_bill_id TEXT UNIQUE,                        -- Zoho's bill_id for sync traceability
  notes TEXT,
  terms_and_conditions TEXT,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- no deleted_at: bills are Tier 3 immutable (master ref §7)
  UNIQUE (vendor_id, bill_number)                  -- same vendor can't submit same bill twice
);

CREATE INDEX idx_vendor_bills_vendor ON vendor_bills(vendor_id);
CREATE INDEX idx_vendor_bills_project ON vendor_bills(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_vendor_bills_po ON vendor_bills(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX idx_vendor_bills_status ON vendor_bills(status);
CREATE INDEX idx_vendor_bills_bill_date ON vendor_bills(bill_date);
CREATE INDEX idx_vendor_bills_zoho_id ON vendor_bills(zoho_bill_id) WHERE zoho_bill_id IS NOT NULL;

CREATE TABLE vendor_bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_bill_id UUID NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  description TEXT,
  hsn_code TEXT,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) DEFAULT 0,
  taxable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_rate_pct NUMERIC(5,2) DEFAULT 0,
  sgst_rate_pct NUMERIC(5,2) DEFAULT 0,
  igst_rate_pct NUMERIC(5,2) DEFAULT 0,
  cgst_amount NUMERIC(14,2) DEFAULT 0,
  sgst_amount NUMERIC(14,2) DEFAULT 0,
  igst_amount NUMERIC(14,2) DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_order_item_id UUID REFERENCES purchase_order_items(id),  -- back-link for three-way match
  zoho_account_code TEXT,                           -- GL account from Chart of Accounts
  zoho_item_id TEXT,                                -- Zoho's item reference
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendor_bill_items_bill ON vendor_bill_items(vendor_bill_id);
CREATE INDEX idx_vendor_bill_items_po_item ON vendor_bill_items(purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL;


-- ============================================================
-- ZOHO SYNC QUEUE (outbound ERP → Zoho)
-- ============================================================

CREATE TYPE zoho_sync_entity_type AS ENUM (
  'contact', 'vendor', 'project',
  'invoice', 'customer_payment',
  'purchase_order', 'vendor_bill', 'vendor_payment',
  'expense'
);

CREATE TYPE zoho_sync_action AS ENUM ('create', 'update', 'delete');

CREATE TYPE zoho_sync_status AS ENUM (
  'pending',     -- waiting for n8n worker
  'syncing',     -- worker claimed the row
  'synced',      -- Zoho API returned 2xx, zoho_*_id stamped on source row
  'failed',      -- 3 retries exhausted
  'skipped'      -- manually skipped by admin (e.g., duplicate)
);

CREATE TABLE zoho_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type zoho_sync_entity_type NOT NULL,
  entity_id UUID NOT NULL,                          -- FK to the appropriate ERP table (not enforced at DB, checked in code)
  action zoho_sync_action NOT NULL,
  status zoho_sync_status NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  zoho_response JSONB,                              -- last response for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

-- Only one live (non-terminal) queue row per entity+action at a time.
-- Allows re-enqueue of a subsequent 'update' AFTER the first sync completed.
CREATE UNIQUE INDEX uq_zoho_sync_queue_active
  ON zoho_sync_queue (entity_type, entity_id, action)
  WHERE status IN ('pending', 'syncing', 'failed');

CREATE INDEX idx_zoho_sync_queue_pending ON zoho_sync_queue(created_at)
  WHERE status = 'pending';
CREATE INDEX idx_zoho_sync_queue_failed ON zoho_sync_queue(last_attempt_at)
  WHERE status = 'failed';


-- ============================================================
-- ZOHO LOOKUPS (references, populated from import + API)
-- ============================================================

CREATE TABLE zoho_project_mapping (
  zoho_project_id TEXT PRIMARY KEY,
  erp_project_id UUID NOT NULL REFERENCES projects(id),
  zoho_project_name TEXT NOT NULL,
  zoho_project_code TEXT,
  zoho_customer_name TEXT,
  match_confidence NUMERIC(3,2) NOT NULL,           -- 0.00-1.00
  match_method TEXT NOT NULL,                       -- 'auto_fuzzy' | 'manual' | 'auto_exact'
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_by UUID REFERENCES employees(id),
  notes TEXT
);

CREATE INDEX idx_zoho_project_mapping_erp ON zoho_project_mapping(erp_project_id);

CREATE TABLE zoho_account_codes (
  account_id TEXT PRIMARY KEY,                      -- Zoho Account ID
  account_name TEXT NOT NULL,                       -- "Food Expenses", "IGST Purchase @12%"
  account_code TEXT,                                -- manual code if set
  account_type TEXT NOT NULL,                       -- "Expense", "Other Expense", "Other Current Liability"
  parent_account TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE zoho_tax_codes (
  tax_id TEXT PRIMARY KEY,                          -- "1654845000000022293"
  tax_name TEXT NOT NULL,                           -- "IGST12", "CGST9", "SGST9"
  tax_percentage NUMERIC(5,2) NOT NULL,
  tax_type TEXT NOT NULL,                           -- "CGST" | "SGST" | "IGST" | "CESS"
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE zoho_items (
  zoho_item_id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  sku TEXT,
  hsn_code TEXT,
  rate NUMERIC(14,2),
  purchase_rate NUMERIC(14,2),
  sales_account TEXT,                               -- zoho_account_codes.account_name
  purchase_account TEXT,
  intra_state_tax_id TEXT REFERENCES zoho_tax_codes(tax_id),
  inter_state_tax_id TEXT REFERENCES zoho_tax_codes(tax_id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Company-wide non-project ledger summary (Zoho → ERP, monthly)
CREATE TABLE zoho_monthly_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  account_id TEXT NOT NULL REFERENCES zoho_account_codes(account_id),
  debit_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  transaction_count INT NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month, account_id)
);

CREATE INDEX idx_zoho_monthly_summary_period ON zoho_monthly_summary(year, month);


-- ============================================================
-- RECONCILIATION (nightly drift check)
-- ============================================================

CREATE TYPE reconciliation_entity_type AS ENUM (
  'project_totals', 'vendor_ap_total', 'customer_ar_total', 'cash_balance'
);

CREATE TYPE reconciliation_status AS ENUM ('open', 'acknowledged', 'resolved', 'accepted_drift');

CREATE TABLE reconciliation_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type reconciliation_entity_type NOT NULL,
  entity_ref TEXT NOT NULL,                         -- project_id, vendor_id, or 'company'
  metric TEXT NOT NULL,                             -- 'total_invoiced' | 'total_received' | 'total_billed' | 'total_paid'
  erp_value NUMERIC(14,2) NOT NULL,
  zoho_value NUMERIC(14,2) NOT NULL,
  difference NUMERIC(14,2) GENERATED ALWAYS AS (erp_value - zoho_value) STORED,
  status reconciliation_status NOT NULL DEFAULT 'open',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES employees(id),
  resolution_notes TEXT,
  UNIQUE (entity_type, entity_ref, metric, DATE(discovered_at))   -- one row per entity/metric/day
);

CREATE INDEX idx_reconciliation_open ON reconciliation_discrepancies(discovered_at)
  WHERE status = 'open';
```

### 5.2 Column additions on existing tables

```sql
-- Zoho IDs for traceability + sync mapping
ALTER TABLE customer_invoices ADD COLUMN zoho_invoice_id TEXT UNIQUE;
ALTER TABLE customer_payments ADD COLUMN zoho_customer_payment_id TEXT UNIQUE;
ALTER TABLE purchase_orders   ADD COLUMN zoho_po_id TEXT UNIQUE;
ALTER TABLE vendor_payments   ADD COLUMN zoho_vendor_payment_id TEXT UNIQUE;
ALTER TABLE contacts          ADD COLUMN zoho_contact_id TEXT UNIQUE;
ALTER TABLE vendors           ADD COLUMN zoho_vendor_id  TEXT UNIQUE;
ALTER TABLE projects          ADD COLUMN zoho_project_id TEXT UNIQUE;
ALTER TABLE expenses          ADD COLUMN zoho_expense_id TEXT UNIQUE;
-- (expenses is the renamed project_site_expenses after the Expenses module ships — migration 066)

-- Source flag (imported vs entered)
ALTER TABLE customer_invoices ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE customer_payments ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE purchase_orders   ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE vendor_payments   ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE expenses          ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));

-- Vendor bills link: payments now apply to bills, not (only) POs
ALTER TABLE vendor_payments ADD COLUMN vendor_bill_id UUID REFERENCES vendor_bills(id);
CREATE INDEX idx_vendor_payments_bill ON vendor_payments(vendor_bill_id) WHERE vendor_bill_id IS NOT NULL;

-- MSME: add Udyam number on vendors (matches Zoho's MSME/Udyam No column)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS udyam_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS udyam_type TEXT;

-- MSME 45-day clock re-keyed from bill_date
-- (Keep is_msme on vendors; just update the query in msme-compliance to use vendor_bills.bill_date)

-- Account + tax codes carried on bills/POs/invoices for sync payload construction
ALTER TABLE vendor_bills        ADD COLUMN IF NOT EXISTS zoho_vendor_gst_treatment TEXT;
ALTER TABLE customer_invoices   ADD COLUMN IF NOT EXISTS zoho_customer_gst_treatment TEXT;
```

### 5.3 Triggers & RLS

- **Sync queue triggers** (AFTER INSERT/UPDATE on the 9 synced tables): enqueue one `zoho_sync_queue` row per operational mutation. Three guards to prevent loops and no-op churn:
  1. Skip when `source = 'zoho_import'` (row came from the historical importer — already in Zoho).
  2. Skip when the UPDATE's only changed columns are `zoho_*_id`, `updated_at`, or sync-bookkeeping (the n8n worker stamps these back after a successful push — we don't want that to re-enqueue).
  3. `INSERT` always enqueues `action = 'create'`; `UPDATE` enqueues `action = 'update'` only if `zoho_*_id IS NOT NULL` on the OLD row (meaning Zoho has already seen it) — otherwise the pending `create` queue row will carry the latest values at send time.
- **Vendor bill cascade** (AFTER INSERT/UPDATE on `vendor_payments`): recalculate `vendor_bills.amount_paid` and `.status` per linked bill.
- **Project cash recompute** (existing trigger): extend to include bill data.
- **RLS on `vendor_bills`**: finance/founder read all; purchase_officer read all; project_manager read on own projects; site_supervisor hidden.
- **RLS on `zoho_sync_queue`, `reconciliation_discrepancies`**: finance + founder only.
- **`zoho_*_id` UNIQUE constraints** prevent duplicate syncs on retry.

## 6. Historical Import Workflow

**Location:** `scripts/zoho-import/`

```
scripts/zoho-import/
  index.ts                 # entrypoint: npx tsx scripts/zoho-import/index.ts --phase=all
  parse-xls.ts             # xls → JSON (shared by all phases)
  normalize.ts             # string normalization, uppercase strip, kwp strip, suffix strip
  phase-01-accounts.ts     # Chart_of_Accounts.xls → zoho_account_codes
  phase-02-taxes.ts        # Tax.xls + backfill from Invoice/Bill line-item tax columns → zoho_tax_codes
  phase-03-items.ts        # Item.xls → zoho_items
  phase-04-contacts.ts     # Contacts.xls → merge into contacts (dedupe by GSTIN + name fuzz)
  phase-05-vendors.ts      # Vendors.xls → merge into vendors (dedupe by GSTIN + name fuzz)
  phase-06-projects.ts     # Projects.xls → match existing ERP projects, write zoho_project_mapping
  phase-07-pos.ts          # Purchase_Order.xls → purchase_orders (+ line items)
  phase-08-invoices.ts     # Invoice.xls → customer_invoices (+ line items)
  phase-09-customer-payments.ts
  phase-10-bills.ts        # Bill.xls → vendor_bills (+ line items)
  phase-11-vendor-payments.ts
  phase-12-expenses.ts     # Expense.xls (project-tagged only) → expenses
  phase-13-credit-notes.ts # Credit_Note.xls → customer_credit_notes (table exists, just backfill)
  reconcile.ts             # compare totals per project ERP vs xls, write discrepancies
  match-engine.ts          # fuzzy project matching
  review-queue.ts          # CLI prompt for unmatched projects
```

**Execution order** (strict, each phase depends on the previous):

1. Load Chart of Accounts → `zoho_account_codes` (264 rows)
2. Load Tax codes → `zoho_tax_codes`
3. Load Items → `zoho_items` (945 rows)
4. Merge Contacts into `contacts` table:
   - Exact GSTIN match → link
   - Fuzzy display name match (Jaccard tokens ≥0.85 + same phone) → link, ask if ambiguous
   - Otherwise create new `contacts` row + stamp `zoho_contact_id`
5. Merge Vendors into `vendors`:
   - Same algorithm. Also populate `udyam_number`, `udyam_type` fields.
6. Match Projects (see §7)
7. For each of the 6 transactional phases (POs, invoices, customer payments, bills, vendor payments, expenses):
   - Parse xls
   - Group line items by document
   - For each document:
     - Resolve project_id via `zoho_project_mapping` (skip if unmatched)
     - Resolve vendor_id / contact_id via `zoho_*_id` lookups
     - Insert header + line items with `source = 'zoho_import'`, `zoho_*_id = <zoho ID>`
     - Do NOT enqueue to `zoho_sync_queue` (row already exists in Zoho)
   - Log `{ inserted, skipped, failed }` per phase
8. Run `reconcile.ts`:
   - For each project: SUM invoices / payments / bills / vendor_payments / expenses in ERP
   - Compare to SUM in the xls source
   - Write drift to `reconciliation_discrepancies` with status `open`
   - Expected: <1% of rows show drift (rounding, adjustment lines); flag the rest for review

**Idempotency:** every insert uses `ON CONFLICT (zoho_*_id) DO NOTHING`. Running the script twice doesn't duplicate rows. A `--dry-run` flag prints what would be inserted without writing.

**Safety:** script runs against dev Supabase. No prod touch until reconciliation passes + Vivek approves.

**Import does NOT:**
- Populate BOM/BOQ/survey/QC fields on Zoho-archive projects (we don't have that data)
- Trigger sync-to-Zoho (rows came from Zoho)
- Create notifications, tasks, or cascade triggers (use `SET session_replication_role = replica` during import to skip user-facing triggers; re-enable after)

## 7. Project Matching Algorithm

**Input:** 248 Zoho projects (`Projects.xls`), 316 ERP projects (`projects` table)
**Output:** `zoho_project_mapping` populated; `unmatched_projects.csv` for Vivek's review

**Algorithm:**

```typescript
function matchScore(zohoProject, erpProject): number {
  // 1. Normalize both sides: lowercase, strip punctuation, strip
  //    ["pvt ltd", "private limited", "llp", "ltd", "p ltd"],
  //    strip "- NkW" / "N kWp" / "N KW" size suffix
  const z = normalize(zohoProject.projectName + ' ' + zohoProject.customerName);
  const e = normalize(erpProject.customer_name);

  // 2. Token Jaccard on combined name
  const zTokens = new Set(z.split(/\s+/));
  const eTokens = new Set(e.split(/\s+/));
  const intersection = new Set([...zTokens].filter(t => eTokens.has(t)));
  const union = new Set([...zTokens, ...eTokens]);
  const jaccard = intersection.size / union.size;

  // 3. Size bonus: if Zoho name contains "N kW" and matches ERP project's system_size_kwp
  const zSize = extractKwpFromName(zohoProject.projectName);
  const sizeMatch = zSize && erpProject.system_size_kwp && Math.abs(zSize - erpProject.system_size_kwp) < 0.5;

  // 4. City bonus: if Zoho project name contains ERP project's site_city (or vice versa)
  const cityMatch = erpProject.site_city &&
    normalize(zohoProject.projectName).includes(normalize(erpProject.site_city));

  return jaccard + (sizeMatch ? 0.2 : 0) + (cityMatch ? 0.1 : 0);
}
```

**Bucketing:**

- **Auto-match (score ≥ 0.85):** write `zoho_project_mapping` with `match_method = 'auto_fuzzy'`.
- **Review (0.5 ≤ score < 0.85):** top-3 ERP candidates per Zoho row → `review_queue.csv`. Vivek picks or types "NEW" to create a new ERP project stub.
- **No match (score < 0.5):** → `unmatched.csv`. Vivek picks manually or marks "NEW".

**Expected outcome** (estimated from spot-checks in §3 above):
- ~180-200 auto-matched
- ~30-50 in review queue
- ~10-20 no-match (including legacy Zoho rows that are actually duplicates or test data)

**Review queue UX** (CLI-only for this spec — a full UI is out of scope):

```bash
$ npx tsx scripts/zoho-import/review-queue.ts
Processing 42 projects with ambiguous matches...

[1/42] Zoho: "NEPPATHUR 10MW" (customer: MEGAGRID VOLTARES BHARAT PVT LTD)
  Candidates:
    (a) SHIROI/PROJ/2024-25/0023  MEGAGRID VOLTARES BHARAT — 10.00 kWp — Neppathur  (score 0.82)
    (b) SHIROI/PROJ/2024-25/0045  MEGAGRID — 10.00 kWp — Neppathur (score 0.71)
    (n) NEW — create a new ERP project stub for this Zoho row
    (s) SKIP — will leave in unmatched.csv
  Choice [a/b/n/s]:
```

Vivek runs this once, picks letters. Output updates `zoho_project_mapping`. Rows left skipped/unmatched leave Zoho data stranded until re-matched later.

**"Create new ERP project stub" path** (expected rare — the user stated all Zoho projects should already exist in ERP, so stubs should be edge cases only): inserts a minimal `projects` row with status `completed` (Zoho marks all 248 as "Active" but most are historical), populated from `Projects.xls` (customer_name, project_code → notes field, contracted_value = Zoho's Project Cost). Source attribution is captured via `projects.zoho_project_id` stamping + the `source = 'zoho_import'` flag on downstream rows — no new column on `projects` needed.

**Sanity check:** if a run produces > 20 stubs, matching thresholds are too tight. Adjust and re-run.

## 8. Finance UI Additions

### 8.1 `/vendor-bills` — list + detail + create

**List page:** `apps/erp/src/app/(erp)/vendor-bills/page.tsx`
- DataTable (shared): vendor, bill_number, bill_date, due_date, project, total_amount, balance_due, status
- Filters: status, vendor, project, date range, MSME-only
- Saved views via `table_views`

**Detail page:** `apps/erp/src/app/(erp)/vendor-bills/[id]/page.tsx`
- Header: bill number, vendor, project, status badge, balance due
- Items table: line items with HSN, qty, rate, GST splits
- Payments applied: list of `vendor_payments` rows linked via `vendor_bill_id`
- `Pay Bill` button → `RecordVendorBillPaymentDialog`

**Create dialog:** `components/vendor-bills/record-bill-dialog.tsx`
- Fields: vendor (searchable combobox), PO (optional, filtered to selected vendor), bill_number, bill_date, due_date
- Line items: dynamic rows (item_name, hsn, qty, rate, discount, tax rate → auto GST split)
- Auto-totals: subtotal, CGST/SGST/IGST (based on vendor's state vs Shiroi Tamil Nadu), round-off, total
- If PO selected: "Copy items from PO" fills line items, sets `purchase_order_item_id` on each bill item
- Save → `vendor-bills-actions.ts::createBill` → enqueue Zoho sync

**Files to create:**
```
apps/erp/src/app/(erp)/vendor-bills/
  page.tsx
  [id]/page.tsx
  new/page.tsx                              # alternative full-page create for mobile-ish flow

apps/erp/src/lib/
  vendor-bills-queries.ts                   # getVendorBills, getVendorBill, getVendorBillsByProject
  vendor-bills-actions.ts                   # createBill, updateBill, cancelBill, payBill

apps/erp/src/components/vendor-bills/
  record-bill-dialog.tsx
  record-bill-payment-dialog.tsx
  vendor-bill-line-items-editor.tsx
  vendor-bill-status-badge.tsx
```

### 8.2 `/vendor-payments` — bill-centric upgrade

Current `/vendor-payments` is PO-centric and read-only. Upgrade:
- Pivot to bill-centric: list shows `vendor_bills` with status `pending` / `partially_paid`, sorted by bill_date ascending (MSME pressure)
- MSME aging strip at top: Day 30 / Day 40 / Day 45 / overdue counts
- `Pay Bill` action opens `RecordVendorBillPaymentDialog`
- Keep a "By PO" tab for audit continuity (existing view)

### 8.3 `/profitability` — full project P&L

**RPC:** `get_project_profitability_v2(project_id UUID DEFAULT NULL)` — returns per-project:
```
project_id, project_name, customer_name, status,
  contracted_value,
  total_invoiced, total_received, total_ar_outstanding,
  total_billed, total_vendor_paid, total_ap_outstanding,
  total_expenses, total_expenses_paid,
  total_cost (= total_billed + total_expenses),
  margin_amount (= contracted_value - total_cost),
  margin_pct
```

UI shows each project as a card + top-line totals across all active projects. Founder sees all; PM sees own.

### 8.4 `/cash` — company cash including Zoho summary

**RPC:** `get_company_cash_summary_v2()` — extends the existing version with:
- Project-level cash positions (from `project_cash_positions` — existing)
- Zoho monthly summary subtraction (company-wide expenses not in ERP: salary, rent, etc.)
- Reconciliation status banner (if any `open` discrepancies, show count + link)

### 8.5 `/vendors/[id]` — detail page

New page (replaces the list-only `/vendors`):
- Header: vendor name, GSTIN, Udyam, TDS section, bank details
- MSME aging strip (if MSME): pending bill count by aging bucket
- Tabs: Bills, Payments, POs, Activity
- Outstanding balance prominent

### 8.6 Founder dashboard — sync health card

Add a small card on `/dashboard` (founder view only):
- `zoho_sync_queue` depth (pending / syncing / failed)
- Last successful sync timestamp
- Reconciliation: count of open discrepancies
- Red badge if any failed > 1 hour old

## 9. ERP → Zoho Sync Engine (n8n)

### 9.1 Workflow: "ZohoSync"

**Trigger:** n8n Schedule node, every 5 minutes.

**Steps:**

1. **Fetch pending queue rows** (up to 50 per run):
   ```sql
   UPDATE zoho_sync_queue
   SET status = 'syncing', last_attempt_at = NOW(), attempt_count = attempt_count + 1
   WHERE id IN (
     SELECT id FROM zoho_sync_queue
     WHERE status IN ('pending', 'failed') AND attempt_count < 3
     ORDER BY created_at ASC LIMIT 50
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```

2. **For each row:**
   - Dispatch by `entity_type` → route to the matching Zoho endpoint
   - Build payload (see §9.2)
   - POST/PUT to Zoho Books API
   - On 2xx:
     ```sql
     UPDATE <entity_table> SET zoho_<entity>_id = <response.id> WHERE id = <entity_id>;
     UPDATE zoho_sync_queue SET status = 'synced', synced_at = NOW(), zoho_response = <response_json> WHERE id = <queue_id>;
     ```
   - On 4xx/5xx:
     - Log `last_error`, `zoho_response`
     - If `attempt_count >= 3`: status = 'failed', trigger WhatsApp alert to Vivek
     - Else: status = 'pending' (will retry next run)

3. **Rate limiting:** Zoho Books API is 100 req/min. With 50 per 5-min run, we're at 10 req/min — well under.

### 9.2 Endpoint mapping

| ERP entity | Zoho Books endpoint | Notes |
|---|---|---|
| `contacts` (create) | `POST /contacts` | GSTIN, billing address, contact_type='customer' |
| `vendors` (create) | `POST /contacts` | contact_type='vendor', MSME fields |
| `projects` (create) | `POST /projects` | customer_id from contact sync; `reference_number = project_number` |
| `customer_invoices` (create) | `POST /invoices` | line items, tax IDs from `zoho_tax_codes`, project_id from mapping |
| `customer_payments` (create) | `POST /customerpayments` | invoices[] with applied amounts |
| `purchase_orders` (create) | `POST /purchaseorders` | line items, vendor_id, project_id |
| `vendor_bills` (create) | `POST /bills` | line items, vendor_id, project_id, tax IDs |
| `vendor_payments` (create) | `POST /vendorpayments` | bills[] with applied amounts |
| `expenses` (create) | `POST /expenses` | project-tagged only; account_id from `zoho_account_codes` |
| Any of the above (update) | `PUT /<entity>/:id` | uses `zoho_*_id` |

**Auth:** OAuth2 refresh token flow. Zoho API requires a self-client app registration; the refresh token sits in n8n credentials.

**Shared sub-workflow:** "MapErpToZohoPayload" — one n8n function node per entity_type that translates the DB row JSON into the Zoho schema. Unit-tested via n8n's built-in test inputs.

### 9.3 Failure handling

- **Network timeout:** Zoho API default timeout 30s. Failed row falls back to `pending` and is retried on the next 5-min tick (cap: 3 total attempts).
- **4xx validation error:** Mark `failed` immediately, no retry. Email/WA Vivek with the payload + error.
- **429 rate limit:** Set back to `pending` (not `failed`) and defer to next run; doesn't consume an attempt.
- **Zoho 500:** Normal retry cycle.
- **Auth failure (token expired):** Refresh via separate n8n workflow that runs hourly; if refresh also fails, alert Vivek.

### 9.4 Monthly summary puller (separate n8n workflow)

**Trigger:** Schedule node, 2nd of every month at 6 AM IST.

**Steps:**
1. For each account in `zoho_account_codes` (264 rows):
   - `GET /reports/accounttransactions?account_id=<id>&from_date=<prev_month_start>&to_date=<prev_month_end>`
   - SUM debits, credits, count transactions
   - UPSERT into `zoho_monthly_summary (year, month, account_id, debit_total, credit_total, transaction_count)`
2. Total rate: 264 API calls / month = trivial.

### 9.5 Reconciliation (separate n8n workflow)

**Trigger:** Schedule node, 2 AM daily.

**Steps:**
1. For each `zoho_project_mapping` row:
   - Fetch ERP totals via RPC `get_project_profitability_v2(project_id)`
   - Fetch Zoho totals via `GET /projects/:zoho_project_id/activities` or per-entity list endpoints filtered by project
   - Diff each metric (total_invoiced, total_received, total_billed, total_paid)
   - For metrics with |diff| > ₹1 (tolerance for rounding):
     - UPSERT `reconciliation_discrepancies`
     - If status = 'resolved' and diff now matches: flip to 'resolved' (preserve audit)
2. If any new 'open' rows: send summary email to Vivek + finance.

## 10. Migration Sequence

Starting at **migration 067** (after Expenses ships as 066):

| Migration | Contents |
|---|---|
| 067 | Core schema: `vendor_bills`, `vendor_bill_items`, `zoho_sync_queue` + enums, all `zoho_*_id` columns on existing tables, `source` columns, `vendor_payments.vendor_bill_id` FK, `vendors.udyam_*` columns, indexes |
| 068 | Zoho lookups: `zoho_project_mapping`, `zoho_account_codes`, `zoho_tax_codes`, `zoho_items`, `zoho_monthly_summary`, `reconciliation_discrepancies` + enums, RLS |
| 069 | Sync triggers: `fn_enqueue_zoho_sync` trigger function, per-table AFTER INSERT/UPDATE triggers on the 9 synced tables (skip when `source = 'zoho_import'`) |
| 070 | Bill payment cascade: `fn_cascade_vendor_payment_to_bill` trigger that recalcs `vendor_bills.amount_paid` / `.status` on `vendor_payments` INSERT/UPDATE |
| 071 | RPCs: `get_project_profitability_v2`, `get_company_cash_summary_v2`, `get_msme_aging_summary` |

Any follow-on RLS or schema tweaks discovered during rollout get their own migration numbers as they're needed — not pre-reserved.

Types regenerated after each migration (NEVER-DO #20). Each migration committed + tested in dev before the next.

## 11. Cutover Plan

**Dev rollout** (week 1–5):
- Apply 067–071 migrations on dev
- Run historical import on dev
- Reconcile; fix matching + drift
- Build UI
- Bring up n8n sync workflow; simulate entries in ERP; confirm they land in Zoho dev org
- Manual end-to-end test: enter a bill in ERP → appears in Zoho within 5 min

**Prod rollout** (week 6):
- Apply 067–071 to prod (coordinated window, batch-promote with any other pending migrations)
- Regenerate prod types
- Re-run historical import **against prod Supabase** using prod Zoho data (not the dev .xls — re-export from Zoho the day of cutover so totals are fresh)
- Turn on n8n sync workflow pointed at Zoho prod org
- Monitor: first week Vivek eyeballs every synced entity; finance double-checks in Zoho Books UI
- If drift > 1% on any project after first week of live sync: investigate + pause

**Post-cutover policy:**
- Operational entries (PO, invoice, customer payment, bill, vendor payment, project expense): **ERP only.**
- Zoho-only entries (journal, salary, depreciation, non-project expense): **Zoho only.**
- Edits in Zoho Books on ERP-sourced records: **prohibited** (if auditor needs a correction, flag it, make the correction in ERP, let it re-sync).
- At 12 months: review auditor comfort. If ready, turn off sync and ERP is the sole system. If not, extend another 6 months.

## 12. Security, Integrity, Observability

**RLS:**
- `vendor_bills` + `vendor_bill_items` RLS mirrors `purchase_orders` (finance/founder all, PM own projects, purchase_officer all, site_supervisor none).
- `zoho_sync_queue`, `reconciliation_discrepancies`, `zoho_monthly_summary`: finance + founder only.
- `zoho_*_id` columns inherit parent-table RLS (they're on the same row).

**Immutability (master ref §7):**
- `vendor_bills` is **Tier 3** — no soft delete, no post-paid edit. Corrections via vendor credit notes.
- `vendor_bill_items` scope is limited to editing a `draft` bill; once `status = 'pending'` or later, line items are locked (trigger enforces).

**Sensitive data:**
- Vendor bank account numbers stored in `vendors.bank_account_number` (already encrypted via pgcrypto per master ref §6.10). Never in logs.
- Zoho refresh tokens live only in n8n credentials — never in the ERP DB, never in source code.

**Observability:**
- Every server action in `vendor-bills-actions.ts` uses the `const op = '[functionName]'` pattern (CLAUDE.md §4).
- Sync queue has `last_error` + `zoho_response` for debugging.
- Sentry captures ERP-side errors; n8n global error handler captures sync-side.
- Founder dashboard sync card is the operational health gauge.

**Idempotency:**
- All `zoho_*_id` columns are `UNIQUE`, so re-running import or re-sending a sync request can't create duplicates.
- Queue enqueue trigger checks `UNIQUE (entity_type, entity_id, action)` — same operation can't be queued twice.

## 13. Open Questions / Decisions Deferred

- **Zoho API self-client app registration:** needs to be done by Vivek in the Zoho Developer Console. Blocks n8n workflow bring-up. Estimate: 1 day.
- **OAuth refresh token rotation policy:** Zoho rotates tokens periodically. Need a fallback for the rotation event. Covered by the hourly refresh workflow in §9.3.
- **What happens to ~200 "completed in Zoho, never in ERP" projects?** User said all Zoho projects should exist in ERP — we'll know for sure when matching runs. If many unmatched, we revisit.
- **Credit note creation UI:** historical credit notes are imported read-only; new ones still created in Zoho for now. Could be added later if volume warrants.
- **Mobile bill-entry flow:** site supervisors may want to snap a vendor bill photo + enter on mobile. Deferred — mobile app isn't built yet.
- **Archival of failed sync rows:** if `status = 'failed'` and older than 90 days, archive to `zoho_sync_queue_archive`? Decide after first 3 months in production.

## 14. Testing Strategy

**Historical import:**
- `--dry-run` flag prints intended inserts without touching DB.
- Unit tests for `match-engine.ts` (small fixture set of expected matches).
- Integration: run import on a fresh dev DB; verify row counts match xls row counts; reconciliation returns 0 discrepancies.

**UI:**
- Playwright smoke: happy path for "Record a bill + pay it → appears under project profitability".
- Visual diff on `/profitability` card (founder view).

**Sync:**
- n8n workflow has a test mode that runs against Zoho sandbox org before prod.
- First week of prod: manual eyeball on every synced entity.

**Reconciliation:**
- Golden test: import, then immediately reconcile — should produce 0 discrepancies.
- Drift injection: manually INSERT into ERP without sync, run reconcile, verify discrepancy row is created.

---

*Brainstormed 2026-04-17. Approach 2 (balanced data + UI) selected. Implementation plan follows.*
