-- Migration 084: allow NULL project_id on purchase_orders + invoices (Zoho import rows only)
-- Context: re-architecting Zoho import phases 07 and 08 (data accuracy pass 2026-04-19).
-- Zoho Project IDs sometimes don't resolve to an ERP project (legacy Zoho-only projects,
-- advance-issue invoices, etc.). Instead of skipping those rows we want to import them
-- with project_id = NULL so "all money received" + "vendor spend" totals remain complete,
-- even when the per-project attribution isn't possible.
--
-- Guard rails: ERP-issued rows (source='erp') still require project_id.

ALTER TABLE purchase_orders ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN project_id DROP NOT NULL;

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
