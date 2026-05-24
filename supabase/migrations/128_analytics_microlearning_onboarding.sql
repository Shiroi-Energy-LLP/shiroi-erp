-- Migration 128: BOM feedback + O&M Profitability RPC + Microlearning + Onboarding
-- E11: bom_actual_vs_budgetary
-- E12: get_om_profitability RPC using om_service_tickets
-- E13: learning_modules + learning_progress
-- E14: onboarding_progress + seed modules

BEGIN;

-- ── E11: BOM actual vs budgetary ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS bom_actual_vs_budgetary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'panels', 'inverter', 'mounting_structure', 'dc_cable',
    'ac_cable', 'earthing', 'la_system', 'accessories', 'other'
  )),
  budgetary_qty NUMERIC(14, 2),
  budgetary_unit_cost NUMERIC(14, 2),
  budgetary_total_cost NUMERIC(14, 2),
  actual_qty NUMERIC(14, 2),
  actual_unit_cost NUMERIC(14, 2),
  actual_total_cost NUMERIC(14, 2),
  correction_factor NUMERIC(8, 4),
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, category, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_bom_actual_project_cat
  ON bom_actual_vs_budgetary (project_id, category);
CREATE INDEX IF NOT EXISTS idx_bom_actual_recorded
  ON bom_actual_vs_budgetary (recorded_at DESC);

ALTER TABLE bom_actual_vs_budgetary ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_actual_read ON bom_actual_vs_budgetary
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role IN ('founder', 'purchase_officer', 'project_manager', 'finance'))
  );
CREATE POLICY bom_actual_service ON bom_actual_vs_budgetary
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE bom_actual_vs_budgetary IS
  'Per-project BOM actual vs budgetary cost. Nightly cron computes correction_factor; feeds the existing bom_correction_factors table for future quote accuracy.';

-- ── E12: O&M Profitability RPC ────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_om_profitability(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  project_id UUID,
  project_number TEXT,
  customer_name TEXT,
  system_size_kwp NUMERIC,
  ticket_count BIGINT,
  ticket_parts_cost NUMERIC,
  ticket_service_amount NUMERIC,
  profit_loss NUMERIC,
  sla_compliant_count BIGINT,
  sla_breach_count BIGINT,
  sla_compliance_pct NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id AS project_id,
    p.project_number,
    p.customer_name,
    p.system_size_kwp,
    COUNT(st.id) AS ticket_count,
    COALESCE(SUM(st.parts_cost), 0) AS ticket_parts_cost,
    COALESCE(SUM(st.service_amount), 0) AS ticket_service_amount,
    COALESCE(SUM(st.service_amount), 0) -
      COALESCE(SUM(COALESCE(st.parts_cost, 0)), 0) AS profit_loss,
    COUNT(st.id) FILTER (WHERE st.sla_breached = false OR st.sla_breached IS NULL) AS sla_compliant_count,
    COUNT(st.id) FILTER (WHERE st.sla_breached = true) AS sla_breach_count,
    CASE
      WHEN COUNT(st.id) = 0 THEN NULL
      ELSE ROUND(
        100.0 * COUNT(st.id) FILTER (WHERE st.sla_breached = false OR st.sla_breached IS NULL)
        / COUNT(st.id), 1
      )
    END AS sla_compliance_pct
  FROM projects p
  LEFT JOIN om_service_tickets st ON st.project_id = p.id
    AND st.created_at::DATE BETWEEN p_start_date AND p_end_date
  WHERE p.status IN ('completed', 'waiting_net_metering', 'meter_client_scope')
  GROUP BY p.id, p.project_number, p.customer_name, p.system_size_kwp
  ORDER BY ticket_count DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_om_profitability(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION get_om_profitability IS
  'O&M profitability per commissioned project: ticket parts cost vs service revenue, SLA compliance %. Used by /om/profitability page.';

-- ── E13: Microlearning modules ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'safety', 'technical', 'customer_communication', 'compliance', 'general'
  )),
  target_role TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'beginner'
    CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  onboarding_track TEXT CHECK (onboarding_track IN ('sales', 'install', 'om', 'admin', 'all')),
  sequence_order INTEGER,
  quiz_questions JSONB,
  pass_score_pct INTEGER NOT NULL DEFAULT 60,
  language TEXT NOT NULL DEFAULT 'en',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_modules_role
  ON learning_modules (target_role, active);
CREATE INDEX IF NOT EXISTS idx_learning_modules_track
  ON learning_modules (onboarding_track, sequence_order)
  WHERE onboarding_track IS NOT NULL AND active = true;

ALTER TABLE learning_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY learning_modules_read ON learning_modules
  FOR SELECT TO authenticated USING (active = true);
CREATE POLICY learning_modules_manage ON learning_modules
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role IN ('founder', 'hr_manager'))
  );

COMMENT ON TABLE learning_modules IS
  'Daily microlearning content. Each module targets a role, has a markdown body + optional quiz. onboarding_track enables sequenced onboarding.';

CREATE TABLE IF NOT EXISTS learning_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES learning_modules(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  quiz_score INTEGER,
  passed BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_progress_employee
  ON learning_progress (employee_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_progress_module
  ON learning_progress (module_id);

ALTER TABLE learning_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY learning_progress_own ON learning_progress
  FOR SELECT TO authenticated USING (employee_id = auth.uid());
CREATE POLICY learning_progress_manager ON learning_progress
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role IN ('founder', 'hr_manager'))
  );
CREATE POLICY learning_progress_service ON learning_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── E14: Onboarding progress ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  onboarding_track TEXT NOT NULL CHECK (onboarding_track IN ('sales', 'install', 'om', 'admin', 'all')),
  modules_total INTEGER NOT NULL DEFAULT 0,
  modules_completed INTEGER NOT NULL DEFAULT 0,
  modules_passed INTEGER NOT NULL DEFAULT 0,
  completion_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, onboarding_track)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_employee
  ON onboarding_progress (employee_id);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_own ON onboarding_progress
  FOR SELECT TO authenticated USING (employee_id = auth.uid());
CREATE POLICY onboarding_manager ON onboarding_progress
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    AND p.role IN ('founder', 'hr_manager'))
  );
CREATE POLICY onboarding_service ON onboarding_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE onboarding_progress IS
  'Per-employee onboarding track progress summary. Updated by cron after learning_progress rows change.';

-- ── Seed 5 sample learning modules ───────────────────────────────────

INSERT INTO learning_modules (title, body_md, category, target_role, difficulty, onboarding_track, sequence_order, language, quiz_questions)
VALUES
(
  'Solar Panel Installation Safety',
  '# Safety First: Solar Panel Installation

## Key Rules
1. **Always de-energize** the DC disconnect before working on panels.
2. **Wear PPE**: gloves, safety boots, hard hat, and harness when working at height.
3. **Never work alone** on a rooftop installation.

## Common Hazards
- Electrical shock from live DC wires (panels produce power even in cloud cover)
- Falls from height
- Heat exhaustion (Chennai summers: take breaks every 45 minutes)

## Emergency
Call **108** (ambulance). De-energize before touching an electrocuted person.',
  'safety', 'site_supervisor', 'beginner', 'install', 1, 'en',
  '[{"question":"What to do before working on panels?","options":["Start immediately","De-energize DC disconnect","Check weather","Call customer"],"correct_index":1},{"question":"Break frequency in Chennai summer?","options":["Every 2 hours","Every 45 minutes","Once a day","When tired"],"correct_index":1},{"question":"Someone is electrocuted — first action?","options":["Touch them","Call 108 and de-energize first","Give water","Ignore"],"correct_index":1},{"question":"Minimum roof work team size?","options":["1","2","3","4"],"correct_index":1},{"question":"Do panels produce power in clouds?","options":["No","Yes always","Morning only","Evening only"],"correct_index":1}]'::jsonb
),
(
  'Inverter Installation — Tamil Guide',
  '# இன்வெர்ட்டர் நிறுவல்

## நிறுவல் வரிசை
1. AC MCB-ஐ OFF செய்யவும்
2. DC disconnect-ஐ OFF செய்யவும்
3. Wall bracket-ல் fix செய்யவும்
4. DC cables connect செய்யவும்
5. AC cables connect செய்யவும்
6. Grounding wire connect செய்யவும்
7. Site supervisor-இடம் approval வாங்கவும்
8. Power ON செய்யவும்',
  'technical', 'site_supervisor', 'beginner', 'install', 2, 'ta',
  '[{"question":"முதல் படி என்ன?","options":["Power ON","DC connect","AC MCB OFF","Wire cut"],"correct_index":2},{"question":"AC வயர் எங்கே?","options":["Panel-ல்","MCB-ல்","Battery-ல்","Roof-ல்"],"correct_index":1},{"question":"RS485 எதற்கு?","options":["Power","Monitoring","Grounding","Cooling"],"correct_index":1},{"question":"Cable sizing யார்?","options":["நாங்களே","Site engineer","Customer","Anyone"],"correct_index":1},{"question":"Approval எங்கிருந்து?","options":["Customer","Site supervisor","n8n","Growatt"],"correct_index":1}]'::jsonb
),
(
  'Customer Communication — Setting Expectations',
  '# Customer Communication Best Practices

## Do''s
- Greet the customer on arrival
- Give ETAs for each phase
- Clean up daily
- Inform PM of any delays

## Don''ts
- No generation number promises
- No breaks in customer living spaces
- No arguments on-site

## Escalation
Complaint from customer → call the PM immediately.',
  'customer_communication', 'site_supervisor', 'beginner', 'all', 1, 'en',
  '[{"question":"On arrival at site?","options":["Start work","Greet customer","Check inverter","Call PM"],"correct_index":1},{"question":"Who promises generation numbers?","options":["Site supervisor","You","Sales engineer","Customer"],"correct_index":2},{"question":"Customer complaint — action?","options":["Argue","Ignore","Call PM","Work on"],"correct_index":2},{"question":"Per phase requirement?","options":["Invoice","ETA","Quote","Manual"],"correct_index":1},{"question":"Daily end-of-day?","options":["Report only","Clean up","Call customer","Photos"],"correct_index":1}]'::jsonb
),
(
  'EHS — Emergency Response Protocols',
  '# Emergency Protocols

## Numbers
- 108 = Ambulance
- 101 = Fire
- 100 = Police

## Electrical Shock
1. Do NOT touch victim
2. De-energize first
3. Call 108

## Fire
1. Evacuate
2. Call 101
3. CO2 extinguisher only (not water)

## Incidents
Report all incidents within 24 hours via ERP site report.',
  'safety', 'site_supervisor', 'beginner', 'install', 3, 'en',
  '[{"question":"Ambulance number?","options":["100","101","108","112"],"correct_index":2},{"question":"Electrical shock first action?","options":["Touch victim","De-energize MCB","Give water","Run"],"correct_index":1},{"question":"Extinguisher for electrical fire?","options":["Water","Sand","CO2","Foam"],"correct_index":2},{"question":"Fall from height — do NOT?","options":["Call 108","Clear area","Move person","Call Vivek"],"correct_index":2},{"question":"Incident reporting window?","options":["Major only","Never","24 hours","After project"],"correct_index":2}]'::jsonb
),
(
  'Basic Electrical Safety for Technicians',
  '# Electrical Safety Basics

## DC vs AC
- DC: panels to inverter (arcs are MORE dangerous)
- AC: inverter to grid/appliances

## Rules
1. Check with clamp meter before touching any wire
2. Minimum PPE: insulated gloves rated 1000V
3. Never work on live circuits alone

## LOTO (Lockout-Tagout)
1. Switch off all isolation points
2. Attach personal tag
3. Test de-energized
4. Proceed',
  'technical', 'site_supervisor', 'intermediate', 'install', 4, 'en',
  '[{"question":"More dangerous for arcing?","options":["AC","DC","Equal","Neither"],"correct_index":1},{"question":"Minimum PPE for electrical work?","options":["Regular gloves","1000V insulated gloves","No gloves","Rubber shoes"],"correct_index":1},{"question":"LOTO means?","options":["Lock Out Tag Out","Line Of Total Ops","Left Over Turn Off","Lock Open Test Out"],"correct_index":0},{"question":"10 panels at 35V = string voltage?","options":["35V","350V","3500V","3.5V"],"correct_index":1},{"question":"Power formula?","options":["P=V+A","P=V/A","P=VxA","P=A/V"],"correct_index":2}]'::jsonb
)
ON CONFLICT DO NOTHING;

COMMIT;
