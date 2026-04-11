-- Migration 037: Add hsn_code to delivery_challan_items and project_boq_items
-- Required for Delivery Challan PDF format (HSN Code column per Manivel's spec)

-- 1. Add hsn_code to delivery_challan_items
ALTER TABLE delivery_challan_items
  ADD COLUMN IF NOT EXISTS hsn_code TEXT;

-- 2. Add hsn_code to project_boq_items (source for DC items)
ALTER TABLE project_boq_items
  ADD COLUMN IF NOT EXISTS hsn_code TEXT;

-- 3. Backfill project_boq_items.hsn_code from linked proposal_bom_lines
UPDATE project_boq_items boq
SET hsn_code = bom.hsn_code
FROM proposal_bom_lines bom
WHERE boq.bom_line_id = bom.id
  AND bom.hsn_code IS NOT NULL
  AND boq.hsn_code IS NULL;

-- 4. Backfill delivery_challan_items.hsn_code from linked project_boq_items
UPDATE delivery_challan_items dci
SET hsn_code = boq.hsn_code
FROM project_boq_items boq
WHERE dci.boq_item_id = boq.id
  AND boq.hsn_code IS NOT NULL
  AND dci.hsn_code IS NULL;

-- 5. Add item_category to delivery_challan_items (preserve category from BOQ)
ALTER TABLE delivery_challan_items
  ADD COLUMN IF NOT EXISTS item_category TEXT;

-- 6. Backfill item_category from BOQ items
UPDATE delivery_challan_items dci
SET item_category = boq.item_category
FROM project_boq_items boq
WHERE dci.boq_item_id = boq.id
  AND dci.item_category IS NULL;

COMMENT ON COLUMN delivery_challan_items.hsn_code IS 'HSN/SAC code for the item, populated from BOQ/BOM data';
COMMENT ON COLUMN project_boq_items.hsn_code IS 'HSN/SAC code from price book or BOM lines';
COMMENT ON COLUMN delivery_challan_items.item_category IS 'Item category preserved from BOQ item at time of DC creation';
