-- Migration 084: allow NULL project_id on Zoho-imported finance rows.
-- Context: re-architecting Zoho import phases 07-11 (data accuracy pass 2026-04-19).
-- Zoho Project IDs often don't resolve to an ERP project (legacy Zoho-only projects,
-- advance-issue invoices, payments against invoices whose project never linked, etc.).
-- Instead of dropping 60%+ of money-movement rows during import we accept NULL project_id
-- for source='zoho_import' and keep ERP integrity via a CHECK constraint.
--
-- Applies to: purchase_orders, invoices, customer_payments, vendor_payments.
-- (expenses.project_id and vendor_bills.project_id were already nullable.)
--
-- Guard rails: ERP-issued rows (source='erp') still require project_id.

ALTER TABLE purchase_orders ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE customer_payments ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE vendor_payments ALTER COLUMN project_id DROP NOT NULL;

-- ERP-source rows must still have a project.
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_project_required_for_erp;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_project_required_for_erp
  CHECK (source <> 'erp' OR project_id IS NOT NULL);

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_project_required_for_erp;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_project_required_for_erp
  CHECK (source <> 'erp' OR project_id IS NOT NULL);

ALTER TABLE customer_payments
  DROP CONSTRAINT IF EXISTS customer_payments_project_required_for_erp;
ALTER TABLE customer_payments
  ADD CONSTRAINT customer_payments_project_required_for_erp
  CHECK (source <> 'erp' OR project_id IS NOT NULL);

ALTER TABLE vendor_payments
  DROP CONSTRAINT IF EXISTS vendor_payments_project_required_for_erp;
ALTER TABLE vendor_payments
  ADD CONSTRAINT vendor_payments_project_required_for_erp
  CHECK (source <> 'erp' OR project_id IS NOT NULL);
