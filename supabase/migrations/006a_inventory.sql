-- ============================================================
-- Migration 006a — Stock & Inventory
-- File: supabase/migrations/006a_inventory.sql
-- Description: Stock pieces, warranty registries, replacement
--              history, price book accuracy, RFQ management,
--              subcontractor work orders, letters of intent.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS letters_of_intent CASCADE;
--   DROP TABLE IF EXISTS subcontractor_work_orders CASCADE;
--   DROP TABLE IF EXISTS rfq_responses CASCADE;
--   DROP TABLE IF EXISTS rfq_requests CASCADE;
--   DROP TABLE IF EXISTS price_book_accuracy CASCADE;
--   DROP TABLE IF EXISTS stock_replacement_history CASCADE;
--   DROP TABLE IF EXISTS warranty_claims CASCADE;
--   DROP TABLE IF EXISTS warranty_registrations CASCADE;
--   DROP TABLE IF EXISTS stock_pieces CASCADE;
-- Dependencies: 001_foundation.sql, 002a_leads_core.sql,
--               004a_projects_core.sql, 004b_projects_procurement.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. stock_pieces
-- Every physical item tracked individually.
-- Not just total quantities — individual serial numbers.
-- Cut-length materials tracked by current_length.
-- Below minimum_usable_length → auto-flag scrap.
-- ------------------------------------------------------------
CREATE TABLE stock_pieces (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Origin
  purchase_order_id       UUID REFERENCES purchase_orders(id),
  dc_item_id              UUID REFERENCES vendor_delivery_challan_items(id),
  grn_id                  UUID REFERENCES goods_receipt_notes(id),

  -- Item details
  item_category           TEXT NOT NULL CHECK (item_category IN (
    'panel', 'inverter', 'battery', 'structure',
    'dc_cable', 'ac_cable', 'conduit', 'earthing',
    'acdb', 'dcdb', 'net_meter', 'other'
  )),
  item_description        TEXT NOT NULL,
  brand                   TEXT,
  model                   TEXT,
  serial_number           TEXT UNIQUE,
  -- NULL for non-serialised items (cable, conduit etc.)

  -- Cut-length tracking (cable, conduit)
  is_cut_length           BOOLEAN NOT NULL DEFAULT FALSE,
  original_length_m       NUMERIC(8,2),
  current_length_m        NUMERIC(8,2),
  minimum_usable_length_m NUMERIC(8,2),
  -- Below this → is_scrap = TRUE automatically.

  -- Location
  current_location        TEXT NOT NULL CHECK (current_location IN (
    'warehouse', 'in_transit', 'on_site', 'installed', 'scrapped', 'returned'
  )),
  project_id              UUID REFERENCES projects(id),
  -- Populated when item is allocated to a project.
  warehouse_location      TEXT,
  -- Shelf/bin reference in warehouse.

  -- Status
  condition               TEXT NOT NULL DEFAULT 'new' CHECK (condition IN (
    'new', 'good', 'damaged', 'faulty', 'scrapped'
  )),
  is_scrap                BOOLEAN NOT NULL DEFAULT FALSE,
  scrapped_at             TIMESTAMPTZ,
  scrap_reason            TEXT,

  -- Installation record
  installed_at_project_id UUID REFERENCES projects(id),
  installed_at            TIMESTAMPTZ,
  installed_by            UUID REFERENCES employees(id),

  -- Pricing
  unit_cost               NUMERIC(14,2),
  -- From the purchase order line.

  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER stock_pieces_updated_at
  BEFORE UPDATE ON stock_pieces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_stock_pieces_category  ON stock_pieces(item_category);
CREATE INDEX idx_stock_pieces_location  ON stock_pieces(current_location);
CREATE INDEX idx_stock_pieces_project   ON stock_pieces(project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX idx_stock_pieces_serial    ON stock_pieces(serial_number)
  WHERE serial_number IS NOT NULL;
CREATE INDEX idx_stock_pieces_scrap     ON stock_pieces(is_scrap)
  WHERE is_scrap = TRUE;
CREATE INDEX idx_stock_pieces_warehouse ON stock_pieces(current_location)
  WHERE current_location = 'warehouse';


-- ------------------------------------------------------------
-- 2. warranty_registrations
-- Warranty chain: serial number → purchase invoice →
-- signed DC → commissioning report.
-- Digital warranty card for every serialised item.
-- ------------------------------------------------------------
CREATE TABLE warranty_registrations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_piece_id          UUID NOT NULL UNIQUE REFERENCES stock_pieces(id),
  project_id              UUID NOT NULL REFERENCES projects(id),
  commissioning_report_id UUID REFERENCES commissioning_reports(id),

  -- Item identity
  item_category           TEXT NOT NULL,
  brand                   TEXT NOT NULL,
  model                   TEXT NOT NULL,
  serial_number           TEXT NOT NULL,

  -- Warranty terms
  warranty_type           TEXT NOT NULL CHECK (warranty_type IN (
    'product_warranty',
    'performance_warranty',
    'installation_warranty'
  )),
  warranty_years          INT NOT NULL,
  warranty_start_date     DATE NOT NULL,
  warranty_end_date       DATE NOT NULL,
  warrantor               TEXT NOT NULL CHECK (warrantor IN (
    'manufacturer', 'shiroi', 'both'
  )),

  -- Document chain
  purchase_invoice_number TEXT,
  purchase_invoice_path   TEXT,
  signed_dc_path          TEXT,
  warranty_card_path      TEXT,
  -- Physical warranty card scan if available.

  -- Status
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  is_expired              BOOLEAN NOT NULL DEFAULT FALSE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER warranty_registrations_updated_at
  BEFORE UPDATE ON warranty_registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_warranty_reg_project ON warranty_registrations(project_id);
CREATE INDEX idx_warranty_reg_serial  ON warranty_registrations(serial_number);
CREATE INDEX idx_warranty_reg_expiry  ON warranty_registrations(warranty_end_date)
  WHERE is_expired = FALSE;


-- ------------------------------------------------------------
-- 3. warranty_claims
-- Claim raised against a warranty registration.
-- Tracks manufacturer claim process end-to-end.
-- ------------------------------------------------------------
CREATE TABLE warranty_claims (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_registration_id  UUID NOT NULL REFERENCES warranty_registrations(id),
  project_id                UUID NOT NULL REFERENCES projects(id),
  om_ticket_id              UUID REFERENCES om_service_tickets(id),
  raised_by                 UUID NOT NULL REFERENCES employees(id),

  claim_number              TEXT NOT NULL UNIQUE,
  -- Format: WC-PROJ-087-001

  claim_type                TEXT NOT NULL CHECK (claim_type IN (
    'product_defect', 'performance_below_guarantee',
    'physical_damage', 'battery_soh', 'other'
  )),

  description               TEXT NOT NULL,
  claimed_on                DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Manufacturer response
  submitted_to_manufacturer BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at              DATE,
  manufacturer_claim_ref    TEXT,
  manufacturer_response     TEXT CHECK (manufacturer_response IN (
    'pending', 'approved', 'rejected', 'partial'
  )),
  manufacturer_responded_at DATE,

  -- Resolution
  replacement_provided      BOOLEAN NOT NULL DEFAULT FALSE,
  replacement_stock_piece_id UUID REFERENCES stock_pieces(id),
  resolution_notes          TEXT,
  resolved_at               DATE,

  claim_document_path       TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER warranty_claims_updated_at
  BEFORE UPDATE ON warranty_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_warranty_claims_project ON warranty_claims(project_id);
CREATE INDEX idx_warranty_claims_pending ON warranty_claims(manufacturer_response)
  WHERE manufacturer_response = 'pending' OR manufacturer_response IS NULL;


-- ------------------------------------------------------------
-- 4. stock_replacement_history
-- When a faulty item is replaced, logged here.
-- Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE stock_replacement_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_piece_id     UUID NOT NULL REFERENCES stock_pieces(id),
  replacement_piece_id  UUID NOT NULL REFERENCES stock_pieces(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  warranty_claim_id     UUID REFERENCES warranty_claims(id),
  replaced_by           UUID NOT NULL REFERENCES employees(id),

  replacement_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  replacement_reason    TEXT NOT NULL CHECK (replacement_reason IN (
    'warranty_claim', 'damage', 'upgrade', 'theft', 'other'
  )),
  cost_borne_by         TEXT NOT NULL CHECK (cost_borne_by IN (
    'manufacturer', 'shiroi', 'customer'
  )),
  replacement_cost      NUMERIC(14,2) NOT NULL DEFAULT 0,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_replacement_history_project ON stock_replacement_history(project_id);
CREATE INDEX idx_replacement_history_original ON stock_replacement_history(original_piece_id);


-- ------------------------------------------------------------
-- 5. price_book_accuracy
-- Tracks actual vs book price per purchase.
-- When actual diverges >5% on 3+ purchases →
-- update_recommended flag on price_book.
-- Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE price_book_accuracy (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_id         UUID NOT NULL REFERENCES price_book(id),
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id),
  po_item_id            UUID NOT NULL REFERENCES purchase_order_items(id),

  book_price            NUMERIC(14,2) NOT NULL,
  actual_price          NUMERIC(14,2) NOT NULL,
  variance_pct          NUMERIC(5,2) NOT NULL,
  -- ((actual - book) / book) * 100
  exceeds_threshold     BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE when ABS(variance_pct) > 5.

  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_pba_price_book ON price_book_accuracy(price_book_id);
CREATE INDEX idx_pba_exceeds    ON price_book_accuracy(price_book_id)
  WHERE exceeds_threshold = TRUE;


-- ------------------------------------------------------------
-- 6. rfq_requests
-- Request for quotation sent to multiple vendors
-- before raising a purchase order.
-- ------------------------------------------------------------
CREATE TABLE rfq_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id),
  raised_by             UUID NOT NULL REFERENCES employees(id),

  rfq_number            TEXT NOT NULL UNIQUE,
  -- Format: RFQ-PROJ-087-001

  item_category         TEXT NOT NULL,
  description           TEXT NOT NULL,
  quantity              NUMERIC(10,3) NOT NULL,
  unit                  TEXT NOT NULL,
  required_by_date      DATE,

  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'responses_received', 'vendor_selected', 'cancelled'
  )),
  selected_vendor_id    UUID REFERENCES vendors(id),
  selected_po_id        UUID REFERENCES purchase_orders(id),

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER rfq_requests_updated_at
  BEFORE UPDATE ON rfq_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_rfq_requests_project ON rfq_requests(project_id);
CREATE INDEX idx_rfq_requests_status  ON rfq_requests(status);


-- ------------------------------------------------------------
-- 7. rfq_responses
-- Vendor quotes received in response to an RFQ.
-- Immutable once recorded — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE rfq_responses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id                UUID NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
  vendor_id             UUID NOT NULL REFERENCES vendors(id),

  quoted_price          NUMERIC(14,2) NOT NULL,
  quoted_unit           TEXT NOT NULL,
  lead_time_days        INT,
  validity_days         INT,
  gst_included          BOOLEAN NOT NULL DEFAULT FALSE,
  notes                 TEXT,

  quote_document_path   TEXT,
  is_selected           BOOLEAN NOT NULL DEFAULT FALSE,

  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_rfq_responses_rfq    ON rfq_responses(rfq_id);
CREATE INDEX idx_rfq_responses_vendor ON rfq_responses(vendor_id);


-- ------------------------------------------------------------
-- 8. subcontractor_work_orders
-- Labour contractor engagement documents.
-- Raised per project per scope of work.
-- ------------------------------------------------------------
CREATE TABLE subcontractor_work_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  vendor_id             UUID NOT NULL REFERENCES vendors(id),
  -- vendor_type = 'labour_contractor'
  raised_by             UUID NOT NULL REFERENCES employees(id),

  work_order_number     TEXT NOT NULL UNIQUE,
  -- Format: WO-PROJ-087-001

  scope_of_work         TEXT NOT NULL,
  -- Description of what labour contractor must do.

  start_date            DATE,
  end_date              DATE,

  -- Financials
  agreed_amount         NUMERIC(14,2) NOT NULL,
  amount_paid           NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_outstanding    NUMERIC(14,2) NOT NULL DEFAULT 0,

  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'sent', 'accepted', 'in_progress', 'completed', 'cancelled'
  )),

  pdf_storage_path      TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER work_orders_updated_at
  BEFORE UPDATE ON subcontractor_work_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_work_orders_project ON subcontractor_work_orders(project_id);
CREATE INDEX idx_work_orders_vendor  ON subcontractor_work_orders(vendor_id);
CREATE INDEX idx_work_orders_status  ON subcontractor_work_orders(status);


-- ------------------------------------------------------------
-- 9. letters_of_intent
-- Pre-PO vendor commitments for large orders.
-- Immutable once issued — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE letters_of_intent (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id),
  vendor_id             UUID NOT NULL REFERENCES vendors(id),
  issued_by             UUID NOT NULL REFERENCES employees(id),

  loi_number            TEXT NOT NULL UNIQUE,
  -- Format: LOI-PROJ-087-001

  description           TEXT NOT NULL,
  estimated_value       NUMERIC(14,2) NOT NULL,
  validity_date         DATE NOT NULL,

  -- Conversion
  converted_to_po       BOOLEAN NOT NULL DEFAULT FALSE,
  po_id                 UUID REFERENCES purchase_orders(id),
  converted_at          TIMESTAMPTZ,

  pdf_storage_path      TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable once issued. No updated_at.
);

CREATE INDEX idx_loi_project ON letters_of_intent(project_id);
CREATE INDEX idx_loi_vendor  ON letters_of_intent(vendor_id);
CREATE INDEX idx_loi_pending ON letters_of_intent(converted_to_po)
  WHERE converted_to_po = FALSE;


-- ------------------------------------------------------------
-- RLS — inventory domain
-- ------------------------------------------------------------

ALTER TABLE stock_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_pieces_read"
  ON stock_pieces FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "stock_pieces_write"
  ON stock_pieces FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE warranty_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warranty_reg_read"
  ON warranty_registrations FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = warranty_registrations.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "warranty_reg_write"
  ON warranty_registrations FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warranty_claims_read"
  ON warranty_claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician', 'finance')
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = warranty_claims.project_id
        AND p.customer_profile_id = auth.uid()
    )
  );

CREATE POLICY "warranty_claims_write"
  ON warranty_claims FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

ALTER TABLE stock_replacement_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "replacement_history_read"
  ON stock_replacement_history FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "replacement_history_insert"
  ON stock_replacement_history FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'om_technician')
  );

ALTER TABLE price_book_accuracy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pba_read"
  ON price_book_accuracy FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
  );

CREATE POLICY "pba_insert"
  ON price_book_accuracy FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
  );

ALTER TABLE rfq_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfq_requests_read"
  ON rfq_requests FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "rfq_requests_write"
  ON rfq_requests FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE rfq_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfq_responses_read"
  ON rfq_responses FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "rfq_responses_insert"
  ON rfq_responses FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE subcontractor_work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_orders_read"
  ON subcontractor_work_orders FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "work_orders_write"
  ON subcontractor_work_orders FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE letters_of_intent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loi_read"
  ON letters_of_intent FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "loi_insert"
  ON letters_of_intent FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

COMMIT;