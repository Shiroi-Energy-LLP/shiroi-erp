-- Migration 046: Price Book expansion for Item Master
-- Adds vendor_name, default_qty, deleted_at, rate audit columns
-- Expands item_category CHECK constraint to 24 categories

-- New columns
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS default_qty NUMERIC(10,2) DEFAULT 1;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS rate_updated_at TIMESTAMPTZ;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS rate_updated_by UUID REFERENCES profiles(id);

-- Drop old restrictive CHECK constraint and replace with expanded one
ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_check
  CHECK (item_category IN (
    'solar_panel', 'inverter', 'battery', 'mounting_structure',
    'dc_cable', 'dc_access', 'ac_cable', 'dcdb', 'acdb',
    'lt_panel', 'conduit', 'earthing', 'earth_access',
    'net_meter', 'civil_work', 'installation_labour', 'transport',
    'miscellaneous', 'walkway', 'gi_cable_tray', 'handrail', 'other',
    'panel', 'structure'
  ));

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_price_book_category ON price_book(item_category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_book_active ON price_book(is_active) WHERE deleted_at IS NULL;
