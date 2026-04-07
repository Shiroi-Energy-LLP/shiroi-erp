-- ============================================================
-- Migration 023 — Survey Form Overhaul (PM Manivel Format)
-- File: supabase/migrations/023_survey_form_overhaul.sql
-- Date: 2026-04-07
--
-- Adds ~20 new columns to lead_site_surveys to support the
-- comprehensive 7-section survey format requested by PM.
-- Sections: Customer/Site, Roof, Structure, Electrical,
--           Shading, Recommendation, Photos & Sign-off.
-- ============================================================

BEGIN;

-- ── Section 1: Customer & Site Info ─────────────────────────
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS contact_person_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS site_access_notes TEXT;

-- ── Section 2: Roof (additional) ────────────────────────────
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS roof_condition TEXT CHECK (roof_condition IN ('good', 'fair', 'poor')),
  ADD COLUMN IF NOT EXISTS roof_age_years INTEGER,
  ADD COLUMN IF NOT EXISTS roof_orientation TEXT CHECK (roof_orientation IN ('north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west')),
  ADD COLUMN IF NOT EXISTS roof_tilt_degrees NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS number_of_floors INTEGER,
  ADD COLUMN IF NOT EXISTS building_height_ft NUMERIC(6,1);

-- ── Section 3: Structure (additional) ───────────────────────
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS existing_structure_condition TEXT CHECK (existing_structure_condition IN ('good', 'needs_repair', 'not_suitable'));

-- ── Section 4: Electrical (additional) ──────────────────────
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS supply_voltage TEXT CHECK (supply_voltage IN ('230v_single', '415v_three', '11kv_ht', '33kv_ht')),
  ADD COLUMN IF NOT EXISTS earthing_type TEXT CHECK (earthing_type IN ('plate', 'pipe', 'strip', 'rod', 'none')),
  ADD COLUMN IF NOT EXISTS earthing_condition TEXT CHECK (earthing_condition IN ('good', 'needs_upgrade', 'absent'));

-- ── Section 5: Shading (additional) ─────────────────────────
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS shade_sources TEXT[], -- array: 'trees', 'buildings', 'towers', 'ac_units', 'water_tank', 'other'
  ADD COLUMN IF NOT EXISTS morning_shade BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS afternoon_shade BOOLEAN DEFAULT FALSE;

-- ── Section 6: Recommendation (additional) ──────────────────
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS panel_placement_notes TEXT,
  ADD COLUMN IF NOT EXISTS inverter_location TEXT,
  ADD COLUMN IF NOT EXISTS cable_routing_notes TEXT,
  ADD COLUMN IF NOT EXISTS estimated_generation_kwh_year NUMERIC(8,1);

-- ── Section 7: Photos & Sign-off ────────────────────────────
-- Photo paths stored as Supabase Storage paths
ALTER TABLE lead_site_surveys
  ADD COLUMN IF NOT EXISTS roof_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS meter_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS electrical_panel_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS site_overview_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS surveyor_signature TEXT, -- base64 data URL from canvas
  ADD COLUMN IF NOT EXISTS customer_signature TEXT; -- base64 data URL from canvas

-- ── Index for GPS queries ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lead_site_surveys_gps
  ON lead_site_surveys(gps_lat, gps_lng)
  WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;

COMMIT;
