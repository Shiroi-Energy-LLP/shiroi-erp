-- Migration 036: BOI versioning and approval workflow
-- Adds project_bois table for multi-version BOI tracking (BOI-1, BOI-2, etc.)
-- Links project_boq_items to specific BOI versions
-- Status flow: draft → submitted → approved → locked

-- 1. BOI versions table
CREATE TABLE IF NOT EXISTS project_bois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  boi_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'locked')),
  prepared_by UUID REFERENCES employees(id),
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  locked_by UUID REFERENCES employees(id),
  locked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, boi_number)
);

-- 2. Link BOQ items to a specific BOI version
ALTER TABLE project_boq_items ADD COLUMN IF NOT EXISTS boi_id UUID REFERENCES project_bois(id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_project_bois_project ON project_bois(project_id);
CREATE INDEX IF NOT EXISTS idx_project_boq_items_boi ON project_boq_items(boi_id);

-- 4. RLS policies
ALTER TABLE project_bois ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view project BOIs"
  ON project_bois FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Authorized roles can create BOIs"
  ON project_bois FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY(ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role, 'sales_engineer'::app_role])
    )
  );

CREATE POLICY "Authorized roles can update BOIs"
  ON project_bois FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY(ARRAY['founder'::app_role, 'project_manager'::app_role, 'site_supervisor'::app_role, 'sales_engineer'::app_role])
    )
  );

CREATE POLICY "PM and founder can delete BOIs"
  ON project_bois FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY(ARRAY['founder'::app_role, 'project_manager'::app_role])
    )
  );

-- 5. Backward compatibility: create BOI-1 for every project that already has items
INSERT INTO project_bois (project_id, boi_number, status, prepared_by, locked_by, locked_at, submitted_at, approved_at)
SELECT DISTINCT
  q.project_id,
  1,
  CASE
    WHEN p.boi_locked = true THEN 'locked'
    ELSE 'draft'
  END,
  p.boi_locked_by,
  CASE WHEN p.boi_locked = true THEN p.boi_locked_by ELSE NULL END,
  p.boi_locked_at,
  p.boi_locked_at,
  p.boi_locked_at
FROM project_boq_items q
JOIN projects p ON p.id = q.project_id
WHERE NOT EXISTS (
  SELECT 1 FROM project_bois pb WHERE pb.project_id = q.project_id
);

-- 6. Link existing items to their project's BOI-1
UPDATE project_boq_items
SET boi_id = pb.id
FROM project_bois pb
WHERE project_boq_items.project_id = pb.project_id
  AND pb.boi_number = 1
  AND project_boq_items.boi_id IS NULL;
