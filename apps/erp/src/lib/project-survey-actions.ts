'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { getNextStatus } from '@/lib/project-status-helpers';

// ── Survey CRUD ──

export async function createOrUpdateSurvey(input: {
  projectId: string;
  surveyId?: string; // if provided, update; otherwise create
  data: {
    // Original fields
    roof_type: string;
    structure_type: string;
    roof_area_sqft: number | null;
    usable_area_sqft: number | null;
    shading_assessment: string | null;
    shading_notes: string | null;
    existing_load_kw: number | null;
    sanctioned_load_kw: number | null;
    meter_type: string | null;
    discom_name: string | null;
    net_metering_eligible: boolean | null;
    recommended_size_kwp: number | null;
    recommended_system_type: string | null;
    survey_date: string;
    notes: string | null;
    // Section 1: Site Info
    gps_lat?: number | null;
    gps_lng?: number | null;
    contact_person_name?: string | null;
    contact_phone?: string | null;
    site_access_notes?: string | null;
    // Section 2: Roof (additional)
    roof_condition?: string | null;
    roof_age_years?: number | null;
    roof_orientation?: string | null;
    roof_tilt_degrees?: number | null;
    number_of_floors?: number | null;
    building_height_ft?: number | null;
    // Section 3: Structure
    existing_structure_condition?: string | null;
    // Section 4: Electrical
    supply_voltage?: string | null;
    earthing_type?: string | null;
    earthing_condition?: string | null;
    // Section 5: Shading
    shade_sources?: string[] | null;
    morning_shade?: boolean | null;
    afternoon_shade?: boolean | null;
    // Section 6: Recommendation
    panel_placement_notes?: string | null;
    inverter_location?: string | null;
    cable_routing_notes?: string | null;
    estimated_generation_kwh_year?: number | null;
    // Section 7: Signatures
    surveyor_signature?: string | null;
    customer_signature?: string | null;
    // Section 2: Mounting extensions
    mounting_feasibility_checked?: boolean;
    shadow_analysis_done?: boolean;
    roof_condition_photo_path?: string | null;
    shadow_area_photo_path?: string | null;
    // Section 3: Client Discussion
    mounting_procedure_explained?: boolean;
    fixing_arrangement_discussed?: boolean;
    // Section 4: Equipment Location Finalization
    inverter_location_finalized?: boolean;
    inverter_location_photo_path?: string | null;
    dc_routing_finalized?: boolean;
    dc_routing_photo_path?: string | null;
    earthing_pit_finalized?: boolean;
    earthing_pit_photo_path?: string | null;
    la_location_finalized?: boolean;
    la_location_photo_path?: string | null;
    termination_point_finalized?: boolean;
    termination_point_photo_path?: string | null;
    spare_feeder_available?: boolean;
    spare_feeder_photo_path?: string | null;
    dg_eb_checked?: boolean;
    dg_eb_photo_path?: string | null;
    spare_feeder_rating?: string | null;
    spare_feeder_rating_photo_path?: string | null;
    // Section 5: AC Cable Routing
    ac_routing_finalized?: boolean;
    ac_routing_photo_path?: string | null;
    // Section 6: Deviations
    additional_panels_required?: boolean;
    additional_panels_remarks?: string | null;
    additional_inverter_required?: boolean;
    additional_inverter_remarks?: string | null;
    routing_changes?: string | null;
    cable_size_changes?: string | null;
    other_special_requests?: string | null;
    // Status
    survey_status?: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createOrUpdateSurvey]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Get lead_id + current status from project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('lead_id, status')
    .eq('id', input.projectId)
    .single();

  if (projectError || !project?.lead_id) {
    console.error(`${op} Project/lead lookup failed:`, { projectError });
    return { success: false, error: 'Could not find linked lead for this project' };
  }

  const surveyData = {
    lead_id: project.lead_id,
    surveyed_by: employee.id,
    // Original fields
    roof_type: input.data.roof_type,
    structure_type: input.data.structure_type,
    roof_area_sqft: input.data.roof_area_sqft,
    usable_area_sqft: input.data.usable_area_sqft,
    shading_assessment: input.data.shading_assessment,
    shading_notes: input.data.shading_notes,
    existing_load_kw: input.data.existing_load_kw,
    sanctioned_load_kw: input.data.sanctioned_load_kw,
    meter_type: input.data.meter_type,
    discom_name: input.data.discom_name,
    net_metering_eligible: input.data.net_metering_eligible,
    recommended_size_kwp: input.data.recommended_size_kwp,
    recommended_system_type: input.data.recommended_system_type,
    survey_date: input.data.survey_date,
    notes: input.data.notes,
    is_final: false,
    // Section 1: Site Info
    gps_lat: input.data.gps_lat,
    gps_lng: input.data.gps_lng,
    contact_person_name: input.data.contact_person_name,
    contact_phone: input.data.contact_phone,
    site_access_notes: input.data.site_access_notes,
    // Section 2: Roof (additional)
    roof_condition: input.data.roof_condition,
    roof_age_years: input.data.roof_age_years,
    roof_orientation: input.data.roof_orientation,
    roof_tilt_degrees: input.data.roof_tilt_degrees,
    number_of_floors: input.data.number_of_floors,
    building_height_ft: input.data.building_height_ft,
    // Section 3: Structure
    existing_structure_condition: input.data.existing_structure_condition,
    // Section 4: Electrical
    supply_voltage: input.data.supply_voltage,
    earthing_type: input.data.earthing_type,
    earthing_condition: input.data.earthing_condition,
    // Section 5: Shading
    shade_sources: input.data.shade_sources,
    morning_shade: input.data.morning_shade,
    afternoon_shade: input.data.afternoon_shade,
    // Section 6: Recommendation
    panel_placement_notes: input.data.panel_placement_notes,
    inverter_location: input.data.inverter_location,
    cable_routing_notes: input.data.cable_routing_notes,
    estimated_generation_kwh_year: input.data.estimated_generation_kwh_year,
    // Section 7: Signatures
    surveyor_signature: input.data.surveyor_signature,
    customer_signature: input.data.customer_signature,
    // Section 2: Mounting extensions
    mounting_feasibility_checked: input.data.mounting_feasibility_checked ?? false,
    shadow_analysis_done: input.data.shadow_analysis_done ?? false,
    roof_condition_photo_path: input.data.roof_condition_photo_path,
    shadow_area_photo_path: input.data.shadow_area_photo_path,
    // Section 3: Client Discussion
    mounting_procedure_explained: input.data.mounting_procedure_explained ?? false,
    fixing_arrangement_discussed: input.data.fixing_arrangement_discussed ?? false,
    // Section 4: Equipment Location
    inverter_location_finalized: input.data.inverter_location_finalized ?? false,
    inverter_location_photo_path: input.data.inverter_location_photo_path,
    dc_routing_finalized: input.data.dc_routing_finalized ?? false,
    dc_routing_photo_path: input.data.dc_routing_photo_path,
    earthing_pit_finalized: input.data.earthing_pit_finalized ?? false,
    earthing_pit_photo_path: input.data.earthing_pit_photo_path,
    la_location_finalized: input.data.la_location_finalized ?? false,
    la_location_photo_path: input.data.la_location_photo_path,
    termination_point_finalized: input.data.termination_point_finalized ?? false,
    termination_point_photo_path: input.data.termination_point_photo_path,
    spare_feeder_available: input.data.spare_feeder_available ?? false,
    spare_feeder_photo_path: input.data.spare_feeder_photo_path,
    dg_eb_checked: input.data.dg_eb_checked ?? false,
    dg_eb_photo_path: input.data.dg_eb_photo_path,
    spare_feeder_rating: input.data.spare_feeder_rating,
    spare_feeder_rating_photo_path: input.data.spare_feeder_rating_photo_path,
    // Section 5: AC Cable
    ac_routing_finalized: input.data.ac_routing_finalized ?? false,
    ac_routing_photo_path: input.data.ac_routing_photo_path,
    // Section 6: Deviations
    additional_panels_required: input.data.additional_panels_required ?? false,
    additional_panels_remarks: input.data.additional_panels_remarks,
    additional_inverter_required: input.data.additional_inverter_required ?? false,
    additional_inverter_remarks: input.data.additional_inverter_remarks,
    routing_changes: input.data.routing_changes,
    cable_size_changes: input.data.cable_size_changes,
    other_special_requests: input.data.other_special_requests,
    // Status
    survey_status: input.data.survey_status ?? 'draft',
  };

  if (input.surveyId) {
    // Update existing
    const { error } = await supabase
      .from('lead_site_surveys')
      .update(surveyData as any)
      .eq('id', input.surveyId);

    if (error) {
      console.error(`${op} Update failed:`, { code: error.code, message: error.message });
      return { success: false, error: error.message };
    }
  } else {
    // Create new
    const { error } = await supabase
      .from('lead_site_surveys')
      .insert(surveyData as any);

    if (error) {
      console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
      return { success: false, error: error.message };
    }
  }

  // Auto-advance project status: order_received → yet_to_start when survey is first created
  if (!input.surveyId && project.status === 'order_received') {
    const nextStatus = getNextStatus(project.status as string);
    if (nextStatus) {
      console.log(`${op} Auto-advancing project status: ${project.status} → ${nextStatus}`);
      await supabase
        .from('projects')
        .update({ status: nextStatus } as any)
        .eq('id', input.projectId)
        .eq('status', project.status as any); // optimistic lock

      // Log status change in history (non-blocking — survey save already succeeded)
      try {
        await supabase
          .from('project_status_history')
          .insert({
            project_id: input.projectId,
            from_status: project.status,
            to_status: nextStatus,
            changed_by: employee?.id ?? null,
            reason: 'Auto-advanced: site survey completed',
          } as any);
      } catch (histErr) {
        console.error('[createOrUpdateSurvey] History insert failed (non-blocking):', {
          error: histErr instanceof Error ? histErr.message : String(histErr),
        });
      }
    }
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}
