-- =============================================================================
-- Migration 177 — feedback batch 2 (2026-06-11)
-- 1) projects.deleted_by (soft-delete audit; deleted_at exists since 004a)
-- 2) search_projects_lite RPC (typeahead + injection-safe list search)
-- 3) project_activities.stage_custom (free-text stage; master list untouched)
-- 4) item_categories + item_units managed lists (expense_categories pattern);
--    price_book CHECK → FK (fixes the broken legacy CATEGORY_OPTIONS bug)
-- =============================================================================

-- ── 1. Soft-delete audit ─────────────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES employees(id);

-- ── 2. Project search RPC ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_projects_lite(p_query TEXT DEFAULT NULL, p_limit INT DEFAULT 12)
RETURNS TABLE (
  id             UUID,
  project_number TEXT,
  customer_name  TEXT,
  project_name   TEXT,
  status         TEXT,
  order_date     TEXT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.id, p.project_number, p.customer_name, p.project_name,
         p.status::text, p.order_date::text
  FROM projects p
  WHERE p.deleted_at IS NULL
    AND (
      p_query IS NULL OR btrim(p_query) = '' OR
      p.customer_name  ILIKE '%' || p_query || '%' OR
      p.project_name   ILIKE '%' || p_query || '%' OR
      p.project_number ILIKE '%' || p_query || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 500);
$$;

REVOKE ALL ON FUNCTION search_projects_lite(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION search_projects_lite(TEXT, INT) TO authenticated;

-- ── 3. Activities custom stage ───────────────────────────────────────────────
ALTER TABLE project_activities ADD COLUMN IF NOT EXISTS stage_custom TEXT;

-- ── 4. Managed item categories + units ───────────────────────────────────────
CREATE TABLE item_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value      TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO item_categories (value, label, sort_order) VALUES
  ('solar_panels',        'Solar Panels',          10),
  ('inverter',            'Inverter',              20),
  ('battery',             'Battery',               30),
  ('mms',                 'MMS (Structure)',       40),
  ('dc_accessories',      'DC Accessories',        50),
  ('ac_accessories',      'AC Accessories',        60),
  ('conduits',            'Conduits',              70),
  ('earthing_accessories','Earthing Accessories',  80),
  ('safety_accessories',  'Safety Accessories',    90),
  ('generation_meter',    'Generation Meter',     100),
  ('ic',                  'IC (Installation & Commissioning)', 110),
  ('statutory_approvals', 'Statutory Approvals',  120),
  ('transport_civil',     'Transport & Civil',    130),
  ('miscellaneous',       'Miscellaneous',        140),
  ('others',              'Others',               150);

CREATE TABLE item_units (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value      TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO item_units (value, sort_order) VALUES
  ('Nos', 10), ('No', 20), ('KWp', 30), ('Kg', 40), ('Set', 50), ('Meter', 60),
  ('Packet', 70), ('Wp', 80), ('Lot', 90), ('Box', 100), ('Length', 110)
ON CONFLICT (value) DO NOTHING;
-- Extra units found in Step 1.1 (price_book + project_boq_items) not in canonical 11:
INSERT INTO item_units (value, sort_order) VALUES ('Coil', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('kw', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('kW', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('kWp', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('KWP', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('L.S', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('length', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Litre', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('lot', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('LS', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('lumpsum', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('meter', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Meters', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Metres', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Mos', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Mtr', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('No''s', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('nos', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Paire', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Paires', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Pairs', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Pocket', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('set', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Unit', 200) ON CONFLICT (value) DO NOTHING;
INSERT INTO item_units (value, sort_order) VALUES ('Watts', 200) ON CONFLICT (value) DO NOTHING;

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_categories_read" ON item_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "item_units_read"      ON item_units      FOR SELECT TO authenticated USING (true);
CREATE POLICY "item_categories_write" ON item_categories FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));
CREATE POLICY "item_categories_update" ON item_categories FOR UPDATE TO authenticated
  USING (get_my_role() IN ('founder','project_manager','purchase_officer'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));
CREATE POLICY "item_units_write" ON item_units FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));
CREATE POLICY "item_units_update" ON item_units FOR UPDATE TO authenticated
  USING (get_my_role() IN ('founder','project_manager','purchase_officer'))
  WITH CHECK (get_my_role() IN ('founder','project_manager','purchase_officer'));

-- price_book: CHECK → FK (existing rows are Manivel-15-clean per mig 057)
ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_fkey
  FOREIGN KEY (item_category) REFERENCES item_categories(value);
