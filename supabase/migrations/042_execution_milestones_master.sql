-- Migration 042: Execution milestones master table + drop CHECK constraint
-- Fixes: "new row for relation 'project_milestones' violates check constraint 'project_milestones_milestone_name_check'"
-- Root cause: CHECK constraint allows 9 values but code seeds 10 (earthing_work, follow_ups missing)

-- 1. Drop the restrictive CHECK constraint on milestone_name
ALTER TABLE project_milestones DROP CONSTRAINT IF EXISTS project_milestones_milestone_name_check;

-- 2. Create master table for execution milestones (reference/lookup table)
CREATE TABLE IF NOT EXISTS execution_milestones_master (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_name   TEXT NOT NULL UNIQUE,
  milestone_label  TEXT NOT NULL,
  milestone_order  INT NOT NULL,
  is_payment_gate  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE execution_milestones_master ENABLE ROW LEVEL SECURITY;

-- Everyone can read milestones master (it's a reference table)
CREATE POLICY "Anyone can read execution milestones master"
  ON execution_milestones_master FOR SELECT
  USING (true);

-- Only founder/PM can manage
CREATE POLICY "Founder and PM can manage execution milestones master"
  ON execution_milestones_master FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'project_manager')
    )
  );

-- 3. Seed the 10 standard milestones
INSERT INTO execution_milestones_master (milestone_name, milestone_label, milestone_order, is_payment_gate)
VALUES
  ('material_delivery',       'Material Delivery',         1, false),
  ('structure_installation',  'Structure Installation',    2, false),
  ('panel_installation',      'Panel Installation',        3, false),
  ('electrical_work',         'Electrical Work',           4, true),
  ('earthing_work',           'Earthing Work',             5, false),
  ('civil_work',              'Civil Work',                6, false),
  ('testing_commissioning',   'Testing & Commissioning',   7, true),
  ('net_metering',            'Net Metering',              8, false),
  ('handover',                'Handover',                  9, true),
  ('follow_ups',              'Follow-ups',               10, false)
ON CONFLICT (milestone_name) DO NOTHING;

-- 4. Fix any existing projects that have old 'advance_payment' milestones
-- Don't delete — just leave them (they're still valid data for old projects)
-- The master table defines what NEW projects get

-- 5. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_execution_milestones_master_order
  ON execution_milestones_master (milestone_order) WHERE is_active = true;
