-- Migration 068: Finance V2 — Zoho lookup tables + reconciliation
-- See spec §5.1.
-- Note: no 'admin' role in app_role enum; using finance/founder only for admin tables.

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
  FOR ALL USING (get_my_role() IN ('finance','founder'))
  WITH CHECK (get_my_role() IN ('finance','founder'));

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
  FOR SELECT USING (get_my_role() IN ('finance','founder','purchase_officer'));
CREATE POLICY zoho_account_codes_mutate ON zoho_account_codes
  FOR INSERT WITH CHECK (get_my_role() IN ('finance','founder'));

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
  FOR SELECT USING (get_my_role() IN ('finance','founder','purchase_officer'));
CREATE POLICY zoho_tax_codes_mutate ON zoho_tax_codes
  FOR INSERT WITH CHECK (get_my_role() IN ('finance','founder'));

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
  FOR SELECT USING (get_my_role() IN ('finance','founder','purchase_officer'));
CREATE POLICY zoho_items_mutate ON zoho_items
  FOR INSERT WITH CHECK (get_my_role() IN ('finance','founder'));

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
  FOR ALL USING (get_my_role() IN ('finance','founder'))
  WITH CHECK (get_my_role() IN ('finance','founder'));

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
  -- Separate date column so the unique constraint can be a plain UNIQUE (no function index)
  discovered_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES employees(id),
  resolution_notes TEXT,
  -- One row per entity/metric/day
  UNIQUE (entity_type, entity_ref, metric, discovered_date)
);

CREATE INDEX idx_reconciliation_open ON reconciliation_discrepancies(discovered_at) WHERE status = 'open';

ALTER TABLE reconciliation_discrepancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_all ON reconciliation_discrepancies
  FOR ALL USING (get_my_role() IN ('finance','founder'))
  WITH CHECK (get_my_role() IN ('finance','founder'));

COMMIT;
