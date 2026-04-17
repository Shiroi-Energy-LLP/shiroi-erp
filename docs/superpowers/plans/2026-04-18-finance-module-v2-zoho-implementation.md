# Finance Module V2 — Zoho Books Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Finance Module V2 — fill the `vendor_bills` schema gap, import 3 years of Zoho Books data into ERP (with fuzzy project matching), add Finance UI (bills, bill-centric payments, project P&L, company cash with Zoho subtraction, vendor detail, founder sync card), and scaffold the n8n ERP → Zoho one-way sync.

**Architecture:** Three layers (Schema + UI — Historical Import — Live Sync). ERP is the system of record for operational entries; Zoho stays authoritative for the auditor for ~12 months via a one-way ERP → Zoho sync over n8n. Historical import backfills the gap on a one-time basis.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase Postgres · XLSX (SheetJS) · decimal.js · shadcn/ui · n8n (spare laptop). Types regenerated from the live Supabase schema after each migration (NEVER-DO #20).

**Spec:** [`docs/superpowers/specs/2026-04-17-finance-module-v2-zoho-design.md`](../specs/2026-04-17-finance-module-v2-zoho-design.md)

---

## Ground rules (read before starting)

- **Dev Supabase only.** All migrations land on dev (`actqtzoxjilqnldnacqz`) via the `apply_migration` MCP tool. Prod is untouched.
- **One migration per task.** Each migration committed before the next starts. Types regenerated as part of the same commit.
- **Never `as any`.** If a type looks wrong, regenerate `packages/types/database.ts` and re-derive via `Database['public']['Tables']['x']['Row']`.
- **Server actions return `ActionResult<T>`** from `@/lib/types/actions` — never throw.
- **Reads in `*-queries.ts`, mutations in `*-actions.ts`** (with `'use server'` at top of file).
- **No inline Supabase calls in `page.tsx` / components.** Always through a queries/actions module.
- **Money:** `decimal.js` on the client; `NUMERIC(14,2)` in SQL; `formatINR()` for display.
- **Commit cadence:** after every task completes green (types + lint + check-types pass). Push to `main` after each commit (user's standing preference — see memory).
- **`SET session_replication_role = replica`** is `superuser`-only on Supabase — do NOT rely on it. Instead, the sync triggers include a `source = 'zoho_import'` guard so imports don't enqueue sync rows.
- **Before any phase, verify the target table's NOT NULL and CHECK constraints** via `mcp__list_tables` or reading the migration. The plan is built against the schema as of migration 066 + the migrations we're about to add; if you find a drift (column removed, new NOT NULL), resolve it inline and note the change in the task.
- **Table names (important):** customer-facing invoices live in `invoices` (NOT `customer_invoices`). Credit notes against them live in `invoice_credit_notes`. The ERP has no separate invoice-line-items table — line-item data is aggregated into the invoice row's subtotal fields.
- **Numbering collisions:** When importing entities that have a UNIQUE number column (`invoice_number`, `bill_number`, `po_number`, `receipt_number`, `credit_note_number`), prefix imported values with `ZHI/` to avoid collision with ERP-issued numbers.
- **`SYSTEM_EMPLOYEE_ID`:** Vivek's employee row (`email = 'svivek.88@gmail.com'`). Use `await getSystemEmployeeId()` from `scripts/zoho-import/supabase.ts`. This is the `created_by`/`raised_by`/`prepared_by`/`recorded_by`/`submitted_by` for every imported row.

---

## Phase A — Schema Foundation (migrations 067-071)

### Task 1: Migration 067 — vendor_bills core + zoho_sync_queue + column adds

**Files:**
- Create: `supabase/migrations/067_finance_v2_core.sql`
- Modify: `packages/types/database.ts` (regenerated from schema)

- [ ] **Step 1: Write migration 067**

Create `supabase/migrations/067_finance_v2_core.sql`:

```sql
-- Migration 067: Finance Module V2 — core schema
-- See docs/superpowers/specs/2026-04-17-finance-module-v2-zoho-design.md §5.1, 5.2
--
-- Summary:
--  1. vendor_bills + vendor_bill_items tables
--  2. zoho_sync_queue + enums
--  3. zoho_*_id columns on 8 existing tables
--  4. source columns on 5 operational tables
--  5. vendor_payments.vendor_bill_id FK
--  6. vendors.udyam_number + udyam_type
--  7. Indexes on every new filterable/joinable column

BEGIN;

-- ============================================================================
-- Section 1: vendor_bill_status enum + vendor_bills table
-- ============================================================================

CREATE TYPE vendor_bill_status AS ENUM (
  'draft',
  'pending',
  'partially_paid',
  'paid',
  'cancelled'
);

CREATE TABLE vendor_bills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number       TEXT NOT NULL,
  bill_date         DATE NOT NULL,
  due_date          DATE,
  vendor_id         UUID NOT NULL REFERENCES vendors(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  project_id        UUID REFERENCES projects(id),
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  tds_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due       NUMERIC(14,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  status            vendor_bill_status NOT NULL DEFAULT 'draft',
  source            TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import')),
  zoho_bill_id      TEXT UNIQUE,
  zoho_vendor_gst_treatment TEXT,
  notes             TEXT,
  terms_and_conditions TEXT,
  created_by        UUID REFERENCES employees(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, bill_number)
);

CREATE INDEX idx_vendor_bills_vendor    ON vendor_bills(vendor_id);
CREATE INDEX idx_vendor_bills_project   ON vendor_bills(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_vendor_bills_po        ON vendor_bills(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX idx_vendor_bills_status    ON vendor_bills(status);
CREATE INDEX idx_vendor_bills_bill_date ON vendor_bills(bill_date DESC);
CREATE INDEX idx_vendor_bills_zoho_id   ON vendor_bills(zoho_bill_id) WHERE zoho_bill_id IS NOT NULL;

CREATE TABLE vendor_bill_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_bill_id         UUID NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  item_name              TEXT NOT NULL,
  description            TEXT,
  hsn_code               TEXT,
  quantity               NUMERIC(12,3) NOT NULL DEFAULT 1,
  rate                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_rate_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  sgst_rate_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  igst_rate_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  cgst_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_order_item_id UUID REFERENCES purchase_order_items(id),
  zoho_account_code      TEXT,
  zoho_item_id           TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendor_bill_items_bill    ON vendor_bill_items(vendor_bill_id);
CREATE INDEX idx_vendor_bill_items_po_item ON vendor_bill_items(purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL;

-- updated_at trigger (re-use existing timestamp trigger pattern)
CREATE TRIGGER vendor_bills_updated_at
  BEFORE UPDATE ON vendor_bills
  FOR EACH ROW
  EXECUTE FUNCTION set_current_timestamp_updated_at();

-- ============================================================================
-- Section 2: vendor_bills RLS (mirrors purchase_orders)
-- ============================================================================

ALTER TABLE vendor_bills      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bill_items ENABLE ROW LEVEL SECURITY;

-- SELECT: finance/founder all; purchase_officer all; project_manager own projects; site_supervisor hidden
CREATE POLICY vendor_bills_select ON vendor_bills
  FOR SELECT USING (
    get_my_role() IN ('finance','founder','purchase_officer','admin')
    OR (
      get_my_role() = 'project_manager'
      AND project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = vendor_bills.project_id
          AND p.project_manager_id = get_my_employee_id()
      )
    )
  );

-- INSERT/UPDATE/DELETE: finance/founder/purchase_officer; PM own-project
CREATE POLICY vendor_bills_mutate ON vendor_bills
  FOR ALL USING (
    get_my_role() IN ('finance','founder','purchase_officer','admin')
    OR (
      get_my_role() = 'project_manager'
      AND project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = vendor_bills.project_id
          AND p.project_manager_id = get_my_employee_id()
      )
    )
  ) WITH CHECK (
    get_my_role() IN ('finance','founder','purchase_officer','admin')
    OR (
      get_my_role() = 'project_manager'
      AND project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = vendor_bills.project_id
          AND p.project_manager_id = get_my_employee_id()
      )
    )
  );

-- vendor_bill_items inherit parent bill visibility
CREATE POLICY vendor_bill_items_select ON vendor_bill_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vendor_bills b WHERE b.id = vendor_bill_id)
  );
CREATE POLICY vendor_bill_items_mutate ON vendor_bill_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM vendor_bills b WHERE b.id = vendor_bill_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM vendor_bills b WHERE b.id = vendor_bill_id)
  );

-- ============================================================================
-- Section 3: zoho_sync_queue + enums
-- ============================================================================

CREATE TYPE zoho_sync_entity_type AS ENUM (
  'contact','vendor','project',
  'invoice','customer_payment',
  'purchase_order','vendor_bill','vendor_payment',
  'expense'
);

CREATE TYPE zoho_sync_action AS ENUM ('create','update','delete');

CREATE TYPE zoho_sync_status AS ENUM (
  'pending','syncing','synced','failed','skipped'
);

CREATE TABLE zoho_sync_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      zoho_sync_entity_type NOT NULL,
  entity_id        UUID NOT NULL,
  action           zoho_sync_action NOT NULL,
  status           zoho_sync_status NOT NULL DEFAULT 'pending',
  attempt_count    INT NOT NULL DEFAULT 0,
  last_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,
  zoho_response    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at        TIMESTAMPTZ
);

-- Only ONE live (non-terminal) row per entity+action.
-- Allows re-enqueue of a later 'update' once the earlier one is 'synced'.
CREATE UNIQUE INDEX uq_zoho_sync_queue_active
  ON zoho_sync_queue (entity_type, entity_id, action)
  WHERE status IN ('pending','syncing','failed');

CREATE INDEX idx_zoho_sync_queue_pending ON zoho_sync_queue(created_at) WHERE status = 'pending';
CREATE INDEX idx_zoho_sync_queue_failed  ON zoho_sync_queue(last_attempt_at) WHERE status = 'failed';

ALTER TABLE zoho_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY zoho_sync_queue_select ON zoho_sync_queue
  FOR SELECT USING (get_my_role() IN ('finance','founder','admin'));

CREATE POLICY zoho_sync_queue_mutate ON zoho_sync_queue
  FOR ALL USING (get_my_role() IN ('finance','founder','admin'))
  WITH CHECK (get_my_role() IN ('finance','founder','admin'));

-- ============================================================================
-- Section 4: zoho_*_id columns on operational tables
-- ============================================================================

ALTER TABLE invoices ADD COLUMN zoho_invoice_id          TEXT UNIQUE;
ALTER TABLE customer_payments ADD COLUMN zoho_customer_payment_id TEXT UNIQUE;
ALTER TABLE purchase_orders   ADD COLUMN zoho_po_id               TEXT UNIQUE;
ALTER TABLE vendor_payments   ADD COLUMN zoho_vendor_payment_id   TEXT UNIQUE;
ALTER TABLE contacts          ADD COLUMN zoho_contact_id          TEXT UNIQUE;
ALTER TABLE vendors           ADD COLUMN zoho_vendor_id           TEXT UNIQUE;
ALTER TABLE projects          ADD COLUMN zoho_project_id          TEXT UNIQUE;
ALTER TABLE expenses          ADD COLUMN zoho_expense_id          TEXT UNIQUE;
ALTER TABLE invoice_credit_notes ADD COLUMN zoho_credit_note_id    TEXT UNIQUE;

-- ============================================================================
-- Section 5: source columns on operational tables
-- ============================================================================

ALTER TABLE invoices ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE customer_payments ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE purchase_orders   ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE vendor_payments   ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE expenses          ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE invoice_credit_notes ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));

-- ============================================================================
-- Section 6: vendor_payments.vendor_bill_id FK + GST treatment on invoices
-- ============================================================================

ALTER TABLE vendor_payments ADD COLUMN vendor_bill_id UUID REFERENCES vendor_bills(id);
CREATE INDEX idx_vendor_payments_bill ON vendor_payments(vendor_bill_id) WHERE vendor_bill_id IS NOT NULL;

-- Make PO link nullable so bill-centric payments (and Zoho imports without PO) work.
-- vendor_bill_id takes over as the primary link; purchase_order_id stays for backward compat.
ALTER TABLE vendor_payments ALTER COLUMN purchase_order_id DROP NOT NULL;
ALTER TABLE vendor_payments ALTER COLUMN po_date DROP NOT NULL;
ALTER TABLE vendor_payments ALTER COLUMN days_from_po DROP NOT NULL;

-- Add bill-centric MSME fields: days measured from bill_date, not po_date.
ALTER TABLE vendor_payments ADD COLUMN days_from_bill INT;
-- Row-level CHECK: one of (purchase_order_id, vendor_bill_id) must be set.
ALTER TABLE vendor_payments ADD CONSTRAINT vendor_payments_has_link
  CHECK (purchase_order_id IS NOT NULL OR vendor_bill_id IS NOT NULL);

ALTER TABLE invoices ADD COLUMN zoho_customer_gst_treatment TEXT;

-- ============================================================================
-- Section 7: vendors.udyam_* (matches Zoho's MSME/Udyam fields)
-- ============================================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS udyam_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS udyam_type   TEXT;

COMMIT;
```

- [ ] **Step 2: Apply migration via MCP**

Tool: `mcp__7a8c9855-...__apply_migration`
- `project_id`: dev (`actqtzoxjilqnldnacqz`)
- `name`: `067_finance_v2_core`
- `query`: contents of `supabase/migrations/067_finance_v2_core.sql`

Expected: migration applied without error. If any referenced function (e.g. `get_my_role`, `get_my_employee_id`, `set_current_timestamp_updated_at`) doesn't exist, grep `supabase/migrations/` to find the canonical name and adjust the migration — do NOT create a new helper.

- [ ] **Step 3: Regenerate types**

Tool: `mcp__7a8c9855-...__generate_typescript_types` with `project_id = actqtzoxjilqnldnacqz`.

Overwrite `packages/types/database.ts` with the returned string. Run `pnpm check-types` from repo root — must pass 0 errors.

- [ ] **Step 4: Commit + push**

```bash
git add supabase/migrations/067_finance_v2_core.sql packages/types/database.ts
git commit -m "feat(db): migration 067 — vendor_bills + zoho_sync_queue + column adds"
git push origin main
```

---

### Task 2: Migration 068 — Zoho lookup tables

**Files:**
- Create: `supabase/migrations/068_finance_v2_zoho_lookups.sql`
- Modify: `packages/types/database.ts`

- [ ] **Step 1: Write migration 068**

```sql
-- Migration 068: Finance V2 — Zoho lookup tables + reconciliation
-- See spec §5.1.
BEGIN;

-- ============================================================================
-- Section 1: Zoho project mapping
-- ============================================================================

CREATE TABLE zoho_project_mapping (
  zoho_project_id     TEXT PRIMARY KEY,
  erp_project_id      UUID NOT NULL REFERENCES projects(id),
  zoho_project_name   TEXT NOT NULL,
  zoho_project_code   TEXT,
  zoho_customer_name  TEXT,
  match_confidence    NUMERIC(4,2) NOT NULL,
  match_method        TEXT NOT NULL CHECK (match_method IN ('auto_exact','auto_fuzzy','manual')),
  matched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_by          UUID REFERENCES employees(id),
  notes               TEXT
);
CREATE INDEX idx_zoho_project_mapping_erp ON zoho_project_mapping(erp_project_id);

ALTER TABLE zoho_project_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY zoho_project_mapping_all ON zoho_project_mapping
  FOR ALL USING (get_my_role() IN ('finance','founder','admin'))
  WITH CHECK (get_my_role() IN ('finance','founder','admin'));

-- ============================================================================
-- Section 2: Chart of Accounts
-- ============================================================================

CREATE TABLE zoho_account_codes (
  account_id     TEXT PRIMARY KEY,
  account_name   TEXT NOT NULL,
  account_code   TEXT,
  account_type   TEXT NOT NULL,
  parent_account TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_zoho_account_codes_type ON zoho_account_codes(account_type);

ALTER TABLE zoho_account_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY zoho_account_codes_select ON zoho_account_codes
  FOR SELECT USING (get_my_role() IN ('finance','founder','purchase_officer','admin'));
CREATE POLICY zoho_account_codes_mutate ON zoho_account_codes
  FOR INSERT WITH CHECK (get_my_role() IN ('finance','founder','admin'));

-- ============================================================================
-- Section 3: Tax codes
-- ============================================================================

CREATE TABLE zoho_tax_codes (
  tax_id          TEXT PRIMARY KEY,
  tax_name        TEXT NOT NULL,
  tax_percentage  NUMERIC(5,2) NOT NULL,
  tax_type        TEXT NOT NULL CHECK (tax_type IN ('CGST','SGST','IGST','CESS','OTHER')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE zoho_tax_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY zoho_tax_codes_select ON zoho_tax_codes
  FOR SELECT USING (get_my_role() IN ('finance','founder','purchase_officer','admin'));
CREATE POLICY zoho_tax_codes_mutate ON zoho_tax_codes
  FOR INSERT WITH CHECK (get_my_role() IN ('finance','founder','admin'));

-- ============================================================================
-- Section 4: Items master (reference only — NOT merged into BOQ)
-- ============================================================================

CREATE TABLE zoho_items (
  zoho_item_id        TEXT PRIMARY KEY,
  item_name           TEXT NOT NULL,
  sku                 TEXT,
  hsn_code            TEXT,
  rate                NUMERIC(14,2),
  purchase_rate       NUMERIC(14,2),
  sales_account       TEXT,
  purchase_account    TEXT,
  intra_state_tax_id  TEXT REFERENCES zoho_tax_codes(tax_id),
  inter_state_tax_id  TEXT REFERENCES zoho_tax_codes(tax_id),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE zoho_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY zoho_items_select ON zoho_items
  FOR SELECT USING (get_my_role() IN ('finance','founder','purchase_officer','admin'));
CREATE POLICY zoho_items_mutate ON zoho_items
  FOR INSERT WITH CHECK (get_my_role() IN ('finance','founder','admin'));

-- ============================================================================
-- Section 5: Monthly Zoho summary (pulled once per month by n8n)
-- ============================================================================

CREATE TABLE zoho_monthly_summary (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year              INT NOT NULL,
  month             INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  account_id        TEXT NOT NULL REFERENCES zoho_account_codes(account_id),
  debit_total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  transaction_count INT NOT NULL DEFAULT 0,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month, account_id)
);
CREATE INDEX idx_zoho_monthly_summary_period ON zoho_monthly_summary(year, month);

ALTER TABLE zoho_monthly_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY zoho_monthly_summary_all ON zoho_monthly_summary
  FOR ALL USING (get_my_role() IN ('finance','founder','admin'))
  WITH CHECK (get_my_role() IN ('finance','founder','admin'));

-- ============================================================================
-- Section 6: Reconciliation discrepancies
-- ============================================================================

CREATE TYPE reconciliation_entity_type AS ENUM (
  'project_totals','vendor_ap_total','customer_ar_total','cash_balance'
);

CREATE TYPE reconciliation_status AS ENUM (
  'open','acknowledged','resolved','accepted_drift'
);

CREATE TABLE reconciliation_discrepancies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      reconciliation_entity_type NOT NULL,
  entity_ref       TEXT NOT NULL,
  metric           TEXT NOT NULL,
  erp_value        NUMERIC(14,2) NOT NULL,
  zoho_value       NUMERIC(14,2) NOT NULL,
  difference       NUMERIC(14,2) GENERATED ALWAYS AS (erp_value - zoho_value) STORED,
  status           reconciliation_status NOT NULL DEFAULT 'open',
  discovered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES employees(id),
  resolution_notes TEXT
);

-- One row per entity/metric/day
CREATE UNIQUE INDEX uq_reconciliation_daily
  ON reconciliation_discrepancies (entity_type, entity_ref, metric, (DATE(discovered_at)));

CREATE INDEX idx_reconciliation_open ON reconciliation_discrepancies(discovered_at) WHERE status = 'open';

ALTER TABLE reconciliation_discrepancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_all ON reconciliation_discrepancies
  FOR ALL USING (get_my_role() IN ('finance','founder','admin'))
  WITH CHECK (get_my_role() IN ('finance','founder','admin'));

COMMIT;
```

- [ ] **Step 2: Apply migration via MCP (same pattern as Task 1)**

- [ ] **Step 3: Regenerate types, run `pnpm check-types`**

- [ ] **Step 4: Commit + push**

```bash
git add supabase/migrations/068_finance_v2_zoho_lookups.sql packages/types/database.ts
git commit -m "feat(db): migration 068 — Zoho lookup + reconciliation tables"
git push origin main
```

---

### Task 3: Migration 069 — sync enqueue triggers

**Files:**
- Create: `supabase/migrations/069_finance_v2_sync_triggers.sql`

- [ ] **Step 1: Write migration 069**

```sql
-- Migration 069: ERP → Zoho sync enqueue triggers
-- See spec §5.3.
--
-- Strategy: one AFTER INSERT OR UPDATE trigger per synced table. Skip enqueue
-- when source='zoho_import' (imported from Zoho, already there) or when the
-- UPDATE only touched the zoho_*_id / updated_at columns (avoid ping-pong
-- from the sync worker stamping the zoho id back).

BEGIN;

CREATE OR REPLACE FUNCTION enqueue_zoho_sync(
  p_entity_type zoho_sync_entity_type,
  p_entity_id   UUID,
  p_action      zoho_sync_action
) RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO zoho_sync_queue (entity_type, entity_id, action, status)
  VALUES (p_entity_type, p_entity_id, p_action, 'pending')
  ON CONFLICT DO NOTHING;
$$;

-- ============================================================================
-- contacts
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_contact_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('contact', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' THEN
    -- ignore bookkeeping-only updates (zoho_contact_id / updated_at only)
    IF NEW.zoho_contact_id IS DISTINCT FROM OLD.zoho_contact_id
       AND NEW IS DISTINCT FROM OLD THEN
      -- zoho_contact_id changed AND other fields changed → treat as update
      IF OLD.zoho_contact_id IS NOT NULL THEN
        PERFORM enqueue_zoho_sync('contact', NEW.id, 'update');
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.zoho_contact_id IS NOT DISTINCT FROM OLD.zoho_contact_id
       AND (NEW.updated_at IS DISTINCT FROM OLD.updated_at
            OR NEW IS DISTINCT FROM OLD) THEN
      IF OLD.zoho_contact_id IS NOT NULL THEN
        PERFORM enqueue_zoho_sync('contact', NEW.id, 'update');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_sync_enqueue
  AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trg_enqueue_contact_sync();

-- ============================================================================
-- vendors (same pattern, parameterised per entity)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_vendor_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('vendor', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_vendor_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('vendor', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendors_sync_enqueue
  AFTER INSERT OR UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_vendor_sync();

-- ============================================================================
-- projects
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_project_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('project', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_project_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('project', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_sync_enqueue
  AFTER INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_project_sync();

-- ============================================================================
-- invoices
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_invoice_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN
    RETURN NEW; -- already in Zoho
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('invoice', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_invoice_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('invoice', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_sync_enqueue
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_invoice_sync();

-- ============================================================================
-- customer_payments
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_customer_payment_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('customer_payment', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_customer_payment_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('customer_payment', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER customer_payments_sync_enqueue
  AFTER INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_customer_payment_sync();

-- ============================================================================
-- purchase_orders
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_po_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('purchase_order', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_po_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('purchase_order', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_orders_sync_enqueue
  AFTER INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_po_sync();

-- ============================================================================
-- vendor_bills
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_bill_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('vendor_bill', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_bill_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('vendor_bill', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_bills_sync_enqueue
  AFTER INSERT OR UPDATE ON vendor_bills
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_bill_sync();

-- ============================================================================
-- vendor_payments
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_vendor_payment_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('vendor_payment', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_vendor_payment_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('vendor_payment', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendor_payments_sync_enqueue
  AFTER INSERT OR UPDATE ON vendor_payments
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_vendor_payment_sync();

-- ============================================================================
-- expenses (project-tagged only get synced; general expenses stay ERP-only)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enqueue_expense_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'zoho_import' THEN RETURN NEW; END IF;
  -- Skip general expenses: if there's no project, it's company-wide overhead
  -- and will already be present in Zoho via Zoho's salary/rent feeds.
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_zoho_sync('expense', NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.zoho_expense_id IS NOT NULL
    AND NEW IS DISTINCT FROM OLD THEN
    PERFORM enqueue_zoho_sync('expense', NEW.id, 'update');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER expenses_sync_enqueue
  AFTER INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_expense_sync();

COMMIT;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Regenerate types, `pnpm check-types`**

- [ ] **Step 4: Smoke-test the triggers**

Tool: `mcp__7a8c9855-...__execute_sql` on dev:

```sql
-- Insert a dummy vendor (roll it back) and verify an enqueue row appears.
BEGIN;
INSERT INTO vendors (company_name, vendor_type, is_active)
VALUES ('__trigger_test__', 'other', true)
RETURNING id \gset
SELECT COUNT(*) FROM zoho_sync_queue WHERE entity_id = :'id';  -- expect 1
ROLLBACK;
```

Expected: exactly 1 row in `zoho_sync_queue` for the test vendor.

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/069_finance_v2_sync_triggers.sql packages/types/database.ts
git commit -m "feat(db): migration 069 — ERP→Zoho sync enqueue triggers"
git push origin main
```

---

### Task 4: Migration 070 — bill payment cascade trigger

**Files:**
- Create: `supabase/migrations/070_finance_v2_bill_payment_cascade.sql`

- [ ] **Step 1: Write migration 070**

```sql
-- Migration 070: vendor_payments → vendor_bills cascade
-- Recalculate vendor_bills.amount_paid and .status whenever a payment is
-- inserted, updated, or deleted.
BEGIN;

CREATE OR REPLACE FUNCTION recalc_vendor_bill_totals(p_bill_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_paid   NUMERIC(14,2);
  v_total  NUMERIC(14,2);
  v_status vendor_bill_status;
BEGIN
  SELECT COALESCE(SUM(amount_paid), 0) INTO v_paid
  FROM vendor_payments WHERE vendor_bill_id = p_bill_id;

  SELECT total_amount INTO v_total FROM vendor_bills WHERE id = p_bill_id;
  IF v_total IS NULL THEN RETURN; END IF;  -- bill was deleted

  IF v_paid <= 0 THEN
    v_status := 'pending';
  ELSIF v_paid >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  UPDATE vendor_bills
  SET amount_paid = v_paid,
      status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE v_status END,
      updated_at = NOW()
  WHERE id = p_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_cascade_vendor_payment_to_bill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.vendor_bill_id IS NOT NULL THEN
      PERFORM recalc_vendor_bill_totals(OLD.vendor_bill_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.vendor_bill_id IS NOT NULL THEN
    PERFORM recalc_vendor_bill_totals(NEW.vendor_bill_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.vendor_bill_id IS DISTINCT FROM NEW.vendor_bill_id
    AND OLD.vendor_bill_id IS NOT NULL THEN
    PERFORM recalc_vendor_bill_totals(OLD.vendor_bill_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendor_payment_cascade_bill
  AFTER INSERT OR UPDATE OR DELETE ON vendor_payments
  FOR EACH ROW
  EXECUTE FUNCTION trg_cascade_vendor_payment_to_bill();

COMMIT;
```

- [ ] **Step 2: Apply + regenerate types + `pnpm check-types`**

- [ ] **Step 3: Commit + push**

```bash
git add supabase/migrations/070_finance_v2_bill_payment_cascade.sql packages/types/database.ts
git commit -m "feat(db): migration 070 — vendor payment → bill cascade trigger"
git push origin main
```

---

### Task 5: Migration 071 — RPCs (profitability_v2, cash_v2, msme_aging)

**Files:**
- Create: `supabase/migrations/071_finance_v2_rpcs.sql`

- [ ] **Step 1: Write migration 071**

```sql
-- Migration 071: Finance V2 RPCs
-- - get_project_profitability_v2 : per-project P&L including bills + expenses
-- - get_company_cash_summary_v2  : company cash + Zoho monthly subtraction
-- - get_msme_aging_summary       : bills bucketed by aging for dashboard strip
-- See spec §8.3, §8.4.

BEGIN;

-- ============================================================================
-- get_project_profitability_v2
-- ============================================================================

CREATE OR REPLACE FUNCTION get_project_profitability_v2(p_project_id UUID DEFAULT NULL)
RETURNS TABLE (
  project_id              UUID,
  project_number          TEXT,
  customer_name           TEXT,
  status                  TEXT,
  contracted_value        NUMERIC,
  total_invoiced          NUMERIC,
  total_received          NUMERIC,
  total_ar_outstanding    NUMERIC,
  total_billed            NUMERIC,
  total_vendor_paid       NUMERIC,
  total_ap_outstanding    NUMERIC,
  total_expenses          NUMERIC,
  total_expenses_paid     NUMERIC,
  total_cost              NUMERIC,
  margin_amount           NUMERIC,
  margin_pct              NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH base AS (
    SELECT p.id, p.project_number, p.customer_name, p.status, p.contracted_value
    FROM projects p
    WHERE p_project_id IS NULL OR p.id = p_project_id
  ),
  inv AS (
    SELECT project_id,
           COALESCE(SUM(total_amount), 0) AS invoiced,
           COALESCE(SUM(amount_paid), 0) AS received
    FROM invoices
    WHERE (p_project_id IS NULL OR project_id = p_project_id)
    GROUP BY project_id
  ),
  bill AS (
    SELECT project_id,
           COALESCE(SUM(total_amount), 0) AS billed,
           COALESCE(SUM(amount_paid), 0) AS bills_paid
    FROM vendor_bills
    WHERE status <> 'cancelled'
      AND (p_project_id IS NULL OR project_id = p_project_id)
    GROUP BY project_id
  ),
  exp AS (
    SELECT project_id,
           COALESCE(SUM(amount), 0) AS expenses,
           COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS expenses_paid
    FROM expenses
    WHERE project_id IS NOT NULL
      AND (p_project_id IS NULL OR project_id = p_project_id)
    GROUP BY project_id
  )
  SELECT
    b.id,
    b.project_number,
    b.customer_name,
    b.status,
    COALESCE(b.contracted_value, 0),
    COALESCE(inv.invoiced, 0),
    COALESCE(inv.received, 0),
    COALESCE(inv.invoiced, 0) - COALESCE(inv.received, 0),
    COALESCE(bill.billed, 0),
    COALESCE(bill.bills_paid, 0),
    COALESCE(bill.billed, 0) - COALESCE(bill.bills_paid, 0),
    COALESCE(exp.expenses, 0),
    COALESCE(exp.expenses_paid, 0),
    COALESCE(bill.billed, 0) + COALESCE(exp.expenses, 0),
    COALESCE(b.contracted_value, 0) - (COALESCE(bill.billed, 0) + COALESCE(exp.expenses, 0)),
    CASE WHEN COALESCE(b.contracted_value, 0) > 0
      THEN ROUND(
        ((COALESCE(b.contracted_value, 0) - (COALESCE(bill.billed, 0) + COALESCE(exp.expenses, 0)))
          / b.contracted_value) * 100, 2)
      ELSE 0 END
  FROM base b
  LEFT JOIN inv  ON inv.project_id = b.id
  LEFT JOIN bill ON bill.project_id = b.id
  LEFT JOIN exp  ON exp.project_id = b.id
  ORDER BY b.project_number DESC;
$$;

-- ============================================================================
-- get_company_cash_summary_v2
-- Extends v1 by including vendor bills and Zoho monthly expense subtractions.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_company_cash_summary_v2()
RETURNS TABLE(
  total_receivables             NUMERIC,
  total_ap_bills                NUMERIC,
  total_ap_pos                  NUMERIC,
  total_project_expenses_paid   NUMERIC,
  zoho_monthly_company_expenses NUMERIC,
  open_reconciliation_count     BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE((SELECT SUM(total_amount - amount_paid) FROM invoices), 0),
    COALESCE((SELECT SUM(balance_due) FROM vendor_bills WHERE status <> 'cancelled'), 0),
    COALESCE((SELECT SUM(amount_outstanding) FROM purchase_orders WHERE status NOT IN ('cancelled','draft')), 0),
    COALESCE((SELECT SUM(amount) FROM expenses WHERE status = 'approved' AND project_id IS NOT NULL), 0),
    COALESCE((
      SELECT SUM(debit_total - credit_total)
      FROM zoho_monthly_summary m
      JOIN zoho_account_codes a ON a.account_id = m.account_id
      WHERE a.account_type IN ('Expense','Other Expense')
        AND (m.year, m.month) = (EXTRACT(YEAR FROM NOW() - INTERVAL '1 month')::INT,
                                 EXTRACT(MONTH FROM NOW() - INTERVAL '1 month')::INT)
    ), 0),
    (SELECT COUNT(*) FROM reconciliation_discrepancies WHERE status = 'open');
$$;

-- ============================================================================
-- get_msme_aging_summary — bill-based (replaces PO-delivery-based)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_msme_aging_summary()
RETURNS TABLE(
  bucket       TEXT,
  bill_count   BIGINT,
  total_amount NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH aging AS (
    SELECT
      b.id,
      b.balance_due,
      CURRENT_DATE - b.bill_date AS days_old
    FROM vendor_bills b
    JOIN vendors v ON v.id = b.vendor_id
    WHERE v.is_msme = true
      AND b.status NOT IN ('paid','cancelled')
  )
  SELECT bucket, COUNT(*)::BIGINT, COALESCE(SUM(balance_due), 0)
  FROM (
    SELECT
      CASE
        WHEN days_old <= 30 THEN '0-30'
        WHEN days_old <= 40 THEN '31-40'
        WHEN days_old <= 45 THEN '41-45'
        ELSE 'overdue'
      END AS bucket,
      balance_due
    FROM aging
  ) x
  GROUP BY bucket
  ORDER BY CASE bucket
    WHEN '0-30' THEN 1
    WHEN '31-40' THEN 2
    WHEN '41-45' THEN 3
    WHEN 'overdue' THEN 4
  END;
$$;

COMMIT;
```

- [ ] **Step 2: Apply + regenerate types + `pnpm check-types`**

- [ ] **Step 3: Smoke-test the RPCs**

```sql
SELECT * FROM get_project_profitability_v2() LIMIT 5;
SELECT * FROM get_company_cash_summary_v2();
SELECT * FROM get_msme_aging_summary();
```

All three should return results (possibly empty sets) without errors.

- [ ] **Step 4: Commit + push**

```bash
git add supabase/migrations/071_finance_v2_rpcs.sql packages/types/database.ts
git commit -m "feat(db): migration 071 — profitability_v2 + cash_v2 + msme_aging RPCs"
git push origin main
```

---

## Phase B — Historical Import

Location: `scripts/zoho-import/`. Uses dev Supabase admin client via `SUPABASE_SECRET_KEY` to bypass RLS on backfill.

### Task 6: Import scaffolding + shared utilities

**Files:**
- Create: `scripts/zoho-import/index.ts`
- Create: `scripts/zoho-import/parse-xls.ts`
- Create: `scripts/zoho-import/normalize.ts`
- Create: `scripts/zoho-import/supabase.ts`
- Create: `scripts/zoho-import/logger.ts`
- Create: `scripts/zoho-import/README.md`

- [ ] **Step 1: Write `supabase.ts` — dev admin client factory**

```typescript
// scripts/zoho-import/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../packages/types/database';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY required in .env.local');
}

export const admin = createClient<Database>(url, key, {
  auth: { persistSession: false },
});

/**
 * Look up Vivek's employee row — used as the `created_by` / `raised_by` /
 * `prepared_by` / `recorded_by` / `submitted_by` for every imported entity
 * (Zoho has no notion of ERP employees; traceability is via `source = 'zoho_import'`).
 * Cached after first call.
 */
let _systemEmployeeId: string | null = null;
export async function getSystemEmployeeId(): Promise<string> {
  if (_systemEmployeeId) return _systemEmployeeId;
  const { data, error } = await admin
    .from('employees')
    .select('id')
    .eq('email', 'svivek.88@gmail.com')
    .single();
  if (error || !data) throw new Error('Founder employee row not found — seed it before importing');
  _systemEmployeeId = data.id;
  return _systemEmployeeId;
}
```

- [ ] **Step 2: Write `parse-xls.ts`**

```typescript
// scripts/zoho-import/parse-xls.ts
import * as XLSX from 'xlsx';
import * as path from 'path';

export const ZOHO_DIR = path.resolve(__dirname, '../../docs/Zoho data');

export function loadSheet<T extends Record<string, unknown>>(fileName: string): T[] {
  const fullPath = path.join(ZOHO_DIR, fileName);
  const wb = XLSX.readFile(fullPath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: null });
}

export function toNumber(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function toDateISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Zoho exports sometimes use "DD MMM YYYY" or "YYYY-MM-DD"
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

export function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
```

- [ ] **Step 3: Write `normalize.ts`**

```typescript
// scripts/zoho-import/normalize.ts
// Canonicalize names for fuzzy matching.
const SUFFIXES = [
  'pvt ltd', 'pvt. ltd', 'private limited', 'private ltd',
  'p ltd', 'p. ltd', 'llp', 'ltd', 'inc', 'co',
];

export function normalizeName(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[.,()\/\-_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  for (const sfx of SUFFIXES) {
    s = s.replace(new RegExp(`\\b${sfx}\\b`, 'g'), '');
  }
  // Strip sizing suffixes like "- 10kW", "10 kWp", "10kw"
  s = s.replace(/[-\s]+\d+(\.\d+)?\s*k\s*w\s*p?\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function tokens(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(t => t.length >= 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter(t => b.has(t)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : inter.size / union.size;
}

export function extractKwp(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*k\s*w\s*p?\b/i);
  return m ? Number(m[1]) : null;
}

/** Days between two YYYY-MM-DD dates (b - a). Null input → null. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

/** Map Zoho payment Mode → ERP payment_method enum. Falls back to 'bank_transfer'. */
export function mapPaymentMode(mode: unknown): 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd' {
  const m = String(mode ?? '').toLowerCase().trim();
  if (!m) return 'bank_transfer';
  if (m.includes('upi') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) return 'upi';
  if (m.includes('cheque') || m.includes('check')) return 'cheque';
  if (m.includes('cash')) return 'cash';
  if (m === 'dd' || m.includes('demand draft')) return 'dd';
  // NEFT, RTGS, Wire, Bank Transfer, IMPS, etc.
  return 'bank_transfer';
}
```

- [ ] **Step 4: Write `logger.ts`**

```typescript
// scripts/zoho-import/logger.ts
export interface PhaseResult {
  phase: string;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

export function emptyResult(phase: string): PhaseResult {
  return { phase, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
}

export function reportResult(r: PhaseResult): void {
  console.log(`\n[${r.phase}] inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped} failed=${r.failed}`);
  if (r.errors.length > 0) {
    console.log(`  first 5 errors:`);
    for (const e of r.errors.slice(0, 5)) {
      console.log(`    row ${e.row}: ${e.reason}`);
    }
  }
}
```

- [ ] **Step 5: Write `index.ts` orchestrator**

```typescript
// scripts/zoho-import/index.ts
// Usage: npx tsx scripts/zoho-import/index.ts [--phase=<name>] [--dry-run]

import { reportResult } from './logger';
import { runPhase01 } from './phase-01-accounts';
import { runPhase02 } from './phase-02-taxes';
import { runPhase03 } from './phase-03-items';
import { runPhase04 } from './phase-04-contacts';
import { runPhase05 } from './phase-05-vendors';
import { runPhase06 } from './phase-06-projects';
import { runPhase07 } from './phase-07-pos';
import { runPhase08 } from './phase-08-invoices';
import { runPhase09 } from './phase-09-customer-payments';
import { runPhase10 } from './phase-10-bills';
import { runPhase11 } from './phase-11-vendor-payments';
import { runPhase12 } from './phase-12-expenses';
import { runPhase13 } from './phase-13-credit-notes';
import { runReconcile } from './reconcile';

const PHASES = {
  '01': runPhase01, '02': runPhase02, '03': runPhase03,
  '04': runPhase04, '05': runPhase05, '06': runPhase06,
  '07': runPhase07, '08': runPhase08, '09': runPhase09,
  '10': runPhase10, '11': runPhase11, '12': runPhase12,
  '13': runPhase13, 'reconcile': runReconcile,
} as const;

async function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.find(a => a.startsWith('--phase='))?.split('=')[1] ?? 'all';
  const dryRun = args.includes('--dry-run');
  if (dryRun) process.env.ZOHO_IMPORT_DRY_RUN = '1';

  const order = Object.keys(PHASES) as Array<keyof typeof PHASES>;
  const toRun = phaseArg === 'all' ? order : [phaseArg as keyof typeof PHASES];

  for (const name of toRun) {
    const fn = PHASES[name];
    if (!fn) { console.error(`Unknown phase: ${name}`); process.exit(1); }
    console.log(`\n===== Phase ${name} =====`);
    const result = await fn();
    reportResult(result);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: README stub**

```markdown
# Zoho Import

One-time backfill of 3 years of Zoho Books data into the Shiroi ERP. See
`docs/superpowers/specs/2026-04-17-finance-module-v2-zoho-design.md` §6.

## Usage

```bash
# dry run everything
npx tsx scripts/zoho-import/index.ts --phase=all --dry-run

# run phase 6 only (project matching)
npx tsx scripts/zoho-import/index.ts --phase=06

# run everything + reconcile
npx tsx scripts/zoho-import/index.ts --phase=all
```

Each phase reports `inserted / updated / skipped / failed`. Stop and investigate
on any failure count > 0 before continuing.
```

- [ ] **Step 7: Commit**

```bash
git add scripts/zoho-import/
git commit -m "feat(zoho-import): scaffolding + shared utilities"
git push origin main
```

---

### Task 7: Phase 1 — Chart of Accounts

**Files:**
- Create: `scripts/zoho-import/phase-01-accounts.ts`

- [ ] **Step 1: Write phase-01**

```typescript
// scripts/zoho-import/phase-01-accounts.ts
import { admin } from './supabase';
import { loadSheet, toStr } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoAccountRow {
  'Account ID': string | null;
  'Account Name': string | null;
  'Account Code': string | null;
  'Account Type': string | null;
  'Parent Account': string | null;
  'Is Active': string | null;
}

export async function runPhase01(): Promise<PhaseResult> {
  const result = emptyResult('01-accounts');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoAccountRow>('Chart_of_Accounts.xls');
  console.log(`  ${rows.length} accounts in Chart_of_Accounts.xls`);

  const batch = rows
    .filter(r => toStr(r['Account ID']))
    .map(r => ({
      account_id: String(r['Account ID']),
      account_name: toStr(r['Account Name']) ?? 'Unknown',
      account_code: toStr(r['Account Code']),
      account_type: toStr(r['Account Type']) ?? 'Other',
      parent_account: toStr(r['Parent Account']),
      is_active: String(r['Is Active'] ?? 'true').toLowerCase() !== 'false',
    }));

  if (dryRun) {
    console.log(`  DRY RUN: would upsert ${batch.length} accounts`);
    result.skipped = batch.length;
    return result;
  }

  const { error } = await admin
    .from('zoho_account_codes')
    .upsert(batch, { onConflict: 'account_id' });

  if (error) {
    console.error('  upsert failed', error);
    result.failed = batch.length;
    result.errors.push({ row: 0, reason: error.message });
  } else {
    result.inserted = batch.length;
  }
  return result;
}
```

- [ ] **Step 2: Run `npx tsx scripts/zoho-import/index.ts --phase=01 --dry-run`**

Expected: "would upsert N accounts". No error. N should be in the range 200-300 (per inspection, 264 rows).

- [ ] **Step 3: Run for real (no `--dry-run`)**

Verify via `execute_sql`:

```sql
SELECT account_type, COUNT(*) FROM zoho_account_codes GROUP BY account_type ORDER BY 2 DESC;
```

- [ ] **Step 4: Commit + push**

```bash
git add scripts/zoho-import/phase-01-accounts.ts
git commit -m "feat(zoho-import): phase 01 — Chart of Accounts"
git push origin main
```

---

### Task 8: Phase 2 — Tax codes

**Files:**
- Create: `scripts/zoho-import/phase-02-taxes.ts`

- [ ] **Step 1: Inspect `Tax.xls`**

Before writing the phase, dump headers with a one-off ts file:

```typescript
// scripts/zoho-import/peek-taxes.ts
import { loadSheet } from './parse-xls';
const rows = loadSheet('Tax.xls');
console.log('rows:', rows.length);
console.log('headers:', Object.keys(rows[0] ?? {}));
console.log('first 3 rows:', JSON.stringify(rows.slice(0, 3), null, 2));
```

Run `npx tsx scripts/zoho-import/peek-taxes.ts` and note column names. Common columns: `Tax ID`, `Tax Name`, `Tax Percentage`, `Tax Type`.

- [ ] **Step 2: Write phase-02**

```typescript
// scripts/zoho-import/phase-02-taxes.ts
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoTaxRow {
  'Tax ID': string | null;
  'Tax Name': string | null;
  'Tax Percentage': string | number | null;
  'Tax Type': string | null;
}

function deriveType(name: string): 'CGST' | 'SGST' | 'IGST' | 'CESS' | 'OTHER' {
  const u = name.toUpperCase();
  if (u.includes('CGST')) return 'CGST';
  if (u.includes('SGST')) return 'SGST';
  if (u.includes('IGST')) return 'IGST';
  if (u.includes('CESS')) return 'CESS';
  return 'OTHER';
}

export async function runPhase02(): Promise<PhaseResult> {
  const result = emptyResult('02-taxes');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoTaxRow>('Tax.xls');
  const batch = rows
    .filter(r => toStr(r['Tax ID']) && toStr(r['Tax Name']))
    .map(r => {
      const name = toStr(r['Tax Name'])!;
      return {
        tax_id: String(r['Tax ID']),
        tax_name: name,
        tax_percentage: toNumber(r['Tax Percentage']),
        tax_type: deriveType(toStr(r['Tax Type']) ?? name),
        is_active: true,
      };
    });

  console.log(`  ${batch.length} tax codes`);
  if (dryRun) { result.skipped = batch.length; return result; }

  const { error } = await admin.from('zoho_tax_codes').upsert(batch, { onConflict: 'tax_id' });
  if (error) {
    result.failed = batch.length;
    result.errors.push({ row: 0, reason: error.message });
  } else {
    result.inserted = batch.length;
  }
  return result;
}
```

- [ ] **Step 3: Dry-run then real run**

```bash
npx tsx scripts/zoho-import/index.ts --phase=02 --dry-run
npx tsx scripts/zoho-import/index.ts --phase=02
```

Expected: 5-20 tax rows in dev.

- [ ] **Step 4: Commit + push**

```bash
git add scripts/zoho-import/phase-02-taxes.ts
git commit -m "feat(zoho-import): phase 02 — tax codes"
git push origin main
```

---

### Task 9: Phase 3 — Items

**Files:**
- Create: `scripts/zoho-import/phase-03-items.ts`

- [ ] **Step 1: Inspect `Item.xls` headers**

```typescript
// scripts/zoho-import/peek-items.ts
import { loadSheet } from './parse-xls';
const rows = loadSheet('Item.xls');
console.log('rows:', rows.length);
console.log('headers:', Object.keys(rows[0] ?? {}));
```

Key headers expected: `Item ID`, `Item Name`, `SKU`, `HSN/SAC`, `Rate`, `Purchase Rate`, `Sales Account`, `Purchase Account`, `Intra State Tax ID`, `Inter State Tax ID`, `Status`.

- [ ] **Step 2: Write phase-03**

```typescript
// scripts/zoho-import/phase-03-items.ts
import { admin } from './supabase';
import { loadSheet, toStr, toNumber } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoItemRow {
  'Item ID': string | null;
  'Item Name': string | null;
  SKU: string | null;
  'HSN/SAC': string | null;
  Rate: string | number | null;
  'Purchase Rate': string | number | null;
  'Sales Account': string | null;
  'Purchase Account': string | null;
  'Intra State Tax ID': string | null;
  'Inter State Tax ID': string | null;
  Status: string | null;
}

export async function runPhase03(): Promise<PhaseResult> {
  const result = emptyResult('03-items');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoItemRow>('Item.xls');
  // Only include tax IDs we already have (FK to zoho_tax_codes)
  const { data: existingTaxes } = await admin.from('zoho_tax_codes').select('tax_id');
  const taxSet = new Set((existingTaxes ?? []).map(r => r.tax_id));

  const batch = rows
    .filter(r => toStr(r['Item ID']) && toStr(r['Item Name']))
    .map(r => ({
      zoho_item_id: String(r['Item ID']),
      item_name: toStr(r['Item Name'])!,
      sku: toStr(r.SKU),
      hsn_code: toStr(r['HSN/SAC']),
      rate: toNumber(r.Rate, 0),
      purchase_rate: toNumber(r['Purchase Rate'], 0),
      sales_account: toStr(r['Sales Account']),
      purchase_account: toStr(r['Purchase Account']),
      intra_state_tax_id: taxSet.has(toStr(r['Intra State Tax ID']) ?? '') ? toStr(r['Intra State Tax ID']) : null,
      inter_state_tax_id: taxSet.has(toStr(r['Inter State Tax ID']) ?? '') ? toStr(r['Inter State Tax ID']) : null,
      is_active: String(r.Status ?? '').toLowerCase() !== 'inactive',
    }));

  console.log(`  ${batch.length} items`);
  if (dryRun) { result.skipped = batch.length; return result; }

  // Chunk upsert in batches of 500
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    const { error } = await admin.from('zoho_items').upsert(chunk, { onConflict: 'zoho_item_id' });
    if (error) {
      result.failed += chunk.length;
      result.errors.push({ row: i, reason: error.message });
    } else {
      result.inserted += chunk.length;
    }
  }
  return result;
}
```

- [ ] **Step 3: Dry-run + real run**

Expected: 945 items inserted.

- [ ] **Step 4: Commit + push**

---

### Task 10: Phase 4 — Contacts (customers)

**Files:**
- Create: `scripts/zoho-import/phase-04-contacts.ts`

- [ ] **Step 1: Inspect `Contacts.xls`**

Key headers: `Contact ID`, `Display Name`, `Company Name`, `GST No`, `Phone`, `Email`, `Billing Address`, `Billing City`, `Billing State`.

- [ ] **Step 2: Write phase-04 with dedupe logic**

```typescript
// scripts/zoho-import/phase-04-contacts.ts
import { admin } from './supabase';
import { loadSheet, toStr } from './parse-xls';
import { normalizeName, tokens, jaccard } from './normalize';
import { emptyResult, PhaseResult } from './logger';

interface ZohoContactRow {
  'Contact ID': string | null;
  'Display Name': string | null;
  'Company Name': string | null;
  'GST No': string | null;
  Phone: string | null;
  Mobile: string | null;
  EmailID: string | null;
  'Billing Address': string | null;
  'Billing City': string | null;
  'Billing State': string | null;
}

export async function runPhase04(): Promise<PhaseResult> {
  const result = emptyResult('04-contacts');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const rows = loadSheet<ZohoContactRow>('Contacts.xls');

  // Fetch existing ERP contacts for dedupe
  const { data: existing } = await admin
    .from('contacts')
    .select('id, company_name, gstin, phone, zoho_contact_id');
  const existingByGstin = new Map<string, string>(); // gstin → id
  const existingByName = new Map<string, string>();  // normalized → id
  const existingWithZoho = new Set<string>();        // zoho_contact_id already set
  for (const c of existing ?? []) {
    if (c.gstin) existingByGstin.set(c.gstin.toUpperCase(), c.id);
    if (c.company_name) existingByName.set(normalizeName(c.company_name), c.id);
    if (c.zoho_contact_id) existingWithZoho.add(c.zoho_contact_id);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  const toLink: Array<{ id: string; zoho_contact_id: string }> = [];

  for (const r of rows) {
    const zohoId = toStr(r['Contact ID']);
    if (!zohoId || existingWithZoho.has(zohoId)) continue;

    const name = toStr(r['Company Name']) ?? toStr(r['Display Name']);
    if (!name) { result.skipped += 1; continue; }

    const gstin = toStr(r['GST No'])?.toUpperCase() ?? null;

    // Dedupe: GSTIN exact → link
    if (gstin && existingByGstin.has(gstin)) {
      toLink.push({ id: existingByGstin.get(gstin)!, zoho_contact_id: zohoId });
      continue;
    }

    // Dedupe: normalized-name jaccard ≥0.85 → link (phone check tightens it)
    const normalized = normalizeName(name);
    let matchedId: string | null = null;
    if (existingByName.has(normalized)) {
      matchedId = existingByName.get(normalized)!;
    } else {
      // fuzzy top match
      const target = tokens(normalized);
      for (const [k, id] of existingByName) {
        if (jaccard(target, tokens(k)) >= 0.85) { matchedId = id; break; }
      }
    }
    if (matchedId) {
      toLink.push({ id: matchedId, zoho_contact_id: zohoId });
      continue;
    }

    // Otherwise create a new contacts row
    toInsert.push({
      company_name: name,
      display_name: toStr(r['Display Name']),
      gstin,
      phone: toStr(r.Mobile) ?? toStr(r.Phone),
      email: toStr(r.EmailID),
      billing_address: toStr(r['Billing Address']),
      city: toStr(r['Billing City']),
      state: toStr(r['Billing State']),
      zoho_contact_id: zohoId,
      source: 'zoho_import',
    });
  }

  console.log(`  to insert: ${toInsert.length}   to link: ${toLink.length}   skipped: ${result.skipped}`);
  if (dryRun) { result.skipped += toInsert.length + toLink.length; return result; }

  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error } = await admin.from('contacts').insert(chunk);
    if (error) { result.failed += chunk.length; result.errors.push({ row: i, reason: error.message }); }
    else { result.inserted += chunk.length; }
  }
  for (const lnk of toLink) {
    const { error } = await admin.from('contacts').update({ zoho_contact_id: lnk.zoho_contact_id }).eq('id', lnk.id);
    if (error) { result.failed += 1; result.errors.push({ row: 0, reason: error.message }); }
    else { result.updated += 1; }
  }
  return result;
}
```

> **Note:** `contacts` schema may not have `source`, `display_name`, `city`, `state` columns. Before running, verify via `list_tables` MCP; remove any missing column from the insert object. If `source` is missing on `contacts`, skip that field (imported contacts don't need re-sync traceability at the contact level; their `zoho_contact_id` already stamps origin).

- [ ] **Step 3: Dry-run + real run**

- [ ] **Step 4: Verify**

```sql
SELECT COUNT(*) FROM contacts WHERE zoho_contact_id IS NOT NULL;
```

- [ ] **Step 5: Commit + push**

---

### Task 11: Phase 5 — Vendors

**Files:**
- Create: `scripts/zoho-import/phase-05-vendors.ts`

- [ ] **Step 1: Inspect `Vendors.xls`**

Key extra columns beyond Contacts: `MSME/Udyam No`, `MSME Type`, `TDS`, `Payment Terms`, `Bank Account Number`, `IFSC`, `Bank Name`.

- [ ] **Step 2: Write phase-05**

Same pattern as phase-04 but targets `vendors` table. Populate:
- `udyam_number`, `udyam_type` from MSME/Udyam columns
- `is_msme = true` when Udyam number exists
- `payment_terms_days` parsed from "Net 45" → 45

Use the existing `vendors` schema columns — read `packages/types/database.ts` for the exact column set and only populate those.

```typescript
// Key logic:
const msmeNumber = toStr(r['MSME/Udyam No']);
const isMsme = msmeNumber !== null;

// Payment terms: "Net 30" → 30
const termsStr = toStr(r['Payment Terms']) ?? '';
const termsMatch = termsStr.match(/(\d+)/);
const paymentTermsDays = termsMatch ? Number(termsMatch[1]) : 30;
```

- [ ] **Step 3: Dry-run + real run**

- [ ] **Step 4: Verify MSME counts**

```sql
SELECT is_msme, COUNT(*) FROM vendors GROUP BY is_msme;
```

Expected: ~60-80 MSME vendors (based on Zoho data).

- [ ] **Step 5: Commit + push**

---

### Task 12: Phase 6a — match-engine.ts

**Files:**
- Create: `scripts/zoho-import/match-engine.ts`

- [ ] **Step 1: Write match-engine**

```typescript
// scripts/zoho-import/match-engine.ts
import { normalizeName, tokens, jaccard, extractKwp } from './normalize';

export interface ZohoProject {
  zohoId: string;
  zohoCode: string | null;
  projectName: string;
  customerName: string;
}

export interface ErpProject {
  id: string;
  projectNumber: string;
  customerName: string;
  systemSizeKwp: number | null;
  siteCity: string | null;
}

export interface MatchCandidate {
  erp: ErpProject;
  score: number;
  components: { jaccard: number; sizeBonus: number; cityBonus: number };
}

export function scoreMatch(z: ZohoProject, e: ErpProject): MatchCandidate {
  const zComb = normalizeName(`${z.projectName} ${z.customerName}`);
  const eComb = normalizeName(e.customerName);
  const jacc = jaccard(tokens(zComb), tokens(eComb));

  const zSize = extractKwp(z.projectName);
  const sizeBonus = zSize !== null && e.systemSizeKwp !== null
    && Math.abs(zSize - e.systemSizeKwp) < 0.5 ? 0.2 : 0;

  const cityBonus = e.siteCity
    && normalizeName(z.projectName).includes(normalizeName(e.siteCity)) ? 0.1 : 0;

  return {
    erp: e,
    score: jacc + sizeBonus + cityBonus,
    components: { jaccard: jacc, sizeBonus, cityBonus },
  };
}

export function topCandidates(z: ZohoProject, erps: ErpProject[], n = 3): MatchCandidate[] {
  return erps
    .map(e => scoreMatch(z, e))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
```

- [ ] **Step 2: Write a quick smoke test**

```typescript
// scripts/zoho-import/match-engine.test.ts  (ad-hoc, run via tsx)
import { scoreMatch } from './match-engine';

const z = { zohoId: 'z1', zohoCode: null, projectName: 'NEPPATHUR 10KW', customerName: 'MEGAGRID VOLTARES BHARAT PVT LTD' };
const e = { id: 'e1', projectNumber: 'X', customerName: 'MEGAGRID VOLTARES BHARAT', systemSizeKwp: 10, siteCity: 'Neppathur' };
console.log(scoreMatch(z, e));  // expect jaccard ~0.6-0.8 + 0.2 size + 0.1 city = ~1.0
```

Run `npx tsx scripts/zoho-import/match-engine.test.ts` and confirm score > 0.85.

- [ ] **Step 3: Commit + push**

---

### Task 13: Phase 6b — project matching + review queue

**Files:**
- Create: `scripts/zoho-import/phase-06-projects.ts`
- Create: `scripts/zoho-import/review-queue.ts`

- [ ] **Step 1: Write phase-06 (auto-match pass)**

```typescript
// scripts/zoho-import/phase-06-projects.ts
import * as fs from 'fs';
import * as path from 'path';
import { admin } from './supabase';
import { loadSheet, toStr } from './parse-xls';
import { scoreMatch, ZohoProject, ErpProject, topCandidates } from './match-engine';
import { emptyResult, PhaseResult } from './logger';

interface ZohoProjectRow {
  'Project ID': string | null;
  'Project Code': string | null;
  'Project Name': string | null;
  'Customer Name': string | null;
}

export async function runPhase06(): Promise<PhaseResult> {
  const result = emptyResult('06-projects');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const zohoRows = loadSheet<ZohoProjectRow>('Projects.xls');
  console.log(`  ${zohoRows.length} Zoho projects`);

  const { data: erpRows } = await admin
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, site_city');
  const erp: ErpProject[] = (erpRows ?? []).map(r => ({
    id: r.id, projectNumber: r.project_number,
    customerName: r.customer_name ?? '',
    systemSizeKwp: r.system_size_kwp as number | null,
    siteCity: (r as { site_city?: string | null }).site_city ?? null,
  }));
  console.log(`  ${erp.length} ERP projects`);

  // Fetch already-mapped rows to avoid re-doing them
  const { data: mapped } = await admin.from('zoho_project_mapping').select('zoho_project_id');
  const alreadyMapped = new Set((mapped ?? []).map(m => m.zoho_project_id));

  const autoMatched: Array<Record<string, unknown>> = [];
  const reviewQueue: Array<{ zoho: ZohoProject; candidates: ReturnType<typeof topCandidates> }> = [];
  const unmatched: ZohoProject[] = [];

  for (const r of zohoRows) {
    const zid = toStr(r['Project ID']);
    if (!zid || alreadyMapped.has(zid)) { result.skipped += 1; continue; }
    const z: ZohoProject = {
      zohoId: zid,
      zohoCode: toStr(r['Project Code']),
      projectName: toStr(r['Project Name']) ?? '',
      customerName: toStr(r['Customer Name']) ?? '',
    };
    const top = topCandidates(z, erp, 3);
    const best = top[0];
    if (!best) { unmatched.push(z); continue; }

    if (best.score >= 0.85) {
      autoMatched.push({
        zoho_project_id: z.zohoId,
        erp_project_id: best.erp.id,
        zoho_project_name: z.projectName,
        zoho_project_code: z.zohoCode,
        zoho_customer_name: z.customerName,
        match_confidence: Math.min(best.score, 1.3),
        match_method: 'auto_fuzzy',
      });
    } else if (best.score >= 0.5) {
      reviewQueue.push({ zoho: z, candidates: top });
    } else {
      unmatched.push(z);
    }
  }

  // Persist auto-matched
  console.log(`  auto-matched: ${autoMatched.length}   review: ${reviewQueue.length}   unmatched: ${unmatched.length}`);
  if (!dryRun && autoMatched.length > 0) {
    const { error } = await admin.from('zoho_project_mapping').insert(autoMatched);
    if (error) { result.failed += autoMatched.length; result.errors.push({ row: 0, reason: error.message }); }
    else { result.inserted += autoMatched.length; }
  }

  // Write review queue CSV
  const csv = ['zoho_id,zoho_code,zoho_name,zoho_customer,candidate1_id,candidate1_number,candidate1_score,candidate2_id,candidate2_number,candidate2_score,candidate3_id,candidate3_number,candidate3_score'];
  for (const { zoho, candidates } of reviewQueue) {
    const row = [
      zoho.zohoId,
      zoho.zohoCode ?? '',
      `"${zoho.projectName.replace(/"/g, '""')}"`,
      `"${zoho.customerName.replace(/"/g, '""')}"`,
    ];
    for (let i = 0; i < 3; i++) {
      const c = candidates[i];
      if (c) row.push(c.erp.id, c.erp.projectNumber, c.score.toFixed(3));
      else row.push('', '', '');
    }
    csv.push(row.join(','));
  }
  const csvPath = path.resolve(__dirname, '../../docs/Zoho data/review_queue.csv');
  fs.writeFileSync(csvPath, csv.join('\n'));
  console.log(`  wrote review queue to ${csvPath}`);

  // Write unmatched CSV
  const uCsv = ['zoho_id,zoho_code,zoho_name,zoho_customer'];
  for (const z of unmatched) {
    uCsv.push(`${z.zohoId},${z.zohoCode ?? ''},"${z.projectName.replace(/"/g, '""')}","${z.customerName.replace(/"/g, '""')}"`);
  }
  const uPath = path.resolve(__dirname, '../../docs/Zoho data/unmatched_projects.csv');
  fs.writeFileSync(uPath, uCsv.join('\n'));
  console.log(`  wrote unmatched list to ${uPath}`);

  return result;
}
```

- [ ] **Step 2: Write review-queue CLI (interactive prompt)**

```typescript
// scripts/zoho-import/review-queue.ts
// Interactive review of ambiguous project matches.
// Usage: npx tsx scripts/zoho-import/review-queue.ts
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { admin } from './supabase';

interface Row {
  zoho_id: string;
  zoho_code: string;
  zoho_name: string;
  zoho_customer: string;
  candidates: Array<{ id: string; projectNumber: string; score: string }>;
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split('\n').slice(1);
  return lines.map(line => {
    const parts = line.match(/("[^"]*"|[^,]*)(?:,|$)/g)!.map(p => p.replace(/,$/, '').replace(/^"(.*)"$/, '$1'));
    return {
      zoho_id: parts[0], zoho_code: parts[1], zoho_name: parts[2], zoho_customer: parts[3],
      candidates: [
        { id: parts[4], projectNumber: parts[5], score: parts[6] },
        { id: parts[7], projectNumber: parts[8], score: parts[9] },
        { id: parts[10], projectNumber: parts[11], score: parts[12] },
      ].filter(c => c.id),
    };
  });
}

async function main() {
  const csvPath = path.resolve(__dirname, '../../docs/Zoho data/review_queue.csv');
  if (!fs.existsSync(csvPath)) { console.log('No review queue. Run phase 6 first.'); process.exit(0); }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (q: string) => new Promise<string>(res => rl.question(q, res));

  let i = 0;
  for (const r of rows) {
    i += 1;
    console.log(`\n[${i}/${rows.length}] Zoho: "${r.zoho_name}" (customer: ${r.zoho_customer})`);
    r.candidates.forEach((c, idx) => {
      const letter = String.fromCharCode(97 + idx);
      console.log(`  (${letter}) ${c.projectNumber}   score=${c.score}`);
    });
    console.log('  (s) SKIP  (q) QUIT');
    const ans = (await prompt('Choice: ')).trim().toLowerCase();
    if (ans === 'q') break;
    if (ans === 's') continue;
    const idx = ans.charCodeAt(0) - 97;
    const pick = r.candidates[idx];
    if (!pick) { console.log('  invalid'); continue; }
    const { error } = await admin.from('zoho_project_mapping').insert({
      zoho_project_id: r.zoho_id,
      erp_project_id: pick.id,
      zoho_project_name: r.zoho_name,
      zoho_project_code: r.zoho_code || null,
      zoho_customer_name: r.zoho_customer,
      match_confidence: Number(pick.score),
      match_method: 'manual',
    });
    if (error) console.log(`  insert failed: ${error.message}`);
    else console.log(`  linked to ${pick.projectNumber}`);
  }
  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run phase 6 dry-run then real run**

```bash
npx tsx scripts/zoho-import/index.ts --phase=06 --dry-run
npx tsx scripts/zoho-import/index.ts --phase=06
```

Note the auto-matched vs review counts. Write the counts into a scratch note file and move on — the interactive review happens in the morning after Vivek looks at the CSVs.

- [ ] **Step 4: Commit + push**

```bash
git add scripts/zoho-import/match-engine.ts scripts/zoho-import/phase-06-projects.ts scripts/zoho-import/review-queue.ts
git commit -m "feat(zoho-import): phase 06 — project matching + review queue"
git push origin main
```

---

### Task 14: Phase 7 — Purchase Orders

**Files:**
- Create: `scripts/zoho-import/phase-07-pos.ts`

- [ ] **Step 1: Inspect `Purchase_Order.xls` headers**

Key columns: `Purchase Order ID`, `Purchase Order Number`, `Purchase Order Date`, `Expected Delivery Date`, `Vendor Name`, `Vendor GST Number`, `Project ID`, `Item Name`, `Item Description`, `HSN/SAC`, `Quantity`, `Rate`, `Item Tax`, `Item Tax Amount`, `Total`, `SubTotal`, `CGST`, `SGST`, `IGST`, `PurchaseOrder Status`.

Each row is one line item; group by `Purchase Order Number`.

- [ ] **Step 2: Write phase-07 with grouping**

```typescript
// scripts/zoho-import/phase-07-pos.ts
import { admin } from './supabase';
import { admin, getSystemEmployeeId } from './supabase';
import { loadSheet, toStr, toNumber, toDateISO } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

interface ZohoPORow {
  'Purchase Order ID': string | null;
  'Purchase Order Number': string | null;
  'Purchase Order Date': string | null;
  'Expected Delivery Date': string | null;
  'Vendor Name': string | null;
  'Vendor GST Number': string | null;
  'Project ID': string | null;
  'Item Name': string | null;
  'Item Description': string | null;
  'HSN/SAC': string | null;
  Quantity: string | number | null;
  Rate: string | number | null;
  'Item Tax': string | null;
  'Item Tax Amount': string | number | null;
  'Item Total': string | number | null;
  CGST: string | number | null;
  SGST: string | number | null;
  IGST: string | number | null;
  SubTotal: string | number | null;
  Total: string | number | null;
  'PurchaseOrder Status': string | null;
}

export async function runPhase07(): Promise<PhaseResult> {
  const result = emptyResult('07-pos');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';
  const SYSTEM_EMPLOYEE_ID = await getSystemEmployeeId();

  const rows = loadSheet<ZohoPORow>('Purchase_Order.xls');

  // Preload lookups
  const { data: vendors } = await admin.from('vendors').select('id, zoho_vendor_id, gstin, company_name');
  const vendorsByZoho = new Map<string, string>();
  const vendorsByGstin = new Map<string, string>();
  const vendorsByName = new Map<string, string>();
  for (const v of vendors ?? []) {
    if (v.zoho_vendor_id) vendorsByZoho.set(v.zoho_vendor_id, v.id);
    if (v.gstin) vendorsByGstin.set(v.gstin.toUpperCase(), v.id);
    if (v.company_name) vendorsByName.set(v.company_name.toLowerCase(), v.id);
  }

  const { data: projectMaps } = await admin.from('zoho_project_mapping').select('zoho_project_id, erp_project_id');
  const projByZoho = new Map((projectMaps ?? []).map(m => [m.zoho_project_id, m.erp_project_id]));

  // Group rows by Purchase Order Number
  type Grouped = { header: ZohoPORow; items: ZohoPORow[] };
  const groups = new Map<string, Grouped>();
  for (const r of rows) {
    const po = toStr(r['Purchase Order Number']);
    if (!po) continue;
    if (!groups.has(po)) groups.set(po, { header: r, items: [] });
    groups.get(po)!.items.push(r);
  }
  console.log(`  ${groups.size} POs   ${rows.length} line items`);

  // Existing POs to skip
  const { data: existing } = await admin.from('purchase_orders').select('zoho_po_id');
  const existingZoho = new Set((existing ?? []).map(r => r.zoho_po_id).filter(Boolean));

  for (const [poNum, grp] of groups) {
    if (grp.header['Purchase Order ID'] && existingZoho.has(String(grp.header['Purchase Order ID']))) {
      result.skipped += 1;
      continue;
    }

    const vendorGstin = toStr(grp.header['Vendor GST Number'])?.toUpperCase() ?? null;
    const vendorName = toStr(grp.header['Vendor Name'])?.toLowerCase() ?? '';
    const vendorId = (vendorGstin && vendorsByGstin.get(vendorGstin))
      ?? vendorsByName.get(vendorName);
    if (!vendorId) {
      result.skipped += 1;
      result.errors.push({ row: 0, reason: `vendor not found: ${vendorName}` });
      continue;
    }

    const projectId = grp.header['Project ID'] ? projByZoho.get(String(grp.header['Project ID'])) : null;
    if (!projectId) {
      // purchase_orders.project_id is NOT NULL — skip non-project POs.
      result.skipped += 1;
      result.errors.push({ row: 0, reason: `PO ${poNum}: no project mapping` });
      continue;
    }

    const statusRaw = toStr(grp.header['PurchaseOrder Status'])?.toLowerCase() ?? 'draft';
    const status = statusRaw.includes('closed') ? 'completed'
      : statusRaw.includes('cancelled') ? 'cancelled'
      : statusRaw.includes('issued') || statusRaw.includes('open') ? 'approved'
      : 'draft';

    const total = toNumber(grp.header.Total);
    const subtotal = toNumber(grp.header.SubTotal, total);

    if (dryRun) { result.skipped += 1; continue; }

    const { data: inserted, error } = await admin
      .from('purchase_orders')
      .insert({
        po_number: `ZHI/${poNum}`,  // prefix to avoid collision with ERP SHIROI/PO/... numbers
        vendor_id: vendorId,
        project_id: projectId,
        prepared_by: SYSTEM_EMPLOYEE_ID,  // NOT NULL FK
        po_date: toDateISO(grp.header['Purchase Order Date']),
        expected_delivery_date: toDateISO(grp.header['Expected Delivery Date']),
        status,
        subtotal,
        total_amount: total,
        source: 'zoho_import',
        zoho_po_id: String(grp.header['Purchase Order ID']),
      })
      .select('id')
      .single();

    if (error || !inserted) {
      result.failed += 1;
      result.errors.push({ row: 0, reason: `PO ${poNum}: ${error?.message}` });
      continue;
    }

    // Insert line items
    const itemRows = grp.items.map(it => ({
      purchase_order_id: inserted.id,
      item_name: toStr(it['Item Name']) ?? 'Item',
      description: toStr(it['Item Description']),
      hsn_code: toStr(it['HSN/SAC']),
      quantity: toNumber(it.Quantity, 1),
      rate: toNumber(it.Rate),
      cgst_amount: toNumber(it.CGST),
      sgst_amount: toNumber(it.SGST),
      igst_amount: toNumber(it.IGST),
      total_amount: toNumber(it['Item Total']),
    }));
    const { error: itemErr } = await admin.from('purchase_order_items').insert(itemRows);
    if (itemErr) {
      result.errors.push({ row: 0, reason: `PO ${poNum} items: ${itemErr.message}` });
    }
    result.inserted += 1;
  }
  return result;
}
```

> **Important:** The exact column names in `purchase_orders` and `purchase_order_items` must match the schema. Before writing, open `packages/types/database.ts` and copy the column names verbatim. If an ERP column name differs from above (e.g., `po_number` vs `order_number`), adjust the insert object. Run `pnpm check-types` after the file is written — TypeScript will surface any mismatch.

- [ ] **Step 3: Dry-run, inspect errors, fix, real run**

- [ ] **Step 4: Verify**

```sql
SELECT COUNT(*) FROM purchase_orders WHERE source = 'zoho_import';
```

- [ ] **Step 5: Commit + push**

---

### Task 15: Phase 8 — Customer Invoices

**Files:**
- Create: `scripts/zoho-import/phase-08-invoices.ts`

- [ ] **Step 1: Schema reality check**

The ERP `invoices` table (migration 004d) has these NOT NULL columns that need thought for import:
- `project_id` (NOT NULL, REFERENCES projects) → use Zoho `Project ID` → ERP project via `zoho_project_mapping`. If no mapping, skip row (log to errors).
- `raised_by` (NOT NULL, REFERENCES employees) → Vivek's employee_id (`SYSTEM_EMPLOYEE_ID` lookup).
- `invoice_number` (UNIQUE, NOT NULL) → **prefix Zoho number with `ZHI/`** to avoid colliding with ERP-format numbers like `SHIROI/INV/2025-26/0178`.
- `invoice_type` (CHECK in 'proforma','tax_invoice','credit_note') → `tax_invoice` for everything (Zoho invoices are final).
- `total_amount` (NOT NULL), `due_date` (NOT NULL).

`proposal_id` is nullable — leave NULL for imports (no proposal link).

> **Aggregation:** `Invoice.xls` has one row per line-item. Group rows by `Invoice ID`. Per group:
> - `subtotal_supply = SUM(Item Total)` across items
> - `subtotal_works = 0`
> - `gst_supply_amount = SUM(CGST + SGST + IGST)` across items
> - `gst_works_amount = 0`
> - `total_amount = first row's Total` (or SUM if needed — should match)
> - `amount_paid = Total - Balance`
> - `amount_outstanding = Balance`
>
> The supply-vs-works split is lossy for historical data. Acceptable — the split is only meaningful going forward.

Key Zoho columns: `Invoice ID`, `Invoice Number`, `Invoice Date`, `Due Date`, `Customer ID`, `Project ID`, `Item Name`, `Item Total`, `SubTotal`, `Total`, `Balance`, `Invoice Status`, `CGST`, `SGST`, `IGST`.

Map status: `draft` → `draft`, `sent`/`partially paid`/`overdue` → `sent`, `paid` → `paid`, `void` → `cancelled`.

- [ ] **Step 2: Write, dry-run, real run**

- [ ] **Step 3: Verify**

```sql
SELECT COUNT(*) FROM invoices WHERE source = 'zoho_import';
SELECT status, COUNT(*) FROM invoices WHERE source = 'zoho_import' GROUP BY status;
```

- [ ] **Step 4: Commit + push**

---

### Task 16: Phase 9 — Customer Payments

**Files:**
- Create: `scripts/zoho-import/phase-09-customer-payments.ts`

- [ ] **Step 1: Write phase 9**

Each row is a payment applied to one or more invoices. Group by `CustomerPayment ID`; the rows within a group each have an `Invoice Number` they're applied to.

> **Schema reality check:** `customer_payments` has these NOT NULL columns:
> - `project_id` (NOT NULL) — derive from the applied invoice's `project_id`
> - `invoice_id` (nullable, but we set it)
> - `recorded_by` (NOT NULL) — set to Vivek's employee_id (same lookup as phase-12)
> - `receipt_number` (UNIQUE, NOT NULL) — prefix Zoho's Payment Number with `ZHI/` to avoid collision
> - `amount` (NOT NULL) — Zoho `Amount Applied`
> - `payment_date` (NOT NULL)
> - `payment_method` — CHECK IN ('bank_transfer','upi','cheque','cash','dd'). Map Zoho `Mode`: any of "Bank Transfer"/"NEFT"/"RTGS"/"Wire" → `bank_transfer`; "UPI"/"GPay"/"PhonePe" → `upi`; "Cheque" → `cheque`; "Cash" → `cash`; "DD" → `dd`; anything else → `bank_transfer` (default).

Pattern — **one `customer_payments` row per applied invoice** (since `customer_payments` has `invoice_id` not a join table):

```typescript
// For each applied-invoice row within the payment group
for (const app of grp.items) {
  const invoice = invoicesByZoho.get(String(app['Invoice ID']));
  if (!invoice) continue;  // orphaned — skip

  const receiptNumber = `ZHI/${grp.header['Payment Number']}/${app['Invoice ID']}`;  // unique per (payment, invoice)

  await admin.from('customer_payments').insert({
    project_id: invoice.project_id,
    invoice_id: invoice.id,
    recorded_by: SYSTEM_EMPLOYEE_ID,
    receipt_number: receiptNumber,
    amount: toNumber(app['Amount Applied']),
    payment_date: toDateISO(grp.header['Date']),
    payment_method: mapPaymentMode(grp.header['Mode']),
    payment_reference: grp.header['Reference Number'] ?? null,
    source: 'zoho_import',
    zoho_customer_payment_id: String(grp.header['CustomerPayment ID']),
  });

  // Update invoices.amount_paid
  await admin.from('invoices')
    .update({ amount_paid: invoice.amount_paid + toNumber(app['Amount Applied']) })
    .eq('id', invoice.id);
}
```

`invoicesByZoho` should map `zoho_invoice_id` → `{ id, project_id, amount_paid }`. Load once at phase start.

- [ ] **Step 2: Dry-run + real run**

- [ ] **Step 3: Verify AR totals**

```sql
SELECT SUM(total_amount - amount_paid) AS outstanding FROM invoices WHERE source = 'zoho_import';
```

- [ ] **Step 4: Commit + push**

---

### Task 17: Phase 10 — Vendor Bills

**Files:**
- Create: `scripts/zoho-import/phase-10-bills.ts`

- [ ] **Step 1: Write phase 10 — same structure as phase-07**

Bill rows in `Bill.xls`. Group by `Bill ID`. Key columns: `Bill ID`, `Bill Number`, `Bill Date`, `Due Date`, `Vendor ID`, `Project ID`, `Purchase Order Number` (link back to PO).

Map status:
- `open` / `partially paid` → `pending` / `partially_paid`
- `paid` → `paid`
- `void` → `cancelled`

Header insert into `vendor_bills`:
```typescript
{
  bill_number: `ZHI/${grp.header['Bill Number']}`,  // prefix to avoid collision with ERP bill numbers
  bill_date: toDateISO(grp.header['Bill Date']),
  due_date: toDateISO(grp.header['Due Date']) ?? null,
  vendor_id: vendorsByZoho.get(String(grp.header['Vendor ID'])),
  purchase_order_id: po_id_lookup ?? null,       // nullable — Zoho bills often have no PO
  project_id: projByZoho.get(String(grp.header['Project ID'])) ?? null,  // nullable — non-project bills
  subtotal: toNumber(grp.header['SubTotal']),
  cgst_amount: total_cgst,
  sgst_amount: total_sgst,
  igst_amount: total_igst,
  tds_amount: toNumber(grp.header['TDS Amount']) ?? 0,
  total_amount: toNumber(grp.header['Total']),
  amount_paid: toNumber(grp.header['Total']) - toNumber(grp.header['Balance']),
  status: mapStatus(grp.header['Bill Status']),
  source: 'zoho_import',
  zoho_bill_id: String(grp.header['Bill ID']),
  created_by: SYSTEM_EMPLOYEE_ID,
}
```

Items into `vendor_bill_items` — one insert per line row (use the same grp.items array):
```typescript
await admin.from('vendor_bill_items').insert(grp.items.map(it => ({
  vendor_bill_id: billId,
  item_name: toStr(it['Item Name']) ?? toStr(it['Description']) ?? 'Imported from Zoho',
  description: toStr(it['Description']),
  hsn_code: toStr(it['HSN/SAC']),
  quantity: toNumber(it['Quantity']) ?? 1,
  rate: toNumber(it['Rate']) ?? 0,
  taxable_amount: toNumber(it['Item Total']) ?? 0,
  cgst_rate_pct: toNumber(it['CGST Rate (%)']) ?? 0,
  sgst_rate_pct: toNumber(it['SGST Rate (%)']) ?? 0,
  igst_rate_pct: toNumber(it['IGST Rate (%)']) ?? 0,
  cgst_amount: toNumber(it['CGST']) ?? 0,
  sgst_amount: toNumber(it['SGST']) ?? 0,
  igst_amount: toNumber(it['IGST']) ?? 0,
  total_amount: toNumber(it['Item Total']) ?? 0,
  zoho_account_code: toStr(it['Account']),
})));
```

**Skip bills without a `vendor_id`** (log to errors with reason `'unknown vendor'`). Skip duplicates by checking `zoho_bill_id` already imported.

- [ ] **Step 2: Dry-run + real run**

- [ ] **Step 3: Verify counts — should be ~2,000 bills**

```sql
SELECT status, COUNT(*), SUM(total_amount)::NUMERIC(14,2) AS total
FROM vendor_bills WHERE source = 'zoho_import'
GROUP BY status ORDER BY 2 DESC;
```

- [ ] **Step 4: Commit + push**

---

### Task 18: Phase 11 — Vendor Payments

**Files:**
- Create: `scripts/zoho-import/phase-11-vendor-payments.ts`

- [ ] **Step 1: Schema reality check**

`vendor_payments` has these NOT NULL columns:
- `vendor_id`, `project_id`, `recorded_by`, `amount`, `payment_date`, `payment_method`, `msme_compliant` (default TRUE)
- `purchase_order_id` — **now nullable** after migration 067's DROP NOT NULL
- `po_date`, `days_from_po` — **now nullable** after migration 067

The CHECK constraint `vendor_payments_has_link` requires `purchase_order_id IS NOT NULL OR vendor_bill_id IS NOT NULL` — Zoho bill-centric payments satisfy the second condition.

Map `payment_method` same way as phase-09 (`mapPaymentMode`).

- [ ] **Step 2: Write phase 11 — one row per (payment, applied-bill)**

Group Zoho rows by payment ID. Each row represents money applied to one bill.

```typescript
for (const grp of grouped) {
  for (const app of grp.items) {  // each applied bill
    const bill = billsByZoho.get(String(app['Bill ID']));
    if (!bill) continue;  // orphan — skip

    await admin.from('vendor_payments').insert({
      vendor_id: bill.vendor_id,
      project_id: bill.project_id ?? FALLBACK_PROJECT_ID,  // see below
      recorded_by: SYSTEM_EMPLOYEE_ID,
      purchase_order_id: null,
      vendor_bill_id: bill.id,
      amount: toNumber(app['Amount Applied']),
      payment_date: toDateISO(grp.header['Date']),
      payment_method: mapPaymentMode(grp.header['Mode']),
      payment_reference: toStr(grp.header['Reference Number']) ?? null,
      po_date: null,
      days_from_po: null,
      days_from_bill: daysBetween(bill.bill_date, toDateISO(grp.header['Date'])),
      msme_compliant: daysBetween(bill.bill_date, toDateISO(grp.header['Date'])) <= 45,
      source: 'zoho_import',
      zoho_vendor_payment_id: String(grp.header['Payment ID']),
    });
  }
}
```

> **Fallback project issue:** `vendor_payments.project_id` is NOT NULL. If a bill's `project_id` is NULL (non-project bill from Zoho), we cannot insert the payment. Options: (a) skip it (log), or (b) use a `PROJECT_ID` fallback placeholder.
>
> **Decision:** use option (a) — skip. Non-project payments are not operationally important for Shiroi's ERP (they're admin/OpEx). Log to errors with reason `'bill has no project'`.

`billsByZoho` should map `zoho_bill_id` → `{ id, vendor_id, project_id, bill_date }`. Load at phase start.

Before the loop: `const SYSTEM_EMPLOYEE_ID = await getSystemEmployeeId();` (helper in `supabase.ts` from Task 6).

Also guard: skip when `!bill.project_id` (non-project bills). `vendor_payments.project_id` is NOT NULL — we cannot insert without a project.

- [ ] **Step 2: Dry-run, real run**

- [ ] **Step 3: Verify cascade fired on bills**

```sql
SELECT status, COUNT(*) FROM vendor_bills WHERE source = 'zoho_import' GROUP BY status;
-- Expected: most 'paid', some 'partially_paid', some 'pending'
```

- [ ] **Step 4: Commit + push**

---

### Task 19: Phase 12 — Project-tagged Expenses

**Files:**
- Create: `scripts/zoho-import/phase-12-expenses.ts`

- [ ] **Step 1: Write phase 12**

Only import expenses with a Zoho Project ID that maps to an ERP project. Zoho has 5,302 expenses; most are non-project (office stationery, food). We only care about project-tagged ones.

```typescript
// Filter first
const projectTagged = rows.filter(r => toStr(r['Project ID']) && projByZoho.has(String(r['Project ID'])));
console.log(`  ${projectTagged.length} of ${rows.length} expenses are project-tagged`);

// Insert each as expenses row
for (const r of projectTagged) {
  await admin.from('expenses').insert({
    project_id: projByZoho.get(String(r['Project ID'])),
    expense_date: toDateISO(r['Date']),
    amount: toNumber(r.Amount),
    // category_id: look up from expense_category text → expense_categories table
    category_id: await getCategoryId(r['Category Name']),  // 'miscellaneous' fallback
    description: toStr(r['Description']) ?? toStr(r['Category Name']) ?? 'Imported from Zoho',
    status: 'approved',  // Zoho entries are all already "approved" in business terms
    source: 'zoho_import',
    zoho_expense_id: String(r['Expense ID']),
    submitted_by: SYSTEM_EMPLOYEE_ID,  // resolved at script start: lookup Vivek's employee_id (see note below)
    voucher_number: null,  // trigger will generate
  });
}
```

> **Decision (resolved):** Reuse Vivek's `employee_id` via the shared `getSystemEmployeeId()` helper (added to `supabase.ts` in Task 6). At the top of `runPhase12()`:
> ```typescript
> const SYSTEM_EMPLOYEE_ID = await getSystemEmployeeId();
> ```
> Traceability is preserved via `source = 'zoho_import'` — we don't need a separate identity.

- [ ] **Step 2: Dry-run + real run**

- [ ] **Step 3: Commit + push**

---

### Task 20: Phase 13 — Credit notes (optional, read-only import)

**Files:**
- Create: `scripts/zoho-import/phase-13-credit-notes.ts`

- [ ] **Step 1: Table is `invoice_credit_notes` (confirmed exists in migration 004d)**

It has columns: `invoice_id` (FK to invoices), `project_id`, `raised_by`, `credit_note_number` (UNIQUE), `reason`, `credit_amount`, `gst_amount`, `total_credit`, `credit_note_date`, `pdf_storage_path`.

Import Zoho credit notes as read-only `source = 'zoho_import'` rows, but:
- `raised_by` = Vivek's employee_id (reuse lookup pattern from phase-12)
- `credit_note_number` must be unique — prefix Zoho numbers with `ZHI/` to avoid collision with ERP-issued numbers
- `invoice_id` = lookup by `zoho_invoice_id` (match against what phase-08 imported). If not found, skip that credit note (orphaned)
- `reason` = use Zoho's "Reason" field or fall back to "Imported from Zoho"

Add `zoho_credit_note_id TEXT UNIQUE` and `source TEXT` columns to `invoice_credit_notes` in migration 067 (add to Section 4 + 5 now if not already; re-apply migration if needed, or create a supplementary migration).

- [ ] **Step 2: If skipped, add a placeholder that returns `emptyResult('13-credit-notes')` with a console warning**

- [ ] **Step 3: Commit + push**

---

### Task 21: Reconcile script

**Files:**
- Create: `scripts/zoho-import/reconcile.ts`

- [ ] **Step 1: Write reconcile**

```typescript
// scripts/zoho-import/reconcile.ts
import { admin } from './supabase';
import { loadSheet, toNumber, toStr } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';

export async function runReconcile(): Promise<PhaseResult> {
  const result = emptyResult('reconcile');

  // Per-project totals from ERP
  const { data: erpRows } = await admin.rpc('get_project_profitability_v2', { p_project_id: null });

  // Per-project totals from Zoho (compute from xls)
  const poRows = loadSheet('Purchase_Order.xls');
  const billRows = loadSheet('Bill.xls');
  const invRows = loadSheet('Invoice.xls');

  const zohoByProj = new Map<string, { invoiced: number; billed: number; pos: number }>();
  for (const r of invRows as Array<Record<string, unknown>>) {
    const pid = toStr(r['Project ID']); if (!pid) continue;
    const g = zohoByProj.get(pid) ?? { invoiced: 0, billed: 0, pos: 0 };
    g.invoiced += toNumber(r['Item Total']);
    zohoByProj.set(pid, g);
  }
  for (const r of billRows as Array<Record<string, unknown>>) {
    const pid = toStr(r['Project ID']); if (!pid) continue;
    const g = zohoByProj.get(pid) ?? { invoiced: 0, billed: 0, pos: 0 };
    g.billed += toNumber(r['Item Total']);
    zohoByProj.set(pid, g);
  }

  // Fetch mapping
  const { data: maps } = await admin.from('zoho_project_mapping').select('zoho_project_id, erp_project_id');
  const zohoByErp = new Map((maps ?? []).map(m => [m.erp_project_id, m.zoho_project_id]));

  const toInsert: Array<Record<string, unknown>> = [];
  for (const e of erpRows ?? []) {
    const zohoId = zohoByErp.get(e.project_id);
    if (!zohoId) continue;
    const z = zohoByProj.get(zohoId); if (!z) continue;

    const diffs = [
      { metric: 'total_invoiced', erp: Number(e.total_invoiced), zoho: z.invoiced },
      { metric: 'total_billed',   erp: Number(e.total_billed),   zoho: z.billed },
    ];
    for (const d of diffs) {
      if (Math.abs(d.erp - d.zoho) > 1) {
        toInsert.push({
          entity_type: 'project_totals',
          entity_ref: e.project_id,
          metric: d.metric,
          erp_value: d.erp,
          zoho_value: d.zoho,
        });
      }
    }
  }

  console.log(`  ${toInsert.length} discrepancies detected`);
  if (toInsert.length > 0) {
    const { error } = await admin.from('reconciliation_discrepancies').insert(toInsert);
    if (error) result.errors.push({ row: 0, reason: error.message });
    else result.inserted = toInsert.length;
  }
  return result;
}
```

- [ ] **Step 2: Run reconcile after all phases have completed**

```bash
npx tsx scripts/zoho-import/index.ts --phase=reconcile
```

- [ ] **Step 3: Inspect discrepancies**

```sql
SELECT metric, COUNT(*), SUM(ABS(difference))::NUMERIC(14,2) AS total_drift
FROM reconciliation_discrepancies
WHERE status = 'open'
GROUP BY metric ORDER BY 3 DESC;
```

Expected: <1% drift overall; any project with drift > ₹1,000 is worth investigating.

- [ ] **Step 4: Commit + push**

```bash
git add scripts/zoho-import/reconcile.ts
git commit -m "feat(zoho-import): reconcile ERP vs Zoho per-project totals"
git push origin main
```

---

## Phase C — Finance UI

### Task 22: Vendor bills — queries + actions

**Files:**
- Create: `apps/erp/src/lib/vendor-bills-queries.ts`
- Create: `apps/erp/src/lib/vendor-bills-actions.ts`
- Create: `apps/erp/src/lib/types/vendor-bills.ts`

- [ ] **Step 1: Write the shared type file**

```typescript
// apps/erp/src/lib/types/vendor-bills.ts
import type { Database } from '@repo/types/database';

export type VendorBill     = Database['public']['Tables']['vendor_bills']['Row'];
export type VendorBillItem = Database['public']['Tables']['vendor_bill_items']['Row'];

export type VendorBillInsert = Database['public']['Tables']['vendor_bills']['Insert'];
export type VendorBillItemInsert = Database['public']['Tables']['vendor_bill_items']['Insert'];

export interface VendorBillListRow extends VendorBill {
  vendor_name: string | null;
  project_number: string | null;
}
```

- [ ] **Step 2: Write queries**

```typescript
// apps/erp/src/lib/vendor-bills-queries.ts
import { createClient } from '@repo/supabase/server';
import type { VendorBillListRow } from './types/vendor-bills';

export interface BillFilters {
  status?: string;
  vendor_id?: string;
  project_id?: string;
  from_date?: string;
  to_date?: string;
  msme_only?: boolean;
  search?: string;
}

export async function getVendorBills(filters: BillFilters = {}): Promise<VendorBillListRow[]> {
  const op = '[getVendorBills]';
  const supabase = await createClient();
  let q = supabase
    .from('vendor_bills')
    .select(`*, vendors:vendor_id(company_name, is_msme), projects:project_id(project_number)`)
    .order('bill_date', { ascending: false })
    .limit(500);

  if (filters.status) q = q.eq('status', filters.status);
  if (filters.vendor_id) q = q.eq('vendor_id', filters.vendor_id);
  if (filters.project_id) q = q.eq('project_id', filters.project_id);
  if (filters.from_date) q = q.gte('bill_date', filters.from_date);
  if (filters.to_date) q = q.lte('bill_date', filters.to_date);
  if (filters.search) q = q.ilike('bill_number', `%${filters.search}%`);

  const { data, error } = await q;
  if (error) {
    console.error(`${op} query failed`, { error });
    return [];
  }

  type Row = NonNullable<typeof data>[number];
  return (data ?? []).map((r: Row) => ({
    ...r,
    vendor_name: r.vendors?.company_name ?? null,
    project_number: r.projects?.project_number ?? null,
  })) as VendorBillListRow[];
}

export async function getVendorBill(id: string) {
  const op = '[getVendorBill]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendor_bills')
    .select(`*, vendors:vendor_id(*), projects:project_id(*), vendor_bill_items(*)`)
    .eq('id', id)
    .single();
  if (error) {
    console.error(`${op} lookup failed`, { id, error });
    return null;
  }
  return data;
}

export async function getVendorBillsByProject(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('vendor_bills')
    .select('id, bill_number, bill_date, total_amount, balance_due, status')
    .eq('project_id', projectId)
    .order('bill_date', { ascending: false });
  return data ?? [];
}
```

- [ ] **Step 3: Write actions**

```typescript
// apps/erp/src/lib/vendor-bills-actions.ts
'use server';
import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from './types/actions';
import type { VendorBill, VendorBillInsert, VendorBillItemInsert } from './types/vendor-bills';
import { revalidatePath } from 'next/cache';

export interface CreateBillInput {
  bill: Omit<VendorBillInsert, 'id' | 'created_at' | 'updated_at'>;
  items: Array<Omit<VendorBillItemInsert, 'id' | 'created_at' | 'vendor_bill_id'>>;
}

export async function createVendorBill(input: CreateBillInput): Promise<ActionResult<VendorBill>> {
  const op = '[createVendorBill]';
  try {
    const supabase = await createClient();
    const { data: bill, error } = await supabase
      .from('vendor_bills')
      .insert(input.bill)
      .select()
      .single();
    if (error || !bill) {
      console.error(`${op} header insert failed`, { error });
      return err(error?.message ?? 'insert failed');
    }
    if (input.items.length > 0) {
      const itemRows = input.items.map(i => ({ ...i, vendor_bill_id: bill.id }));
      const { error: iErr } = await supabase.from('vendor_bill_items').insert(itemRows);
      if (iErr) {
        console.error(`${op} items insert failed`, { billId: bill.id, iErr });
        return err(iErr.message);
      }
    }
    revalidatePath('/vendor-bills');
    revalidatePath('/vendor-payments');
    revalidatePath(`/projects/${input.bill.project_id}`);
    return ok(bill);
  } catch (e) {
    console.error(`${op} threw`, { e });
    return err(e instanceof Error ? e.message : 'unknown');
  }
}

export async function updateVendorBill(id: string, patch: Partial<VendorBillInsert>): Promise<ActionResult<VendorBill>> {
  const op = '[updateVendorBill]';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('vendor_bills').update(patch).eq('id', id).select().single();
    if (error || !data) {
      console.error(`${op} update failed`, { id, error });
      return err(error?.message ?? 'update failed');
    }
    revalidatePath('/vendor-bills');
    return ok(data);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'unknown');
  }
}

export async function cancelVendorBill(id: string): Promise<ActionResult<void>> {
  const op = '[cancelVendorBill]';
  const supabase = await createClient();
  const { error } = await supabase.from('vendor_bills').update({ status: 'cancelled' }).eq('id', id);
  if (error) { console.error(`${op} failed`, { id, error }); return err(error.message); }
  revalidatePath('/vendor-bills');
  return ok(undefined);
}

export interface PayBillInput {
  bill_id: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference_number?: string;
  vendor_id: string;
}

export async function payVendorBill(input: PayBillInput): Promise<ActionResult<void>> {
  const op = '[payVendorBill]';
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('vendor_payments').insert({
      vendor_id: input.vendor_id,
      vendor_bill_id: input.bill_id,
      payment_date: input.payment_date,
      amount_paid: input.amount,
      payment_method: input.payment_method,
      reference_number: input.reference_number ?? null,
    });
    if (error) { console.error(`${op} failed`, { input, error }); return err(error.message); }
    revalidatePath('/vendor-bills');
    revalidatePath('/vendor-payments');
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'unknown');
  }
}
```

> **Column check:** `vendor_payments` schema may use `payment_amount` instead of `amount_paid`. Before writing, open `packages/types/database.ts` and verify. Adjust accordingly.

- [ ] **Step 4: `pnpm check-types` passes**

- [ ] **Step 5: Commit + push**

---

### Task 23: `/vendor-bills` list page

**Files:**
- Create: `apps/erp/src/app/(erp)/vendor-bills/page.tsx`
- Create: `apps/erp/src/app/(erp)/vendor-bills/loading.tsx`

- [ ] **Step 1: Write the list page**

Model after `apps/erp/src/app/(erp)/vendors/page.tsx` — use the same layout primitives (Eyebrow, Card, SearchInput, FilterBar, FilterSelect, Table).

```tsx
// apps/erp/src/app/(erp)/vendor-bills/page.tsx
import { getVendorBills } from '@/lib/vendor-bills-queries';
import { Card, CardContent, Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Eyebrow } from '@repo/ui';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { formatINR } from '@/lib/format-inr';
import Link from 'next/link';
import { format } from 'date-fns';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function VendorBillsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; search?: string; msme_only?: string }> }) {
  const params = await searchParams;
  const bills = await getVendorBills({
    status: params.status,
    search: params.search,
    msme_only: params.msme_only === '1',
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow>VENDOR BILLS</Eyebrow>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Vendor Bills</h1>
            <Badge variant="neutral">{bills.length}</Badge>
          </div>
        </div>
        <Link href="/vendor-bills/new" className="px-4 py-2 bg-[#1A1D24] text-white rounded">+ Record Bill</Link>
      </div>

      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-4">
          <FilterBar basePath="/vendor-bills" filterParams={['status', 'search']}>
            <FilterSelect paramName="status" className="w-40">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </FilterSelect>
            <SearchInput placeholder="Search bill number…" className="w-64 h-9 text-sm" />
          </FilterBar>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map(b => (
                <TableRow key={b.id}>
                  <TableCell><Link href={`/vendor-bills/${b.id}`} className="text-blue-600 hover:underline">{b.bill_number}</Link></TableCell>
                  <TableCell>{b.vendor_name ?? '—'}</TableCell>
                  <TableCell>{b.project_number ?? '—'}</TableCell>
                  <TableCell>{b.bill_date ? format(new Date(b.bill_date), 'dd MMM yyyy') : '—'}</TableCell>
                  <TableCell className="text-right">{formatINR(Number(b.total_amount))}</TableCell>
                  <TableCell className="text-right">{formatINR(Number(b.balance_due))}</TableCell>
                  <TableCell><Badge variant={b.status === 'paid' ? 'success' : b.status === 'cancelled' ? 'neutral' : 'warning'}>{b.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Loading skeleton**

```tsx
// apps/erp/src/app/(erp)/vendor-bills/loading.tsx
export default function Loading() {
  return <div className="p-6"><div className="h-10 w-48 bg-gray-100 animate-pulse rounded" /></div>;
}
```

- [ ] **Step 3: Visit /vendor-bills in `pnpm dev` — confirm renders and filter works**

- [ ] **Step 4: Commit + push**

---

### Task 24: `/vendor-bills/[id]` detail page

**Files:**
- Create: `apps/erp/src/app/(erp)/vendor-bills/[id]/page.tsx`

- [ ] **Step 1: Write detail page**

Show header + items table + payments applied. Add a "Pay Bill" CTA if `balance_due > 0` and the user has `finance` or `founder` role.

```tsx
import { getVendorBill } from '@/lib/vendor-bills-queries';
import { formatINR } from '@/lib/format-inr';
import { Card, CardContent, Badge, Eyebrow, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@repo/ui';
import { format } from 'date-fns';
import { RecordBillPaymentDialog } from '@/components/vendor-bills/record-bill-payment-dialog';
import { notFound } from 'next/navigation';

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bill = await getVendorBill(id);
  if (!bill) notFound();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>VENDOR BILL</Eyebrow>
          <h1 className="text-2xl font-bold">{bill.bill_number}</h1>
          <p className="text-sm text-gray-500">{bill.vendors?.company_name}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Balance Due</div>
          <div className="text-2xl font-bold">{formatINR(Number(bill.balance_due))}</div>
          <Badge variant={bill.status === 'paid' ? 'success' : 'warning'}>{bill.status}</Badge>
        </div>
      </div>

      <Card>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">Date:</span> {bill.bill_date && format(new Date(bill.bill_date), 'dd MMM yyyy')}</div>
            <div><span className="text-gray-500">Due:</span> {bill.due_date ? format(new Date(bill.due_date), 'dd MMM yyyy') : '—'}</div>
            <div><span className="text-gray-500">Project:</span> {bill.projects?.project_number ?? '—'}</div>
            <div><span className="text-gray-500">Total:</span> {formatINR(Number(bill.total_amount))}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(bill.vendor_bill_items ?? []).map(i => (
                <TableRow key={i.id}>
                  <TableCell>{i.item_name}</TableCell>
                  <TableCell className="font-mono text-xs">{i.hsn_code ?? '—'}</TableCell>
                  <TableCell className="text-right">{Number(i.quantity)}</TableCell>
                  <TableCell className="text-right">{formatINR(Number(i.rate))}</TableCell>
                  <TableCell className="text-right">{formatINR(Number(i.total_amount))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {Number(bill.balance_due) > 0 && bill.status !== 'cancelled' && (
        <RecordBillPaymentDialog billId={bill.id} vendorId={bill.vendor_id} maxAmount={Number(bill.balance_due)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit + push**

---

### Task 25: Record Bill + Pay Bill dialogs

**Files:**
- Create: `apps/erp/src/components/vendor-bills/record-bill-dialog.tsx`
- Create: `apps/erp/src/components/vendor-bills/record-bill-payment-dialog.tsx`
- Create: `apps/erp/src/app/(erp)/vendor-bills/new/page.tsx`

- [ ] **Step 1: Full-page "new bill" flow (preferred over modal for mobile ergonomics)**

```tsx
// apps/erp/src/app/(erp)/vendor-bills/new/page.tsx
import { getVendors } from '@/lib/vendor-queries';
import { getProjectList } from '@/lib/projects-queries';  // import correct name
import { RecordBillForm } from '@/components/vendor-bills/record-bill-form';

export default async function NewBillPage() {
  const [vendors, projects] = await Promise.all([ getVendors({}), getProjectList() ]);
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Record Vendor Bill</h1>
      <RecordBillForm vendors={vendors} projects={projects} />
    </div>
  );
}
```

- [ ] **Step 2: Write `<RecordBillForm>` client component**

```tsx
// apps/erp/src/components/vendor-bills/record-bill-form.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createVendorBill } from '@/lib/vendor-bills-actions';
import { Card, CardContent, Button, Input, Select } from '@repo/ui';
import { toast } from 'sonner';
import Decimal from 'decimal.js';

interface Vendor { id: string; company_name: string; gstin: string | null; }
interface Project { id: string; project_number: string; customer_name: string; }

interface LineItem {
  item_name: string; hsn_code: string;
  quantity: string; rate: string;
  cgst_rate_pct: string; sgst_rate_pct: string; igst_rate_pct: string;
}

const EMPTY_ITEM: LineItem = {
  item_name: '', hsn_code: '',
  quantity: '1', rate: '0',
  cgst_rate_pct: '9', sgst_rate_pct: '9', igst_rate_pct: '0',
};

export function RecordBillForm({ vendors, projects }: { vendors: Vendor[]; projects: Project[] }) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);

  const totals = items.reduce((acc, it) => {
    const q = new Decimal(it.quantity || 0);
    const r = new Decimal(it.rate || 0);
    const taxable = q.mul(r);
    const cgst = taxable.mul(new Decimal(it.cgst_rate_pct || 0).div(100));
    const sgst = taxable.mul(new Decimal(it.sgst_rate_pct || 0).div(100));
    const igst = taxable.mul(new Decimal(it.igst_rate_pct || 0).div(100));
    return {
      subtotal: acc.subtotal.plus(taxable),
      cgst: acc.cgst.plus(cgst),
      sgst: acc.sgst.plus(sgst),
      igst: acc.igst.plus(igst),
    };
  }, { subtotal: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) });
  const total = totals.subtotal.plus(totals.cgst).plus(totals.sgst).plus(totals.igst);

  async function submit() {
    if (!vendorId || !billNumber || items.length === 0) {
      toast.error('Vendor, bill number, and at least one item are required');
      return;
    }
    setBusy(true);
    const result = await createVendorBill({
      bill: {
        vendor_id: vendorId,
        project_id: projectId || null,
        bill_number: billNumber,
        bill_date: billDate,
        due_date: dueDate || null,
        subtotal: totals.subtotal.toNumber(),
        cgst_amount: totals.cgst.toNumber(),
        sgst_amount: totals.sgst.toNumber(),
        igst_amount: totals.igst.toNumber(),
        total_amount: total.toNumber(),
        status: 'pending',
      },
      items: items.map(it => {
        const q = new Decimal(it.quantity || 0);
        const r = new Decimal(it.rate || 0);
        const taxable = q.mul(r);
        return {
          item_name: it.item_name,
          hsn_code: it.hsn_code || null,
          quantity: q.toNumber(),
          rate: r.toNumber(),
          taxable_amount: taxable.toNumber(),
          cgst_rate_pct: Number(it.cgst_rate_pct),
          sgst_rate_pct: Number(it.sgst_rate_pct),
          igst_rate_pct: Number(it.igst_rate_pct),
          cgst_amount: taxable.mul(new Decimal(it.cgst_rate_pct).div(100)).toNumber(),
          sgst_amount: taxable.mul(new Decimal(it.sgst_rate_pct).div(100)).toNumber(),
          igst_amount: taxable.mul(new Decimal(it.igst_rate_pct).div(100)).toNumber(),
          total_amount: taxable
            .plus(taxable.mul(new Decimal(it.cgst_rate_pct).div(100)))
            .plus(taxable.mul(new Decimal(it.sgst_rate_pct).div(100)))
            .plus(taxable.mul(new Decimal(it.igst_rate_pct).div(100)))
            .toNumber(),
        };
      }),
    });
    setBusy(false);
    if (!result.success) { toast.error(result.error); return; }
    toast.success('Bill recorded');
    router.push(`/vendor-bills/${result.data.id}`);
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 grid grid-cols-2 gap-4">
        <label>Vendor<select value={vendorId} onChange={e => setVendorId(e.target.value)} className="w-full border rounded px-2 py-1">
          <option value="">Select vendor…</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
        </select></label>
        <label>Project (optional)<select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full border rounded px-2 py-1">
          <option value="">—</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_number} · {p.customer_name}</option>)}
        </select></label>
        <label>Bill Number<input value={billNumber} onChange={e => setBillNumber(e.target.value)} className="w-full border rounded px-2 py-1" /></label>
        <label>Bill Date<input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="w-full border rounded px-2 py-1" /></label>
        <label>Due Date<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border rounded px-2 py-1" /></label>
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <div className="font-semibold mb-2">Line Items</div>
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-8 gap-2 mb-2 text-sm">
            <input placeholder="Item" value={it.item_name} onChange={e => setItems(x => x.map((y, i) => i === idx ? { ...y, item_name: e.target.value } : y))} className="col-span-2 border rounded px-2 py-1" />
            <input placeholder="HSN" value={it.hsn_code} onChange={e => setItems(x => x.map((y, i) => i === idx ? { ...y, hsn_code: e.target.value } : y))} className="border rounded px-2 py-1" />
            <input placeholder="Qty" value={it.quantity} onChange={e => setItems(x => x.map((y, i) => i === idx ? { ...y, quantity: e.target.value } : y))} className="border rounded px-2 py-1" />
            <input placeholder="Rate" value={it.rate} onChange={e => setItems(x => x.map((y, i) => i === idx ? { ...y, rate: e.target.value } : y))} className="border rounded px-2 py-1" />
            <input placeholder="CGST %" value={it.cgst_rate_pct} onChange={e => setItems(x => x.map((y, i) => i === idx ? { ...y, cgst_rate_pct: e.target.value } : y))} className="border rounded px-2 py-1" />
            <input placeholder="SGST %" value={it.sgst_rate_pct} onChange={e => setItems(x => x.map((y, i) => i === idx ? { ...y, sgst_rate_pct: e.target.value } : y))} className="border rounded px-2 py-1" />
            <button onClick={() => setItems(x => x.filter((_, i) => i !== idx))} className="text-red-600 text-xs">remove</button>
          </div>
        ))}
        <button onClick={() => setItems(x => [...x, { ...EMPTY_ITEM }])} className="text-blue-600 text-sm">+ add item</button>
        <div className="mt-4 text-right text-sm">
          <div>Subtotal: ₹{totals.subtotal.toFixed(2)}</div>
          <div>CGST: ₹{totals.cgst.toFixed(2)}</div>
          <div>SGST: ₹{totals.sgst.toFixed(2)}</div>
          <div>IGST: ₹{totals.igst.toFixed(2)}</div>
          <div className="font-bold">Total: ₹{total.toFixed(2)}</div>
        </div>
      </CardContent></Card>

      <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save Bill'}</Button>
    </div>
  );
}
```

- [ ] **Step 3: Write pay-bill dialog**

```tsx
// apps/erp/src/components/vendor-bills/record-bill-payment-dialog.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { payVendorBill } from '@/lib/vendor-bills-actions';
import { Button } from '@repo/ui';
import { toast } from 'sonner';

export function RecordBillPaymentDialog({ billId, vendorId, maxAmount }: { billId: string; vendorId: string; maxAmount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(maxAmount.toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('bank_transfer');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await payVendorBill({
      bill_id: billId, vendor_id: vendorId,
      payment_date: date, amount: Number(amount),
      payment_method: method, reference_number: ref || undefined,
    });
    setBusy(false);
    if (!result.success) { toast.error(result.error); return; }
    toast.success('Payment recorded'); setOpen(false); router.refresh();
  }

  if (!open) return <Button onClick={() => setOpen(true)}>Pay Bill</Button>;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded p-6 w-96 space-y-3">
        <h2 className="text-lg font-bold">Pay Bill</h2>
        <label className="block">Amount<input value={amount} onChange={e => setAmount(e.target.value)} className="w-full border rounded px-2 py-1" /></label>
        <label className="block">Date<input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border rounded px-2 py-1" /></label>
        <label className="block">Method<select value={method} onChange={e => setMethod(e.target.value)} className="w-full border rounded px-2 py-1">
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cheque">Cheque</option>
          <option value="upi">UPI</option>
          <option value="cash">Cash</option>
        </select></label>
        <label className="block">Reference<input value={ref} onChange={e => setRef(e.target.value)} className="w-full border rounded px-2 py-1" /></label>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Pay'}</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test — create a bill, pay it, verify status flips to `paid`**

- [ ] **Step 5: Commit + push**

---

### Task 26: `/vendor-payments` bill-centric upgrade

**Files:**
- Modify: `apps/erp/src/app/(erp)/vendor-payments/page.tsx`
- Modify: `apps/erp/src/lib/payments-overview-queries.ts` (if needed — add a getBillsPendingPayment)

- [ ] **Step 1: Read the existing page + query file**

Check the current fetching pattern. Replace its main list with `vendor_bills` rows where `status IN ('pending','partially_paid')`, ordered by `bill_date ASC`.

- [ ] **Step 2: Add MSME aging strip at top (uses `get_msme_aging_summary` RPC)**

```tsx
const { data: aging } = await supabase.rpc('get_msme_aging_summary');
// Render as 4 badges: 0-30, 31-40, 41-45, overdue
```

- [ ] **Step 3: Keep a "By PO" tab pointing at old view for audit continuity**

- [ ] **Step 4: Visit page, confirm both views render**

- [ ] **Step 5: Commit + push**

---

### Task 27: `/profitability` rebuild around `get_project_profitability_v2`

**Files:**
- Modify: `apps/erp/src/app/(erp)/profitability/page.tsx`

- [ ] **Step 1: Replace existing query with RPC call**

```tsx
const supabase = await createClient();
const { data } = await supabase.rpc('get_project_profitability_v2', { p_project_id: null });
// Aggregate top-line sums in TypeScript over the returned rows (safe since the RPC already aggregated per-project)
```

- [ ] **Step 2: Render card-per-project with invoiced/received/billed/paid/margin**

- [ ] **Step 3: Top-line totals across all projects**

- [ ] **Step 4: Commit + push**

---

### Task 28: `/cash` v2 — include Zoho monthly summary

**Files:**
- Modify: `apps/erp/src/app/(erp)/cash/page.tsx`
- Modify: `apps/erp/src/lib/cash-queries.ts`

- [ ] **Step 1: Add a query that calls `get_company_cash_summary_v2()`**

```typescript
// apps/erp/src/lib/cash-queries.ts (add function)
export async function getCompanyCashSummaryV2() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_company_cash_summary_v2');
  if (error) { console.error('[getCompanyCashSummaryV2]', error); return null; }
  return data?.[0] ?? null;
}
```

- [ ] **Step 2: Render a section in the cash page with `zoho_monthly_company_expenses` and reconciliation banner**

- [ ] **Step 3: Commit + push**

---

### Task 29: `/vendors/[id]` detail page

**Files:**
- Create: `apps/erp/src/app/(erp)/vendors/[id]/page.tsx`
- Create: `apps/erp/src/lib/vendor-detail-queries.ts`

- [ ] **Step 1: Write detail queries**

```typescript
// apps/erp/src/lib/vendor-detail-queries.ts
import { createClient } from '@repo/supabase/server';

export async function getVendorDetail(id: string) {
  const supabase = await createClient();
  const [vendor, bills, payments, pos] = await Promise.all([
    supabase.from('vendors').select('*').eq('id', id).single(),
    supabase.from('vendor_bills').select('*').eq('vendor_id', id).order('bill_date', { ascending: false }).limit(100),
    supabase.from('vendor_payments').select('*').eq('vendor_id', id).order('payment_date', { ascending: false }).limit(100),
    supabase.from('purchase_orders').select('id, po_number, po_date, total_amount, status').eq('vendor_id', id).order('po_date', { ascending: false }).limit(100),
  ]);
  return {
    vendor: vendor.data,
    bills: bills.data ?? [],
    payments: payments.data ?? [],
    pos: pos.data ?? [],
  };
}
```

- [ ] **Step 2: Write the page with tabs (Bills / Payments / POs / Activity)**

Use whatever tab primitive already exists in `@repo/ui` or replicate the pattern from purchase v2 workspace.

- [ ] **Step 3: Commit + push**

---

### Task 30: Founder dashboard sync health card

**Files:**
- Modify: `apps/erp/src/app/(erp)/dashboard/page.tsx` (or wherever founder dashboard lives)
- Create: `apps/erp/src/components/finance/zoho-sync-card.tsx`

- [ ] **Step 1: Build the query**

```typescript
// apps/erp/src/lib/finance-queries.ts — add
export async function getZohoSyncHealth() {
  const supabase = await createClient();
  const [queue, reconc] = await Promise.all([
    supabase.from('zoho_sync_queue').select('status').limit(10000),
    supabase.from('reconciliation_discrepancies').select('id').eq('status', 'open'),
  ]);
  const counts = { pending: 0, syncing: 0, failed: 0, synced: 0 };
  for (const r of queue.data ?? []) counts[r.status as keyof typeof counts]++;
  return { counts, openDiscrepancies: reconc.data?.length ?? 0 };
}
```

- [ ] **Step 2: Build the card component (server component)**

```tsx
// apps/erp/src/components/finance/zoho-sync-card.tsx
import { getZohoSyncHealth } from '@/lib/finance-queries';
import { Card, CardContent, Badge } from '@repo/ui';

export async function ZohoSyncCard() {
  const { counts, openDiscrepancies } = await getZohoSyncHealth();
  const redFlag = counts.failed > 0 || openDiscrepancies > 0;
  return (
    <Card className={redFlag ? 'border-red-400' : ''}>
      <CardContent className="p-4">
        <div className="font-semibold mb-2">Zoho Sync</div>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div><div className="text-gray-500">Pending</div><div className="font-bold">{counts.pending}</div></div>
          <div><div className="text-gray-500">Syncing</div><div className="font-bold">{counts.syncing}</div></div>
          <div><div className="text-gray-500">Failed</div><div className="font-bold text-red-600">{counts.failed}</div></div>
          <div><div className="text-gray-500">Drift</div><div className="font-bold text-red-600">{openDiscrepancies}</div></div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Add to founder dashboard page, behind a role gate**

- [ ] **Step 4: Commit + push**

---

## Phase D — n8n sync engine (scaffolding + docs only; live enablement requires Vivek's Zoho OAuth app)

### Task 31: Document n8n workflow designs

**Files:**
- Create: `docs/n8n/zoho-sync-workflow.md`
- Create: `docs/n8n/zoho-monthly-summary-workflow.md`
- Create: `docs/n8n/zoho-reconciliation-workflow.md`
- Create: `docs/n8n/README.md`

- [ ] **Step 1: Write workflow docs**

Each file describes: trigger, node-by-node flow, expected Zoho Books endpoint + payload, error handling, alert path. These serve as the source-of-truth spec for the JSON export Vivek imports into n8n.

- [ ] **Step 2: Commit + push**

---

### Task 32: Payload mapping module (callable from n8n or Edge Function)

**Files:**
- Create: `packages/zoho-sync/package.json`
- Create: `packages/zoho-sync/src/index.ts`
- Create: `packages/zoho-sync/src/mappers/contact.ts`
- Create: `packages/zoho-sync/src/mappers/vendor.ts`
- Create: `packages/zoho-sync/src/mappers/invoice.ts`
- Create: `packages/zoho-sync/src/mappers/customer-payment.ts`
- Create: `packages/zoho-sync/src/mappers/purchase-order.ts`
- Create: `packages/zoho-sync/src/mappers/vendor-bill.ts`
- Create: `packages/zoho-sync/src/mappers/vendor-payment.ts`
- Create: `packages/zoho-sync/src/mappers/expense.ts`
- Create: `packages/zoho-sync/src/types.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@repo/zoho-sync",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@repo/types": "workspace:*"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "typescript": "5.9.2"
  }
}
```

- [ ] **Step 2: Write mapper modules**

Each mapper is a pure function: `function mapXToZoho(erpRow: X, refs: Refs): ZohoPayload`. Keep logic here so it can be unit-tested without n8n.

Example — contact mapper:

```typescript
// packages/zoho-sync/src/mappers/contact.ts
import type { Database } from '@repo/types/database';
type Contact = Database['public']['Tables']['contacts']['Row'];

export function mapContactToZoho(c: Contact) {
  return {
    contact_name: c.company_name,
    company_name: c.company_name,
    contact_type: 'customer',
    gst_no: c.gstin ?? undefined,
    gst_treatment: c.gstin ? 'business_gst' : 'consumer',
    phone: c.phone ?? undefined,
    email: c.email ?? undefined,
  };
}
```

Write similar small mappers for the other 7 entities.

- [ ] **Step 3: Add `packages/zoho-sync` to `pnpm-workspace.yaml` if workspace glob doesn't already include it**

- [ ] **Step 4: `pnpm check-types`**

- [ ] **Step 5: Commit + push**

---

### Task 33: `claim_next_sync_batch` RPC

**Files:**
- Create: `supabase/migrations/072_zoho_sync_claim_rpc.sql`

- [ ] **Step 1: Write migration**

```sql
-- Migration 072: claim_next_sync_batch RPC
-- Atomically claim up to N pending/failed rows for n8n to process.
BEGIN;

CREATE OR REPLACE FUNCTION claim_next_sync_batch(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  entity_type   zoho_sync_entity_type,
  entity_id     UUID,
  action        zoho_sync_action,
  attempt_count INT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE zoho_sync_queue q
  SET status = 'syncing',
      attempt_count = q.attempt_count + 1,
      last_attempt_at = NOW()
  WHERE q.id IN (
    SELECT id FROM zoho_sync_queue
    WHERE status IN ('pending','failed')
      AND attempt_count < 3
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING q.id, q.entity_type, q.entity_id, q.action, q.attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION mark_sync_success(
  p_queue_id UUID,
  p_zoho_id  TEXT,
  p_response JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  r zoho_sync_queue%ROWTYPE;
BEGIN
  SELECT * INTO r FROM zoho_sync_queue WHERE id = p_queue_id FOR UPDATE;
  UPDATE zoho_sync_queue SET status='synced', synced_at=NOW(), zoho_response=p_response WHERE id=p_queue_id;

  -- Stamp the zoho_*_id on the source row
  CASE r.entity_type
    WHEN 'contact' THEN UPDATE contacts SET zoho_contact_id=p_zoho_id WHERE id=r.entity_id AND zoho_contact_id IS NULL;
    WHEN 'vendor'  THEN UPDATE vendors  SET zoho_vendor_id=p_zoho_id  WHERE id=r.entity_id AND zoho_vendor_id  IS NULL;
    WHEN 'project' THEN UPDATE projects SET zoho_project_id=p_zoho_id WHERE id=r.entity_id AND zoho_project_id IS NULL;
    WHEN 'invoice' THEN UPDATE invoices SET zoho_invoice_id=p_zoho_id WHERE id=r.entity_id AND zoho_invoice_id IS NULL;
    WHEN 'customer_payment' THEN UPDATE customer_payments SET zoho_customer_payment_id=p_zoho_id WHERE id=r.entity_id AND zoho_customer_payment_id IS NULL;
    WHEN 'purchase_order' THEN UPDATE purchase_orders SET zoho_po_id=p_zoho_id WHERE id=r.entity_id AND zoho_po_id IS NULL;
    WHEN 'vendor_bill' THEN UPDATE vendor_bills SET zoho_bill_id=p_zoho_id WHERE id=r.entity_id AND zoho_bill_id IS NULL;
    WHEN 'vendor_payment' THEN UPDATE vendor_payments SET zoho_vendor_payment_id=p_zoho_id WHERE id=r.entity_id AND zoho_vendor_payment_id IS NULL;
    WHEN 'expense' THEN UPDATE expenses SET zoho_expense_id=p_zoho_id WHERE id=r.entity_id AND zoho_expense_id IS NULL;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION mark_sync_failure(
  p_queue_id UUID,
  p_error    TEXT,
  p_response JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  r zoho_sync_queue%ROWTYPE;
BEGIN
  SELECT * INTO r FROM zoho_sync_queue WHERE id = p_queue_id FOR UPDATE;
  UPDATE zoho_sync_queue SET
    status = CASE WHEN r.attempt_count >= 3 THEN 'failed'::zoho_sync_status ELSE 'pending'::zoho_sync_status END,
    last_error = p_error,
    zoho_response = p_response
  WHERE id = p_queue_id;
END;
$$;

COMMIT;
```

- [ ] **Step 2: Apply + regenerate types + commit + push**

---

## Phase E — Docs & smoke

### Task 34: Update docs

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/modules/finance.md`
- Modify: `docs/SHIROI_MASTER_REFERENCE.md` (section 11: data migration status)

- [ ] **Step 1: Append to CHANGELOG.md**

Add one line per task that produced a migration or user-visible feature, dated 2026-04-18.

Example lines:
```
2026-04-18 — feat(db): migration 067 — vendor_bills + zoho_sync_queue schema.
2026-04-18 — feat(db): migration 068 — Zoho lookup tables + reconciliation.
2026-04-18 — feat(zoho-import): 3-year historical import of Zoho Books data.
2026-04-18 — feat(finance): /vendor-bills list + detail + record-bill flow.
2026-04-18 — feat(finance): /vendor-payments bill-centric upgrade + MSME aging strip.
2026-04-18 — feat(finance): /profitability v2 with bills + expenses + margin.
2026-04-18 — feat(finance): /cash v2 with Zoho monthly summary subtraction.
2026-04-18 — feat(finance): /vendors/[id] detail page (bills / payments / POs / activity).
2026-04-18 — feat(finance): founder-dashboard Zoho sync health card.
```

- [ ] **Step 2: Update CURRENT_STATUS.md**

Move "Zoho Books import" from "Blocked on CSVs" to "Shipped Apr 18". Update migration state table: dev latest = 072. Update the table under "In flight this week".

- [ ] **Step 3: Update `docs/modules/finance.md`**

- Add new routes: `/vendor-bills`, `/vendors/[id]`.
- Add new tables: `vendor_bills`, `vendor_bill_items`, `zoho_sync_queue`, `zoho_project_mapping`, `zoho_account_codes`, `zoho_tax_codes`, `zoho_items`, `zoho_monthly_summary`, `reconciliation_discrepancies`.
- Add new RPCs: `get_project_profitability_v2`, `get_company_cash_summary_v2`, `get_msme_aging_summary`, `claim_next_sync_batch`, `mark_sync_success`, `mark_sync_failure`.
- Update MSME compliance section: 45-day clock now measured from `vendor_bills.bill_date`, not PO delivery.

- [ ] **Step 4: Update `SHIROI_MASTER_REFERENCE.md` §11**

Change "Upcoming: Zoho Books import" to "Completed: 3-year historical import from Zoho Books on 2026-04-18" and list what was imported.

- [ ] **Step 5: Commit + push**

```bash
git add docs/
git commit -m "docs: Finance Module V2 + Zoho integration — CHANGELOG, status, module, master ref"
git push origin main
```

---

### Task 35: Playwright smoke test

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Add a test**

```typescript
test('vendor bill list loads', async ({ page }) => {
  await page.goto('/vendor-bills');
  await expect(page.locator('h1')).toContainText('Vendor Bills');
});

test('profitability page loads with project data', async ({ page }) => {
  await page.goto('/profitability');
  await expect(page.locator('h1')).toContainText('Profitability');
});
```

- [ ] **Step 2: `pnpm test` — ensure existing tests still green**

- [ ] **Step 3: Commit + push**

---

## Self-check before declaring done

- [ ] `pnpm check-types` returns 0 errors across all 5 packages.
- [ ] `pnpm lint` returns 0 errors.
- [ ] `bash scripts/ci/check-forbidden-patterns.sh` does not regress the baseline (run with no args to compare).
- [ ] Dev Supabase has migrations 067-072 applied (`mcp list_migrations` on dev).
- [ ] `SELECT COUNT(*) FROM vendor_bills` on dev returns > 1,500.
- [ ] `SELECT COUNT(*) FROM zoho_project_mapping` on dev returns > 150.
- [ ] `SELECT * FROM get_project_profitability_v2() LIMIT 5` returns valid rows.
- [ ] `/vendor-bills`, `/profitability`, `/cash` all render without console errors.
- [ ] CHANGELOG, CURRENT_STATUS, modules/finance.md, SHIROI_MASTER_REFERENCE.md all updated.
- [ ] All commits pushed to `main`.
- [ ] Final summary message written to user explaining what landed + what still needs Vivek's action (Zoho OAuth self-client registration for live sync; interactive project review for bucketed matches).

---

## Deferred to post-overnight (requires Vivek's actions)

1. **Zoho OAuth self-client registration** — Vivek registers app at `https://api-console.zoho.in`, generates refresh token, stores in n8n credentials.
2. **Interactive project review** — Vivek runs `npx tsx scripts/zoho-import/review-queue.ts` on the ambiguous-match CSV.
3. **n8n workflow JSON import** — Vivek imports the n8n workflow specs (from `docs/n8n/`) into the n8n instance and wires credentials.
4. **Live sync cutover** — flip the switch from "import complete, sync parked" to "sync live" once Vivek has confirmed Zoho credentials work against his sandbox.
