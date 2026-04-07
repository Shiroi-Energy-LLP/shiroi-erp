-- Migration 023: Expand BOM item categories for accurate solar component tracking
-- Applied: 2026-04-07
-- Purpose: The original 15 categories were too narrow for real costing sheet data.
--   Real BOM sheets distinguish LT/HT panels, transformers, bus ducts, lightning
--   arrestors, connectors, junction boxes, monitoring devices, etc.
--   Both proposal_bom_lines and purchase_order_items need the same categories
--   for actual-vs-budget comparison.

ALTER TABLE proposal_bom_lines DROP CONSTRAINT proposal_bom_lines_item_category_check;

ALTER TABLE proposal_bom_lines ADD CONSTRAINT proposal_bom_lines_item_category_check
  CHECK (item_category = ANY (ARRAY[
    -- Original categories
    'panel', 'inverter', 'battery', 'structure', 'dc_cable', 'ac_cable',
    'conduit', 'earthing', 'acdb', 'dcdb', 'net_meter',
    'civil_work', 'installation_labour', 'transport', 'other',
    -- New categories from real costing sheet analysis
    'ht_cable',           -- HT cables (distinct from AC cables, different spec/cost)
    'lt_panel',           -- LT switchgear panels
    'ht_panel',           -- HT switchgear panels
    'transformer',        -- Inverter duty transformers (large commercial projects)
    'bus_duct',           -- Bus duct from LT panel to transformer
    'lightning_arrestor', -- Lightning arrestors and surge protection
    'connector',          -- MC4 connectors and cable connectors
    'junction_box',       -- Array junction boxes (AJB/MJB)
    'monitoring',         -- Data loggers, SCADA, monitoring devices
    'safety_equipment',   -- Fire extinguishers, safety gear
    'liaison'             -- Liaison work (CEIG, DISCOM, net metering applications)
  ]));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_items_item_category_check'
  ) THEN
    ALTER TABLE purchase_order_items DROP CONSTRAINT purchase_order_items_item_category_check;
    ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_item_category_check
      CHECK (item_category = ANY (ARRAY[
        'panel', 'inverter', 'battery', 'structure', 'dc_cable', 'ac_cable',
        'conduit', 'earthing', 'acdb', 'dcdb', 'net_meter',
        'civil_work', 'installation_labour', 'transport', 'other',
        'ht_cable', 'lt_panel', 'ht_panel', 'transformer', 'bus_duct',
        'lightning_arrestor', 'connector', 'junction_box', 'monitoring',
        'safety_equipment', 'liaison'
      ]));
  END IF;
END $$;
