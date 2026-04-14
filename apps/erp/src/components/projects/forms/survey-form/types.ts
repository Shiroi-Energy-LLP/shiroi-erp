/**
 * Types + dropdown constants for the Site Survey form.
 *
 * Kept in its own module so the main form shell and the section
 * components all import from one source of truth. Constants match
 * the DB CHECK constraint values in migration 035 (survey_extensions).
 */

export interface SurveyData {
  id: string;
  survey_date: string;
  survey_status: string | null;
  // Section 1: Project Details / Site Info
  contact_person_name: string | null;
  contact_phone: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  site_access_notes: string | null;
  // Section 2: Mounting & Site Feasibility
  roof_type: string | null;
  roof_condition: string | null;
  roof_age_years: number | null;
  roof_orientation: string | null;
  roof_tilt_degrees: number | null;
  roof_area_sqft: number | null;
  usable_area_sqft: number | null;
  number_of_floors: number | null;
  building_height_ft: number | null;
  structure_type: string | null;
  existing_structure_condition: string | null;
  existing_load_kw: number | null;
  sanctioned_load_kw: number | null;
  meter_type: string | null;
  supply_voltage: string | null;
  discom_name: string | null;
  earthing_type: string | null;
  earthing_condition: string | null;
  net_metering_eligible: boolean | null;
  shading_assessment: string | null;
  shading_notes: string | null;
  shade_sources: string[] | null;
  morning_shade: boolean | null;
  afternoon_shade: boolean | null;
  recommended_size_kwp: number | null;
  recommended_system_type: string | null;
  estimated_generation_kwh_year: number | null;
  panel_placement_notes: string | null;
  inverter_location: string | null;
  cable_routing_notes: string | null;
  mounting_feasibility_checked: boolean | null;
  shadow_analysis_done: boolean | null;
  roof_condition_photo_path: string | null;
  shadow_area_photo_path: string | null;
  // Section 3: Client Discussion
  mounting_procedure_explained: boolean | null;
  fixing_arrangement_discussed: boolean | null;
  // Section 4: Equipment Location Finalization
  inverter_location_finalized: boolean | null;
  inverter_location_photo_path: string | null;
  dc_routing_finalized: boolean | null;
  dc_routing_photo_path: string | null;
  earthing_pit_finalized: boolean | null;
  earthing_pit_photo_path: string | null;
  la_location_finalized: boolean | null;
  la_location_photo_path: string | null;
  termination_point_finalized: boolean | null;
  termination_point_photo_path: string | null;
  spare_feeder_available: boolean | null;
  spare_feeder_photo_path: string | null;
  dg_eb_checked: boolean | null;
  dg_eb_photo_path: string | null;
  spare_feeder_rating: string | null;
  spare_feeder_rating_photo_path: string | null;
  // Section 5: AC Cable Routing
  ac_routing_finalized: boolean | null;
  ac_routing_photo_path: string | null;
  // Section 6: Deviations
  additional_panels_required: boolean | null;
  additional_panels_remarks: string | null;
  additional_inverter_required: boolean | null;
  additional_inverter_remarks: string | null;
  routing_changes: string | null;
  cable_size_changes: string | null;
  other_special_requests: string | null;
  // Section 7: Notes & Signatures
  notes: string | null;
  surveyor_signature: string | null;
  customer_signature: string | null;
}

// ─── Dropdown constants — match DB CHECK constraints ──────────────────

export const ROOF_TYPES = [
  { value: 'flat_rcc', label: 'RCC Flat' },
  { value: 'sloped_rcc', label: 'RCC Sloped' },
  { value: 'tin_sheet', label: 'Metal Sheet' },
  { value: 'mangalore_tile', label: 'Tiled' },
  { value: 'asbestos', label: 'Asbestos' },
  { value: 'metal_deck', label: 'Metal Deck' },
  { value: 'other', label: 'Other' },
] as const;

export const ROOF_CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
] as const;

export const ROOF_ORIENTATIONS = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
  { value: 'west', label: 'West' },
  { value: 'north_east', label: 'North-East' },
  { value: 'north_west', label: 'North-West' },
  { value: 'south_east', label: 'South-East' },
  { value: 'south_west', label: 'South-West' },
] as const;

export const STRUCTURE_TYPES = [
  { value: 'rcc_column', label: 'RCC Column' },
  { value: 'elevated_ms', label: 'Elevated MS' },
  { value: 'ground_mount', label: 'Ground Mount' },
  { value: 'carport', label: 'Carport' },
  { value: 'other', label: 'Other' },
] as const;

export const STRUCTURE_CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'not_suitable', label: 'Not Suitable' },
] as const;

export const SHADING_OPTIONS = [
  { value: 'none', label: 'No Shade' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Heavy / Severe' },
] as const;

export const SHADE_SOURCES = [
  { value: 'trees', label: 'Trees' },
  { value: 'buildings', label: 'Adjacent Buildings' },
  { value: 'towers', label: 'Towers / Poles' },
  { value: 'ac_units', label: 'AC / HVAC Units' },
  { value: 'water_tank', label: 'Water Tank' },
  { value: 'other', label: 'Other' },
] as const;

export const METER_TYPES = [
  { value: 'single_phase', label: 'Single Phase' },
  { value: 'three_phase', label: 'Three Phase' },
] as const;

export const SUPPLY_VOLTAGES = [
  { value: '230v_single', label: '230V Single Phase' },
  { value: '415v_three', label: '415V Three Phase' },
  { value: '11kv_ht', label: '11kV HT' },
  { value: '33kv_ht', label: '33kV HT' },
] as const;

export const EARTHING_TYPES = [
  { value: 'plate', label: 'Plate' },
  { value: 'pipe', label: 'Pipe' },
  { value: 'strip', label: 'Strip' },
  { value: 'rod', label: 'Rod' },
  { value: 'none', label: 'None' },
] as const;

export const EARTHING_CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'needs_upgrade', label: 'Needs Upgrade' },
  { value: 'absent', label: 'Absent' },
] as const;

export const SYSTEM_TYPES = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
] as const;

// ─── Equipment items (Section 4) ──────────────────────────────────────

export interface EquipmentItem {
  key: string;
  label: string;
  toggleKey: string;
  photoKey: string;
}

export const EQUIPMENT_ITEMS: EquipmentItem[] = [
  { key: 'inverter_location', label: 'Inverter Location', toggleKey: 'inverter_location_finalized', photoKey: 'inverter_location_photo_path' },
  { key: 'dc_routing', label: 'DC Cable Routing', toggleKey: 'dc_routing_finalized', photoKey: 'dc_routing_photo_path' },
  { key: 'earthing_pit', label: 'Earthing Pit', toggleKey: 'earthing_pit_finalized', photoKey: 'earthing_pit_photo_path' },
  { key: 'la_location', label: 'Lightning Arrestor', toggleKey: 'la_location_finalized', photoKey: 'la_location_photo_path' },
  { key: 'termination_point', label: 'Termination Point', toggleKey: 'termination_point_finalized', photoKey: 'termination_point_photo_path' },
  { key: 'spare_feeder', label: 'Spare Feeder Available', toggleKey: 'spare_feeder_available', photoKey: 'spare_feeder_photo_path' },
  { key: 'dg_eb', label: 'DG/EB Interconnection', toggleKey: 'dg_eb_checked', photoKey: 'dg_eb_photo_path' },
];
