-- Migration 130: GST e-invoicing fields on invoices table
-- Tracks IRN (Invoice Reference Number) lifecycle for GSTN e-invoice API compliance.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ack_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ack_date TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS signed_qr_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS e_invoice_status TEXT
  CHECK (e_invoice_status IN ('not_required','pending','generated','cancelled','failed'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS e_invoice_error TEXT;

-- Index for status queries (finance module will filter by e_invoice_status)
CREATE INDEX IF NOT EXISTS idx_invoices_e_invoice_status ON invoices(e_invoice_status)
  WHERE e_invoice_status IS NOT NULL;
