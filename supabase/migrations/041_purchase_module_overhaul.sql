-- Migration 041: Purchase Module Overhaul
-- Adds vendor assignment on BOQ items, links PO items back to BOQ items,
-- project-level procurement tracking, and fixes PO status constraint.

-- 1. Vendor FK on project_boq_items for proper vendor assignment per line item
ALTER TABLE project_boq_items ADD COLUMN vendor_id UUID REFERENCES vendors(id);
CREATE INDEX idx_boq_items_vendor ON project_boq_items(vendor_id) WHERE vendor_id IS NOT NULL;

-- 2. Link PO line items back to BOQ items for traceability
ALTER TABLE purchase_order_items ADD COLUMN boq_item_id UUID REFERENCES project_boq_items(id);

-- 3. Project-level procurement tracking
ALTER TABLE projects ADD COLUMN boq_sent_to_purchase_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN boq_sent_to_purchase_by UUID REFERENCES employees(id);
ALTER TABLE projects ADD COLUMN procurement_priority TEXT
  CHECK (procurement_priority IN ('high', 'medium')) DEFAULT 'medium';
ALTER TABLE projects ADD COLUMN procurement_status TEXT
  CHECK (procurement_status IN ('yet_to_place', 'order_placed', 'partially_received', 'received'));
ALTER TABLE projects ADD COLUMN procurement_received_date DATE;

-- 4. Fix PO status constraint: add 'approved' (used by UI but missing from DB)
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'approved', 'sent', 'acknowledged', 'partially_delivered', 'fully_delivered', 'closed', 'cancelled'));

-- 5. Indexes for purchase module queries
CREATE INDEX idx_boq_items_procurement_status ON project_boq_items(procurement_status)
  WHERE procurement_status IS NOT NULL AND procurement_status != 'yet_to_finalize';
CREATE INDEX idx_projects_procurement ON projects(procurement_status)
  WHERE procurement_status IS NOT NULL;

-- 6. Backfill: projects that already have BOQ items sent to purchase
UPDATE projects SET
  procurement_status = 'yet_to_place',
  boq_sent_to_purchase_at = NOW()
WHERE id IN (
  SELECT DISTINCT project_id FROM project_boq_items
  WHERE procurement_status != 'yet_to_finalize'
) AND boq_sent_to_purchase_at IS NULL;

-- Also mark projects with existing POs as order_placed
UPDATE projects SET
  procurement_status = 'order_placed',
  boq_sent_to_purchase_at = COALESCE(boq_sent_to_purchase_at, NOW())
WHERE id IN (
  SELECT DISTINCT project_id FROM purchase_orders WHERE status != 'cancelled'
) AND (procurement_status IS NULL OR procurement_status = 'yet_to_place');
