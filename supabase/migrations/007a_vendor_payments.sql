-- ============================================================
-- Migration 007a — Vendor Payments
-- File: supabase/migrations/007a_vendor_payments.sql
-- Description: Individual vendor payment records for MSME
--              compliance, audit trail, and cash position accuracy.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS vendor_payments CASCADE;
-- Dependencies: 004b_projects_procurement.sql
-- ============================================================

BEGIN;

CREATE TABLE vendor_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  project_id            UUID NOT NULL REFERENCES projects(id),
  vendor_id             UUID NOT NULL REFERENCES vendors(id),
  recorded_by           UUID NOT NULL REFERENCES employees(id),

  amount                NUMERIC(14,2) NOT NULL,
  payment_date          DATE NOT NULL,
  payment_method        TEXT NOT NULL CHECK (payment_method IN (
    'bank_transfer', 'upi', 'cheque', 'cash', 'dd'
  )),
  payment_reference     TEXT,
  -- UTR, cheque number, DD number etc.
  bank_name             TEXT,
  cheque_date           DATE,
  -- Populated for cheque payments.

  -- MSME compliance fields
  po_date               DATE NOT NULL,
  days_from_po          INT NOT NULL,
  -- payment_date - po_date. Stored explicitly for fast queries.
  -- System alerts on Day 40 for MSME vendors.
  msme_compliant        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Set FALSE automatically when days_from_po > 45 AND vendor is_msme = TRUE.

  bill_clearing_package_id UUID REFERENCES bill_clearing_packages(id),
  -- Links payment to the bill clearing package it settled.

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at. Tier 3.
);

CREATE INDEX idx_vendor_payments_po       ON vendor_payments(purchase_order_id);
CREATE INDEX idx_vendor_payments_project  ON vendor_payments(project_id);
CREATE INDEX idx_vendor_payments_vendor   ON vendor_payments(vendor_id);
CREATE INDEX idx_vendor_payments_date     ON vendor_payments(payment_date DESC);
CREATE INDEX idx_vendor_payments_msme     ON vendor_payments(msme_compliant)
  WHERE msme_compliant = FALSE;

-- Trigger: update purchase_orders.amount_paid when vendor_payment inserted
-- Keeps PO running total in sync with individual payment records.
CREATE OR REPLACE FUNCTION update_po_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE purchase_orders SET
    amount_paid        = (
      SELECT COALESCE(SUM(amount), 0)
      FROM vendor_payments
      WHERE purchase_order_id = NEW.purchase_order_id
    ),
    amount_outstanding = total_amount - (
      SELECT COALESCE(SUM(amount), 0)
      FROM vendor_payments
      WHERE purchase_order_id = NEW.purchase_order_id
    ),
    updated_at         = NOW()
  WHERE id = NEW.purchase_order_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_po_amount_paid
  AFTER INSERT ON vendor_payments
  FOR EACH ROW EXECUTE FUNCTION update_po_amount_paid();

ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendor_payments_read"
  ON vendor_payments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN
      ('founder', 'finance', 'project_manager')
  );

CREATE POLICY "vendor_payments_insert"
  ON vendor_payments FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'finance')
  );

COMMIT;