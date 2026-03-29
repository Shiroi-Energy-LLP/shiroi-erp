-- ============================================================
-- Migration 004b — QC Gates + Procurement
-- File: supabase/migrations/004b_projects_procurement.sql
-- Description: QC gate inspections, non-conformance reports,
--              purchase orders, PO amendments, vendor delivery
--              challans, DC signatures, GRN, bill clearing
--              packages, and three-way match.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS bill_clearing_packages CASCADE;
--   DROP TABLE IF EXISTS three_way_match CASCADE;
--   DROP TABLE IF EXISTS grn_items CASCADE;
--   DROP TABLE IF EXISTS goods_receipt_notes CASCADE;
--   DROP TABLE IF EXISTS dc_signatures CASCADE;
--   DROP TABLE IF EXISTS vendor_delivery_challan_items CASCADE;
--   DROP TABLE IF EXISTS vendor_delivery_challans CASCADE;
--   DROP TABLE IF EXISTS purchase_order_amendments CASCADE;
--   DROP TABLE IF EXISTS purchase_order_items CASCADE;
--   DROP TABLE IF EXISTS purchase_orders CASCADE;
--   DROP TABLE IF EXISTS qc_non_conformance_reports CASCADE;
--   DROP TABLE IF EXISTS qc_gate_inspections CASCADE;
-- Dependencies: 001_foundation.sql, 002a_leads_core.sql,
--               004a_projects_core.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. qc_gate_inspections
-- Three QC gates that are also payment gates.
-- Gate 1: Materials QC → unlocks delivery invoice (40%)
-- Gate 2: Mid-installation PM visit → allows electrical work
-- Gate 3: Pre-commissioning QC → unlocks commissioning (20%)
-- Immutable once passed — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE qc_gate_inspections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  milestone_id        UUID NOT NULL REFERENCES project_milestones(id),

  gate_number         INT NOT NULL CHECK (gate_number IN (1, 2, 3)),
  inspected_by        UUID NOT NULL REFERENCES employees(id),
  inspection_date     DATE NOT NULL,

  -- Checklist results (stored as JSONB for flexibility)
  -- Each gate has a different checklist. See Master Reference.
  checklist_items     JSONB NOT NULL DEFAULT '[]',
  -- Array of {item, passed, notes} objects.

  overall_result      TEXT NOT NULL CHECK (overall_result IN (
    'passed', 'failed', 'conditional_pass'
  )),
  -- conditional_pass: minor issues noted but work can proceed.

  failure_notes       TEXT,
  -- Required if overall_result = 'failed'.
  conditional_notes   TEXT,
  -- Required if overall_result = 'conditional_pass'.

  -- Payment gate unlock
  payment_gate_unlocked     BOOLEAN NOT NULL DEFAULT FALSE,
  payment_gate_unlocked_at  TIMESTAMPTZ,
  -- Set to TRUE only when overall_result = 'passed' or
  -- 'conditional_pass' and PM confirms.

  -- Re-inspection (if failed)
  requires_reinspection     BOOLEAN NOT NULL DEFAULT FALSE,
  reinspection_of_id        UUID REFERENCES qc_gate_inspections(id),
  -- Links to the failed inspection this is re-inspecting.

  pdf_storage_path    TEXT,
  photos_storage_path TEXT[],

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable once created. No updated_at.
);

CREATE INDEX idx_qc_gates_project ON qc_gate_inspections(project_id);
CREATE INDEX idx_qc_gates_number  ON qc_gate_inspections(project_id, gate_number);


-- ------------------------------------------------------------
-- 2. qc_non_conformance_reports
-- Raised when QC gate fails. Tracks corrective action.
-- Tier 2 — correction by new record after PM sign-off.
-- ------------------------------------------------------------
CREATE TABLE qc_non_conformance_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_inspection_id    UUID NOT NULL REFERENCES qc_gate_inspections(id),
  project_id          UUID NOT NULL REFERENCES projects(id),
  raised_by           UUID NOT NULL REFERENCES employees(id),

  ncr_number          TEXT NOT NULL UNIQUE,
  -- Format: NCR-PROJ-087-001

  issue_description   TEXT NOT NULL,
  root_cause          TEXT,
  corrective_action   TEXT NOT NULL,

  assigned_to         UUID REFERENCES employees(id),
  due_date            DATE,

  resolved            BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by         UUID REFERENCES employees(id),
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT,

  pdf_storage_path    TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER qc_ncr_updated_at
  BEFORE UPDATE ON qc_non_conformance_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_ncr_project ON qc_non_conformance_reports(project_id);
CREATE INDEX idx_ncr_open    ON qc_non_conformance_reports(project_id)
  WHERE resolved = FALSE;


-- ------------------------------------------------------------
-- 3. purchase_orders
-- Every PO raised by Shiroi to a vendor.
-- Immutable once sent to vendor — Tier 3.
-- Soft block: no PO before advance received
-- (PM override available, logged).
-- MSME vendors: 45-day payment cap enforced.
-- ------------------------------------------------------------
CREATE TABLE purchase_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  vendor_id             UUID NOT NULL REFERENCES vendors(id),
  prepared_by           UUID NOT NULL REFERENCES employees(id),
  approved_by           UUID REFERENCES employees(id),

  po_number             TEXT NOT NULL UNIQUE,
  -- Format: SHIROI/PO/2025-26/0234

  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'sent', 'acknowledged', 'partially_delivered',
    'fully_delivered', 'closed', 'cancelled'
  )),

  -- Advance block override
  advance_block_overridden    BOOLEAN NOT NULL DEFAULT FALSE,
  advance_block_override_by   UUID REFERENCES employees(id),
  advance_block_override_note TEXT,
  -- PM must confirm override. Logged here permanently.

  -- Dates
  po_date               DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  actual_delivery_date  DATE,

  -- Payment terms
  payment_terms_days    INT NOT NULL DEFAULT 30,
  payment_due_date      DATE,
  -- Computed: po_date + payment_terms_days.
  -- MSME cap enforced: max 45 days regardless of terms.

  -- Financials
  subtotal              NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid           NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_outstanding    NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Letter of intent
  loi_issued            BOOLEAN NOT NULL DEFAULT FALSE,
  loi_issued_at         TIMESTAMPTZ,
  loi_storage_path      TEXT,

  pdf_storage_path      TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE po_number_seq START 1;

CREATE INDEX idx_po_project   ON purchase_orders(project_id);
CREATE INDEX idx_po_vendor    ON purchase_orders(vendor_id);
CREATE INDEX idx_po_status    ON purchase_orders(status);
CREATE INDEX idx_po_payment   ON purchase_orders(payment_due_date)
  WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX idx_po_msme      ON purchase_orders(payment_due_date, vendor_id)
  WHERE status NOT IN ('closed', 'cancelled');


-- ------------------------------------------------------------
-- 4. purchase_order_items
-- Line items on each PO. Linked to price_book where possible.
-- ------------------------------------------------------------
CREATE TABLE purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  price_book_id     UUID REFERENCES price_book(id),
  -- NULL if item not in price book.

  line_number       INT NOT NULL,
  item_category     TEXT NOT NULL,
  item_description  TEXT NOT NULL,
  brand             TEXT,
  model             TEXT,
  hsn_code          TEXT,
  unit              TEXT NOT NULL,

  quantity_ordered  NUMERIC(10,3) NOT NULL,
  quantity_delivered NUMERIC(10,3) NOT NULL DEFAULT 0,
  -- Updated as DCs are received.
  quantity_pending  NUMERIC(10,3) NOT NULL DEFAULT 0,
  -- quantity_ordered - quantity_delivered. Stored explicitly.

  unit_price        NUMERIC(14,2) NOT NULL,
  total_price       NUMERIC(14,2) NOT NULL,
  gst_rate          NUMERIC(5,2) NOT NULL,
  gst_amount        NUMERIC(14,2) NOT NULL,

  -- Price book variance tracking
  price_book_price  NUMERIC(14,2),
  price_variance_pct NUMERIC(5,2),
  -- ((unit_price - price_book_price) / price_book_price) * 100

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER po_items_updated_at
  BEFORE UPDATE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id, line_number);


-- ------------------------------------------------------------
-- 5. purchase_order_amendments
-- Changes to a sent PO. Immutable log — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE purchase_order_amendments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  amended_by            UUID NOT NULL REFERENCES employees(id),

  amendment_number      INT NOT NULL,
  -- 1, 2, 3 etc. per PO.
  description           TEXT NOT NULL,

  previous_total        NUMERIC(14,2) NOT NULL,
  new_total             NUMERIC(14,2) NOT NULL,

  pdf_storage_path      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_po_amendments_po ON purchase_order_amendments(purchase_order_id);


-- ------------------------------------------------------------
-- 6. vendor_delivery_challans
-- DC received from vendor with each delivery.
-- Matched against PO (three-way match with GRN).
-- ------------------------------------------------------------
CREATE TABLE vendor_delivery_challans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  vendor_id             UUID NOT NULL REFERENCES vendors(id),
  received_by           UUID NOT NULL REFERENCES employees(id),

  vendor_dc_number      TEXT NOT NULL,
  -- Vendor's own DC reference number.
  vendor_dc_date        DATE NOT NULL,
  received_date         DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Vehicle details
  vehicle_number        TEXT,
  driver_name           TEXT,

  -- Status
  status                TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'inspected', 'accepted', 'partially_rejected', 'rejected'
  )),

  rejection_notes       TEXT,

  -- Signature
  signed_by_name        TEXT,
  signed_at             TIMESTAMPTZ,
  signed_dc_storage_path TEXT,
  -- Scanned signed DC uploaded here.

  pdf_storage_path      TEXT,
  -- Original vendor DC PDF.

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER vendor_dc_updated_at
  BEFORE UPDATE ON vendor_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vendor_dc_po      ON vendor_delivery_challans(purchase_order_id);
CREATE INDEX idx_vendor_dc_project ON vendor_delivery_challans(project_id);


-- ------------------------------------------------------------
-- 7. vendor_delivery_challan_items
-- Line items on each vendor DC. Matched against PO items.
-- ------------------------------------------------------------
CREATE TABLE vendor_delivery_challan_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_dc_id          UUID NOT NULL REFERENCES vendor_delivery_challans(id) ON DELETE CASCADE,
  po_item_id            UUID REFERENCES purchase_order_items(id),
  -- NULL if DC item cannot be matched to a PO item (exception).

  item_description      TEXT NOT NULL,
  unit                  TEXT NOT NULL,
  quantity_delivered    NUMERIC(10,3) NOT NULL,
  unit_price            NUMERIC(14,2),

  -- Serial numbers for trackable items
  serial_numbers        TEXT[],
  -- Array of serial numbers for panels, inverters, batteries.

  condition_on_arrival  TEXT CHECK (condition_on_arrival IN (
    'good', 'damaged', 'partially_damaged'
  )),
  damage_notes          TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dc_items_dc ON vendor_delivery_challan_items(vendor_dc_id);


-- ------------------------------------------------------------
-- 8. dc_signatures
-- Tracks who signed each delivery challan and when.
-- Immutable — Tier 3. Legal record.
-- ------------------------------------------------------------
CREATE TABLE dc_signatures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_dc_id        UUID NOT NULL REFERENCES vendor_delivery_challans(id),
  signed_by_employee  UUID REFERENCES employees(id),

  signer_name         TEXT NOT NULL,
  signer_designation  TEXT,
  signed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  signature_method    TEXT NOT NULL CHECK (signature_method IN (
    'physical_scan', 'drawn_on_device', 'otp_verified'
  )),
  signature_image_path TEXT,
  -- Path to signature image in Supabase Storage.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_dc_signatures_dc ON dc_signatures(vendor_dc_id);


-- ------------------------------------------------------------
-- 9. goods_receipt_notes
-- GRN created after physical inspection of received goods.
-- Part of three-way match: PO ↔ DC ↔ GRN.
-- ------------------------------------------------------------
CREATE TABLE goods_receipt_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_dc_id          UUID NOT NULL REFERENCES vendor_delivery_challans(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  inspected_by          UUID NOT NULL REFERENCES employees(id),

  grn_number            TEXT NOT NULL UNIQUE,
  -- Format: GRN-PROJ-087-001
  inspection_date       DATE NOT NULL DEFAULT CURRENT_DATE,

  overall_status        TEXT NOT NULL CHECK (overall_status IN (
    'accepted', 'partially_accepted', 'rejected'
  )),

  accepted_quantity     NUMERIC(10,3) NOT NULL DEFAULT 0,
  rejected_quantity     NUMERIC(10,3) NOT NULL DEFAULT 0,
  rejection_reason      TEXT,

  photos_storage_path   TEXT[],

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER grn_updated_at
  BEFORE UPDATE ON goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_grn_dc      ON goods_receipt_notes(vendor_dc_id);
CREATE INDEX idx_grn_project ON goods_receipt_notes(project_id);


-- ------------------------------------------------------------
-- 10. grn_items
-- Line-level GRN details. Three-way match happens here.
-- ------------------------------------------------------------
CREATE TABLE grn_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id              UUID NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
  dc_item_id          UUID NOT NULL REFERENCES vendor_delivery_challan_items(id),
  po_item_id          UUID REFERENCES purchase_order_items(id),

  quantity_received   NUMERIC(10,3) NOT NULL,
  quantity_accepted   NUMERIC(10,3) NOT NULL,
  quantity_rejected   NUMERIC(10,3) NOT NULL DEFAULT 0,

  -- Three-way match result
  po_quantity         NUMERIC(10,3),
  dc_quantity         NUMERIC(10,3),
  grn_quantity        NUMERIC(10,3),
  match_status        TEXT CHECK (match_status IN (
    'matched', 'short_delivery', 'excess_delivery', 'mismatch'
  )),
  match_notes         TEXT,

  serial_numbers_verified TEXT[],
  -- Serial numbers confirmed during GRN inspection.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grn_items_grn ON grn_items(grn_id);


-- ------------------------------------------------------------
-- 11. three_way_match
-- Summary record of the three-way match per PO.
-- Exceptions flagged here for finance review.
-- ------------------------------------------------------------
CREATE TABLE three_way_match (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id),
  project_id          UUID NOT NULL REFERENCES projects(id),

  match_status        TEXT NOT NULL CHECK (match_status IN (
    'matched', 'exception', 'pending'
  )),

  po_total_qty        NUMERIC(10,3) NOT NULL,
  dc_total_qty        NUMERIC(10,3) NOT NULL,
  grn_total_qty       NUMERIC(10,3) NOT NULL,

  exception_notes     TEXT,
  -- Required if match_status = 'exception'.
  exception_resolved  BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by         UUID REFERENCES employees(id),
  resolved_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER three_way_match_updated_at
  BEFORE UPDATE ON three_way_match
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_twm_po      ON three_way_match(purchase_order_id);
CREATE INDEX idx_twm_project ON three_way_match(project_id);
CREATE INDEX idx_twm_except  ON three_way_match(match_status)
  WHERE match_status = 'exception' AND exception_resolved = FALSE;


-- ------------------------------------------------------------
-- 12. bill_clearing_packages
-- Bundle of documents submitted to finance for vendor
-- payment clearance. PO + DC + GRN + vendor invoice.
-- Immutable once submitted — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE bill_clearing_packages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id),
  project_id            UUID NOT NULL REFERENCES projects(id),
  submitted_by          UUID NOT NULL REFERENCES employees(id),

  package_number        TEXT NOT NULL UNIQUE,
  -- Format: BCP-PROJ-087-M1 (M1 = milestone 1)

  milestone_reference   TEXT,
  -- Which project milestone this payment relates to.

  -- Documents included
  po_included           BOOLEAN NOT NULL DEFAULT TRUE,
  dc_included           BOOLEAN NOT NULL DEFAULT FALSE,
  grn_included          BOOLEAN NOT NULL DEFAULT FALSE,
  vendor_invoice_included BOOLEAN NOT NULL DEFAULT FALSE,

  vendor_invoice_number TEXT,
  vendor_invoice_date   DATE,
  vendor_invoice_amount NUMERIC(14,2),
  vendor_invoice_storage_path TEXT,

  -- Approval
  approved_by_finance   UUID REFERENCES employees(id),
  approved_at           TIMESTAMPTZ,
  payment_released      BOOLEAN NOT NULL DEFAULT FALSE,
  payment_released_at   TIMESTAMPTZ,

  pdf_storage_path      TEXT,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable once submitted. No updated_at.
);

CREATE INDEX idx_bcp_po      ON bill_clearing_packages(purchase_order_id);
CREATE INDEX idx_bcp_project ON bill_clearing_packages(project_id);
CREATE INDEX idx_bcp_pending ON bill_clearing_packages(project_id)
  WHERE payment_released = FALSE;


-- ------------------------------------------------------------
-- RLS — QC and procurement tables
-- ------------------------------------------------------------

ALTER TABLE qc_gate_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qc_gates_read"
  ON qc_gate_inspections FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "qc_gates_insert"
  ON qc_gate_inspections FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE qc_non_conformance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ncr_read"
  ON qc_non_conformance_reports FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

CREATE POLICY "ncr_write"
  ON qc_non_conformance_reports FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_read"
  ON purchase_orders FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "po_write"
  ON purchase_orders FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_items_read"
  ON purchase_order_items FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "po_items_write"
  ON purchase_order_items FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE purchase_order_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_amendments_read"
  ON purchase_order_amendments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "po_amendments_insert"
  ON purchase_order_amendments FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

ALTER TABLE vendor_delivery_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendor_dc_read"
  ON vendor_delivery_challans FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "vendor_dc_write"
  ON vendor_delivery_challans FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE vendor_delivery_challan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dc_items_read"
  ON vendor_delivery_challan_items FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "dc_items_write"
  ON vendor_delivery_challan_items FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE dc_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dc_signatures_read"
  ON dc_signatures FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "dc_signatures_insert"
  ON dc_signatures FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE goods_receipt_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grn_read"
  ON goods_receipt_notes FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "grn_write"
  ON goods_receipt_notes FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE grn_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grn_items_read"
  ON grn_items FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor', 'finance')
  );

CREATE POLICY "grn_items_write"
  ON grn_items FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'site_supervisor')
  );

ALTER TABLE three_way_match ENABLE ROW LEVEL SECURITY;

CREATE POLICY "three_way_match_read"
  ON three_way_match FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "three_way_match_write"
  ON three_way_match FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

ALTER TABLE bill_clearing_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bcp_read"
  ON bill_clearing_packages FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager', 'finance')
  );

CREATE POLICY "bcp_insert"
  ON bill_clearing_packages FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'project_manager')
  );

COMMIT;