-- Migration 057 — Category standardisation
-- Collapses legacy category values across 3 tables to Manivel's 15 vocabulary,
-- expands CHECK constraints on 2 legacy tables to accept the union (strategy C),
-- and adds a unique index for Price Book upsert on item_description + item_category.
--
-- Spec: docs/superpowers/specs/2026-04-15-category-standardisation-design.md
-- Ordering: must run BEFORE apps/erp/src/components/projects/forms/bom-line-form.tsx
-- starts writing Manivel values to proposal_bom_lines.
--
-- Applied via Supabase SQL Editor (dev first, prod after testing week).

BEGIN;

-- ============================================================================
-- 0. Drop ALL CHECK constraints up front
-- ----------------------------------------------------------------------------
-- Postgres validates CHECK constraints row-by-row DURING an UPDATE statement.
-- If we leave the old constraints in place while running the rewrite CASE
-- blocks below, the very first row that maps (say) 'solar_panel' → 'solar_panels'
-- gets rejected because 'solar_panels' is not in the old allowed-value list.
-- Consolidating the drops here keeps all 3 UPDATE statements safe; each section
-- below re-adds its own constraint after its UPDATE has finished. The inline
-- `DROP CONSTRAINT IF EXISTS` in each section becomes a harmless no-op and is
-- preserved for section-local readability.
-- ============================================================================

ALTER TABLE project_boq_items       DROP CONSTRAINT IF EXISTS project_boq_items_item_category_check;
ALTER TABLE price_book              DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE delivery_challan_items  DROP CONSTRAINT IF EXISTS delivery_challan_items_item_category_check;
ALTER TABLE proposal_bom_lines      DROP CONSTRAINT IF EXISTS proposal_bom_lines_item_category_check;
ALTER TABLE purchase_order_items    DROP CONSTRAINT IF EXISTS purchase_order_items_item_category_check;

-- ============================================================================
-- 1. project_boq_items — migrate legacy → Manivel 15
-- ============================================================================

UPDATE project_boq_items SET item_category = CASE item_category
  WHEN 'panel' THEN 'solar_panels'
  WHEN 'solar_panel' THEN 'solar_panels'
  WHEN 'structure' THEN 'mms'
  WHEN 'mounting_structure' THEN 'mms'
  WHEN 'dc_cable' THEN 'dc_accessories'
  WHEN 'dc_access' THEN 'dc_accessories'
  WHEN 'dcdb' THEN 'dc_accessories'
  WHEN 'connector' THEN 'dc_accessories'
  WHEN 'junction_box' THEN 'dc_accessories'
  WHEN 'ac_cable' THEN 'ac_accessories'
  WHEN 'acdb' THEN 'ac_accessories'
  WHEN 'lt_panel' THEN 'ac_accessories'
  WHEN 'ht_cable' THEN 'ac_accessories'
  WHEN 'ht_panel' THEN 'ac_accessories'
  WHEN 'transformer' THEN 'ac_accessories'
  WHEN 'bus_duct' THEN 'ac_accessories'
  WHEN 'conduit' THEN 'conduits'
  WHEN 'gi_cable_tray' THEN 'conduits'
  WHEN 'earthing' THEN 'earthing_accessories'
  WHEN 'earth_access' THEN 'earthing_accessories'
  WHEN 'lightning_arrestor' THEN 'earthing_accessories'
  WHEN 'safety_equipment' THEN 'safety_accessories'
  WHEN 'walkway' THEN 'safety_accessories'
  WHEN 'handrail' THEN 'safety_accessories'
  WHEN 'net_meter' THEN 'generation_meter'
  WHEN 'monitoring' THEN 'generation_meter'
  WHEN 'installation_labour' THEN 'ic'
  WHEN 'liaison' THEN 'statutory_approvals'
  WHEN 'transport' THEN 'transport_civil'
  WHEN 'civil_work' THEN 'transport_civil'
  WHEN 'other' THEN 'others'
  ELSE item_category
END;

ALTER TABLE project_boq_items DROP CONSTRAINT IF EXISTS project_boq_items_item_category_check;
ALTER TABLE project_boq_items ADD CONSTRAINT project_boq_items_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));

-- ============================================================================
-- 2. price_book — migrate legacy → Manivel 15 + dedup + upsert unique index
-- ============================================================================

UPDATE price_book SET item_category = CASE item_category
  WHEN 'panel' THEN 'solar_panels'
  WHEN 'solar_panel' THEN 'solar_panels'
  WHEN 'structure' THEN 'mms'
  WHEN 'mounting_structure' THEN 'mms'
  WHEN 'dc_cable' THEN 'dc_accessories'
  WHEN 'dc_access' THEN 'dc_accessories'
  WHEN 'dcdb' THEN 'dc_accessories'
  WHEN 'connector' THEN 'dc_accessories'
  WHEN 'junction_box' THEN 'dc_accessories'
  WHEN 'ac_cable' THEN 'ac_accessories'
  WHEN 'acdb' THEN 'ac_accessories'
  WHEN 'lt_panel' THEN 'ac_accessories'
  WHEN 'ht_cable' THEN 'ac_accessories'
  WHEN 'ht_panel' THEN 'ac_accessories'
  WHEN 'transformer' THEN 'ac_accessories'
  WHEN 'bus_duct' THEN 'ac_accessories'
  WHEN 'conduit' THEN 'conduits'
  WHEN 'gi_cable_tray' THEN 'conduits'
  WHEN 'earthing' THEN 'earthing_accessories'
  WHEN 'earth_access' THEN 'earthing_accessories'
  WHEN 'lightning_arrestor' THEN 'earthing_accessories'
  WHEN 'safety_equipment' THEN 'safety_accessories'
  WHEN 'walkway' THEN 'safety_accessories'
  WHEN 'handrail' THEN 'safety_accessories'
  WHEN 'net_meter' THEN 'generation_meter'
  WHEN 'monitoring' THEN 'generation_meter'
  WHEN 'installation_labour' THEN 'ic'
  WHEN 'liaison' THEN 'statutory_approvals'
  WHEN 'transport' THEN 'transport_civil'
  WHEN 'civil_work' THEN 'transport_civil'
  WHEN 'other' THEN 'others'
  ELSE item_category
END;

-- Dedup before creating the unique index.
-- If multiple rows have the same (item_description, item_category), keep the
-- most recent (by created_at) and soft-delete the rest.
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT item_description, item_category, COUNT(*) AS c
    FROM price_book
    WHERE deleted_at IS NULL
    GROUP BY item_description, item_category
    HAVING COUNT(*) > 1
  ) x;
  IF dup_count > 0 THEN
    RAISE NOTICE 'price_book has % duplicate (description, category) groups — auto-deduplicating (keep most recent)', dup_count;
  END IF;
END $$;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY item_description, item_category
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM price_book
  WHERE deleted_at IS NULL
)
UPDATE price_book
SET deleted_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_check
  CHECK (item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));

-- Unique index for the import script's upsert conflict target.
-- Case-sensitive (Manivel's sheet is the single source of truth — consistent casing).
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_book_desc_cat_unique
  ON price_book (item_description, item_category)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. delivery_challan_items — migrate legacy → Manivel 15
-- ============================================================================

UPDATE delivery_challan_items SET item_category = CASE item_category
  WHEN 'panel' THEN 'solar_panels'
  WHEN 'solar_panel' THEN 'solar_panels'
  WHEN 'structure' THEN 'mms'
  WHEN 'mounting_structure' THEN 'mms'
  WHEN 'dc_cable' THEN 'dc_accessories'
  WHEN 'dc_access' THEN 'dc_accessories'
  WHEN 'dcdb' THEN 'dc_accessories'
  WHEN 'connector' THEN 'dc_accessories'
  WHEN 'junction_box' THEN 'dc_accessories'
  WHEN 'ac_cable' THEN 'ac_accessories'
  WHEN 'acdb' THEN 'ac_accessories'
  WHEN 'lt_panel' THEN 'ac_accessories'
  WHEN 'ht_cable' THEN 'ac_accessories'
  WHEN 'ht_panel' THEN 'ac_accessories'
  WHEN 'transformer' THEN 'ac_accessories'
  WHEN 'bus_duct' THEN 'ac_accessories'
  WHEN 'conduit' THEN 'conduits'
  WHEN 'gi_cable_tray' THEN 'conduits'
  WHEN 'earthing' THEN 'earthing_accessories'
  WHEN 'earth_access' THEN 'earthing_accessories'
  WHEN 'lightning_arrestor' THEN 'earthing_accessories'
  WHEN 'safety_equipment' THEN 'safety_accessories'
  WHEN 'walkway' THEN 'safety_accessories'
  WHEN 'handrail' THEN 'safety_accessories'
  WHEN 'net_meter' THEN 'generation_meter'
  WHEN 'monitoring' THEN 'generation_meter'
  WHEN 'installation_labour' THEN 'ic'
  WHEN 'liaison' THEN 'statutory_approvals'
  WHEN 'transport' THEN 'transport_civil'
  WHEN 'civil_work' THEN 'transport_civil'
  WHEN 'other' THEN 'others'
  ELSE item_category
END
WHERE item_category IS NOT NULL;

ALTER TABLE delivery_challan_items DROP CONSTRAINT IF EXISTS delivery_challan_items_item_category_check;
ALTER TABLE delivery_challan_items ADD CONSTRAINT delivery_challan_items_item_category_check
  CHECK (item_category IS NULL OR item_category IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  ));

-- ============================================================================
-- 4. proposal_bom_lines — expand CHECK to union (legacy 26 + Manivel 15).
-- No data migration (strategy C: 33,450 historical rows stay on legacy vocab).
-- New inserts from bom-line-form.tsx will use Manivel values.
-- ============================================================================

ALTER TABLE proposal_bom_lines DROP CONSTRAINT IF EXISTS proposal_bom_lines_item_category_check;
ALTER TABLE proposal_bom_lines ADD CONSTRAINT proposal_bom_lines_item_category_check
  CHECK (item_category IN (
    -- Manivel 15 (for new inserts)
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others',
    -- Legacy 31 (for existing rows — preserved per strategy C)
    'panel','solar_panel','mounting_structure','structure','dc_cable','dc_access',
    'ac_cable','dcdb','acdb','lt_panel','ht_cable','ht_panel','transformer',
    'bus_duct','conduit','gi_cable_tray','earthing','earth_access','lightning_arrestor',
    'safety_equipment','walkway','handrail','net_meter','monitoring',
    'installation_labour','liaison','transport','civil_work','other',
    'connector','junction_box'
  ));

-- ============================================================================
-- 5. purchase_order_items — same expansion
-- ============================================================================

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_item_category_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_item_category_check
  CHECK (item_category IN (
    -- Manivel 15 (for new inserts)
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others',
    -- Legacy 31 (for existing rows — preserved per strategy C)
    'panel','solar_panel','mounting_structure','structure','dc_cable','dc_access',
    'ac_cable','dcdb','acdb','lt_panel','ht_cable','ht_panel','transformer',
    'bus_duct','conduit','gi_cable_tray','earthing','earth_access','lightning_arrestor',
    'safety_equipment','walkway','handrail','net_meter','monitoring',
    'installation_labour','liaison','transport','civil_work','other',
    'connector','junction_box'
  ));

-- ============================================================================
-- 6. Post-UPDATE sanity checks — abort migration if any row is outside Manivel 15
-- ============================================================================

DO $$
DECLARE
  bad_boq INT;
  bad_price_book INT;
  bad_dc INT;
BEGIN
  SELECT COUNT(*) INTO bad_boq FROM project_boq_items
  WHERE item_category NOT IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  );

  SELECT COUNT(*) INTO bad_price_book FROM price_book
  WHERE deleted_at IS NULL
    AND item_category NOT IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  );

  SELECT COUNT(*) INTO bad_dc FROM delivery_challan_items
  WHERE item_category IS NOT NULL
    AND item_category NOT IN (
    'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
    'conduits','earthing_accessories','safety_accessories','generation_meter',
    'ic','statutory_approvals','transport_civil','miscellaneous','others'
  );

  IF bad_boq > 0 THEN
    RAISE EXCEPTION 'project_boq_items has % rows with unmapped legacy category (example: %) — aborting migration',
      bad_boq,
      (SELECT item_category FROM project_boq_items
        WHERE item_category NOT IN (
          'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
          'conduits','earthing_accessories','safety_accessories','generation_meter',
          'ic','statutory_approvals','transport_civil','miscellaneous','others'
        ) LIMIT 1);
  END IF;
  IF bad_price_book > 0 THEN
    RAISE EXCEPTION 'price_book has % active rows with unmapped legacy category (example: %) — aborting migration',
      bad_price_book,
      (SELECT item_category FROM price_book
        WHERE deleted_at IS NULL
          AND item_category NOT IN (
            'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
            'conduits','earthing_accessories','safety_accessories','generation_meter',
            'ic','statutory_approvals','transport_civil','miscellaneous','others'
          ) LIMIT 1);
  END IF;
  IF bad_dc > 0 THEN
    RAISE EXCEPTION 'delivery_challan_items has % rows with unmapped legacy category (example: %) — aborting migration',
      bad_dc,
      (SELECT item_category FROM delivery_challan_items
        WHERE item_category IS NOT NULL
          AND item_category NOT IN (
            'solar_panels','inverter','battery','mms','dc_accessories','ac_accessories',
            'conduits','earthing_accessories','safety_accessories','generation_meter',
            'ic','statutory_approvals','transport_civil','miscellaneous','others'
          ) LIMIT 1);
  END IF;

  RAISE NOTICE 'Migration 057 sanity checks passed: 0 unmapped rows in 3 target tables';
END $$;

COMMIT;
