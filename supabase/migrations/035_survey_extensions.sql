-- Migration 035: Survey form extensions
-- Adds equipment location finalization, AC routing, client discussion,
-- deviations, photo paths, and survey status workflow fields.

-- Section 2: Mounting & Site Feasibility
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS mounting_feasibility_checked BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS shadow_analysis_done BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS roof_condition_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS shadow_area_photo_path TEXT;

-- Section 3: Client Discussion & Approvals
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS mounting_procedure_explained BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS fixing_arrangement_discussed BOOLEAN DEFAULT FALSE;

-- Section 4: Equipment Location Finalization (toggle + photo per item)
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS inverter_location_finalized BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS inverter_location_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dc_routing_finalized BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dc_routing_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS earthing_pit_finalized BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS earthing_pit_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS la_location_finalized BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS la_location_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS termination_point_finalized BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS termination_point_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_available BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dg_eb_checked BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS dg_eb_photo_path TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_rating TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS spare_feeder_rating_photo_path TEXT;

-- Section 5: AC Cable Routing
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS ac_routing_finalized BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS ac_routing_photo_path TEXT;

-- Section 6: Deviations & Special Requirements
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS additional_panels_required BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS additional_panels_remarks TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS additional_inverter_required BOOLEAN DEFAULT FALSE;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS additional_inverter_remarks TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS routing_changes TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS cable_size_changes TEXT;
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS other_special_requests TEXT;

-- Survey status workflow
ALTER TABLE lead_site_surveys ADD COLUMN IF NOT EXISTS survey_status TEXT DEFAULT 'draft'
  CHECK (survey_status IN ('draft', 'submitted', 'approved'));

-- Mark existing surveys as submitted (they were saved before the workflow existed)
UPDATE lead_site_surveys SET survey_status = 'submitted' WHERE survey_status IS NULL OR survey_status = 'draft';
