-- =============================================================================
-- Migration 121 — Inventory cut-length tracking (C8) + Project completion % (C9)
-- =============================================================================

-- ── C8: inventory_cut_records ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_cut_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_type   TEXT NOT NULL CHECK (material_type IN (
                    'dc_cable','ac_cable','earthing_wire','conduit_pvc','conduit_gi','other'
                  )),
  specification   TEXT NOT NULL,
  length_meters   NUMERIC(10,2) NOT NULL CHECK (length_meters > 0),
  quantity_rolls  INT,
  cut_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  cut_by          UUID REFERENCES profiles(id),
  project_stage   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cut_records_project ON inventory_cut_records(project_id);
CREATE INDEX IF NOT EXISTS idx_cut_records_date    ON inventory_cut_records(cut_date);

-- RLS
ALTER TABLE inventory_cut_records ENABLE ROW LEVEL SECURITY;

-- All authenticated employees may read
CREATE POLICY "cut_records_read" ON inventory_cut_records
  FOR SELECT TO authenticated USING (true);

-- project_manager, founder, om_technician, site_supervisor may insert
CREATE POLICY "cut_records_insert" ON inventory_cut_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder','project_manager','om_technician','site_supervisor')
    )
  );

-- founder + project_manager may delete
CREATE POLICY "cut_records_delete" ON inventory_cut_records
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder','project_manager')
    )
  );

-- RPC: total cable consumed per project
CREATE OR REPLACE FUNCTION get_project_cable_summary(p_project_id UUID)
RETURNS TABLE (material_type TEXT, total_meters NUMERIC, record_count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT material_type, SUM(length_meters), COUNT(*)
  FROM inventory_cut_records
  WHERE project_id = p_project_id
  GROUP BY material_type
  ORDER BY material_type;
$$;

-- ── C9: project_completion_items ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_completion_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component      TEXT NOT NULL CHECK (component IN (
                   'site_preparation',
                   'structure_mounting',
                   'panel_installation',
                   'dc_wiring',
                   'inverter_installation',
                   'ac_wiring',
                   'earthing',
                   'net_metering_applied',
                   'commissioning',
                   'handover'
                 )),
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  completed_by   UUID REFERENCES profiles(id),
  notes          TEXT,
  UNIQUE(project_id, component)
);

CREATE INDEX IF NOT EXISTS idx_completion_project ON project_completion_items(project_id);

-- RLS
ALTER TABLE project_completion_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "completion_items_read" ON project_completion_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "completion_items_insert" ON project_completion_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder','project_manager','site_supervisor')
    )
  );

CREATE POLICY "completion_items_update" ON project_completion_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('founder','project_manager','site_supervisor')
    )
  );

-- RPC: compute weighted completion % (weights sum to 95; handover milestone has 0 weight)
CREATE OR REPLACE FUNCTION get_project_completion_pct(p_project_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  WITH weights(component, weight) AS (VALUES
    ('site_preparation'::TEXT,  5),
    ('structure_mounting',      20),
    ('panel_installation',      25),
    ('dc_wiring',               10),
    ('inverter_installation',   15),
    ('ac_wiring',               10),
    ('earthing',                5),
    ('net_metering_applied',    5),
    ('commissioning',           5)
  )
  SELECT COALESCE(SUM(w.weight) FILTER (WHERE ci.completed = TRUE), 0)
  FROM weights w
  LEFT JOIN project_completion_items ci
    ON ci.project_id = p_project_id AND ci.component = w.component;
$$;
