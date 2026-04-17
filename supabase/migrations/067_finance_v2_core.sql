-- Migration 067: Finance Module V2 — core schema
-- See docs/superpowers/specs/2026-04-17-finance-module-v2-zoho-design.md §5.1, 5.2
--
-- Summary:
--  1. vendor_bills + vendor_bill_items tables
--  2. zoho_sync_queue + enums
--  3. zoho_*_id columns on 8 existing tables
--  4. source columns on 5 operational tables
--  5. vendor_payments.vendor_bill_id FK + make purchase_order_id nullable
--  6. vendors.udyam_number + udyam_type
--  7. Indexes on every new filterable/joinable column
--
-- Note: uses touch_updated_at (not set_current_timestamp_updated_at) which is
-- the existing helper in this schema. vendor_payments.amount is the payment field.

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

-- updated_at trigger
CREATE TRIGGER vendor_bills_updated_at
  BEFORE UPDATE ON vendor_bills
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- Section 2: vendor_bills RLS (mirrors purchase_orders)
-- ============================================================================

ALTER TABLE vendor_bills      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_bills_select ON vendor_bills
  FOR SELECT USING (
    get_my_role() IN ('finance','founder','purchase_officer')
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

CREATE POLICY vendor_bills_mutate ON vendor_bills
  FOR ALL USING (
    get_my_role() IN ('finance','founder','purchase_officer')
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
    get_my_role() IN ('finance','founder','purchase_officer')
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

CREATE UNIQUE INDEX uq_zoho_sync_queue_active
  ON zoho_sync_queue (entity_type, entity_id, action)
  WHERE status IN ('pending','syncing','failed');

CREATE INDEX idx_zoho_sync_queue_pending ON zoho_sync_queue(created_at) WHERE status = 'pending';
CREATE INDEX idx_zoho_sync_queue_failed  ON zoho_sync_queue(last_attempt_at) WHERE status = 'failed';

ALTER TABLE zoho_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY zoho_sync_queue_select ON zoho_sync_queue
  FOR SELECT USING (get_my_role() IN ('finance','founder'));

CREATE POLICY zoho_sync_queue_mutate ON zoho_sync_queue
  FOR ALL USING (get_my_role() IN ('finance','founder'))
  WITH CHECK (get_my_role() IN ('finance','founder'));

-- ============================================================================
-- Section 4: zoho_*_id columns on operational tables
-- ============================================================================

ALTER TABLE invoices              ADD COLUMN zoho_invoice_id              TEXT UNIQUE;
ALTER TABLE customer_payments     ADD COLUMN zoho_customer_payment_id     TEXT UNIQUE;
ALTER TABLE purchase_orders       ADD COLUMN zoho_po_id                   TEXT UNIQUE;
ALTER TABLE vendor_payments       ADD COLUMN zoho_vendor_payment_id       TEXT UNIQUE;
ALTER TABLE contacts              ADD COLUMN zoho_contact_id              TEXT UNIQUE;
ALTER TABLE vendors               ADD COLUMN zoho_vendor_id               TEXT UNIQUE;
ALTER TABLE projects              ADD COLUMN zoho_project_id              TEXT UNIQUE;
ALTER TABLE expenses              ADD COLUMN zoho_expense_id              TEXT UNIQUE;
ALTER TABLE invoice_credit_notes  ADD COLUMN zoho_credit_note_id          TEXT UNIQUE;

-- ============================================================================
-- Section 5: source columns on operational tables
-- ============================================================================

ALTER TABLE invoices              ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE customer_payments     ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE purchase_orders       ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE vendor_payments       ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE expenses              ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));
ALTER TABLE invoice_credit_notes  ADD COLUMN source TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('erp','zoho_import'));

-- ============================================================================
-- Section 6: vendor_payments.vendor_bill_id FK + make PO link nullable
-- ============================================================================

-- Add vendor_bill_id FK
ALTER TABLE vendor_payments ADD COLUMN vendor_bill_id UUID REFERENCES vendor_bills(id);
CREATE INDEX idx_vendor_payments_bill ON vendor_payments(vendor_bill_id) WHERE vendor_bill_id IS NOT NULL;

-- Make PO link nullable for bill-centric payments and Zoho imports without PO
-- Must drop the NOT NULL constraint from purchase_order_id, po_date, days_from_po
ALTER TABLE vendor_payments ALTER COLUMN purchase_order_id DROP NOT NULL;
ALTER TABLE vendor_payments ALTER COLUMN po_date DROP NOT NULL;
ALTER TABLE vendor_payments ALTER COLUMN days_from_po DROP NOT NULL;

-- Add bill-centric days tracking
ALTER TABLE vendor_payments ADD COLUMN days_from_bill INT;

-- Row-level CHECK: one of (purchase_order_id, vendor_bill_id) must be set
ALTER TABLE vendor_payments ADD CONSTRAINT vendor_payments_has_link
  CHECK (purchase_order_id IS NOT NULL OR vendor_bill_id IS NOT NULL);

-- GST treatment fields on invoices for sync payload construction
ALTER TABLE invoices ADD COLUMN zoho_customer_gst_treatment TEXT;

-- ============================================================================
-- Section 7: vendors.udyam_* (matches Zoho's MSME/Udyam fields)
-- ============================================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS udyam_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS udyam_type   TEXT;

COMMIT;
