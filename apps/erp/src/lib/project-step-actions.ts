'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { getNextStatus, getStatusLabel } from '@/lib/project-status-helpers';

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

// ── QC Inspection CRUD (V2 — structured 7-section form) ──

export async function createQcInspection(input: {
  projectId: string;
  data: {
    checklist_data: Record<string, unknown>; // QcChecklistData stored as JSONB
    overall_result: string; // 'approved' | 'rework_required'
    remarks?: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createQcInspection]';
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

  // Auto-calculate gate number
  const { count } = await supabase
    .from('qc_gate_inspections')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  const gateNumber = (count ?? 0) + 1;

  const { error } = await supabase
    .from('qc_gate_inspections')
    .insert({
      project_id: input.projectId,
      inspected_by: employee.id,
      gate_number: gateNumber,
      milestone_id: null,
      inspection_date: new Date().toISOString().split('T')[0],
      overall_result: input.data.overall_result,
      approval_status: 'submitted',
      requires_reinspection: input.data.overall_result === 'rework_required',
      checklist_items: input.data.checklist_data as any,
      remarks: input.data.remarks ?? null,
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function approveQcInspection(input: {
  projectId: string;
  inspectionId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[approveQcInspection]';
  console.log(`${op} Approving QC for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  const { error } = await supabase
    .from('qc_gate_inspections')
    .update({
      approval_status: 'approved',
      overall_result: 'approved',
      approved_by: employee.id,
      approved_at: new Date().toISOString(),
    } as any)
    .eq('id', input.inspectionId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Approve failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function requestQcRework(input: {
  projectId: string;
  inspectionId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[requestQcRework]';
  console.log(`${op} Requesting rework for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('qc_gate_inspections')
    .update({
      approval_status: 'rework_required',
      overall_result: 'rework_required',
      requires_reinspection: true,
    } as any)
    .eq('id', input.inspectionId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Rework request failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Commissioning Report CRUD ──

export async function createCommissioningReport(input: {
  projectId: string;
  data: {
    commissioning_date: string;
    system_size_kwp: number;
    panel_count_installed: number;
    inverter_serial_number: string | null;
    initial_reading_kwh: number;
    dc_voltage_v: number | null;
    dc_current_a: number | null;
    ac_voltage_v: number | null;
    ac_frequency_hz: number | null;
    earth_resistance_ohm: number | null;
    insulation_resistance_mohm: number | null;
    generation_confirmed: boolean;
    customer_explained: boolean;
    app_download_assisted: boolean;
    notes: string | null;
    // V2 fields
    string_test_data?: unknown[];
    monitoring_portal_link?: string | null;
    monitoring_login?: string | null;
    monitoring_password?: string | null;
    performance_ratio_pct?: number | null;
    status?: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createCommissioningReport]';
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

  const { error } = await supabase
    .from('commissioning_reports')
    .insert({
      project_id: input.projectId,
      prepared_by: employee.id,
      commissioning_date: input.data.commissioning_date,
      system_size_kwp: input.data.system_size_kwp,
      panel_count_installed: input.data.panel_count_installed,
      inverter_serial_number: input.data.inverter_serial_number,
      initial_reading_kwh: input.data.initial_reading_kwh,
      dc_voltage_v: input.data.dc_voltage_v,
      dc_current_a: input.data.dc_current_a,
      ac_voltage_v: input.data.ac_voltage_v,
      ac_frequency_hz: input.data.ac_frequency_hz,
      earth_resistance_ohm: input.data.earth_resistance_ohm,
      insulation_resistance_mohm: input.data.insulation_resistance_mohm,
      generation_confirmed: input.data.generation_confirmed,
      customer_explained: input.data.customer_explained,
      app_download_assisted: input.data.app_download_assisted,
      notes: input.data.notes,
      string_test_data: input.data.string_test_data ?? [],
      monitoring_portal_link: input.data.monitoring_portal_link ?? null,
      monitoring_login: input.data.monitoring_login ?? null,
      monitoring_password: input.data.monitoring_password ?? null,
      performance_ratio_pct: input.data.performance_ratio_pct ?? null,
      status: input.data.status ?? 'draft',
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Project Status Advancement ──

export async function advanceProjectStatus(input: {
  projectId: string;
  currentStatus: string;
}): Promise<{ success: boolean; newStatus?: string; error?: string }> {
  const op = '[advanceProjectStatus]';
  console.log(`${op} Starting for project: ${input.projectId}, current: ${input.currentStatus}`);

  const nextStatus = getNextStatus(input.currentStatus);
  if (!nextStatus) {
    return { success: false, error: 'Project is already at final status or status is unrecognized' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Update project status
  const updateData: Record<string, string> = { status: nextStatus };

  // Set commissioned_date when moving to completed
  if (nextStatus === 'completed') {
    updateData.commissioned_date = new Date().toISOString().split('T')[0] ?? '';
  }

  const { error: updateError } = await supabase
    .from('projects')
    .update(updateData)
    .eq('id', input.projectId)
    .eq('status', input.currentStatus as any); // optimistic lock

  if (updateError) {
    console.error(`${op} Update failed:`, { code: updateError.code, message: updateError.message });
    return { success: false, error: updateError.message };
  }

  // Log status change in history (non-blocking — status update already succeeded)
  try {
    const { error: historyError } = await supabase
      .from('project_status_history')
      .insert({
        project_id: input.projectId,
        from_status: input.currentStatus,
        to_status: nextStatus,
        changed_by: employee?.id ?? null,
        reason: `Advanced from ${getStatusLabel(input.currentStatus)} to ${getStatusLabel(nextStatus)}`,
      } as any);

    if (historyError) {
      console.error(`${op} History insert failed (non-blocking):`, {
        code: historyError.code,
        message: historyError.message,
        employeeId: employee?.id,
      });
    }
  } catch (err) {
    console.error(`${op} History insert threw (non-blocking):`, err instanceof Error ? err.message : String(err));
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, newStatus: nextStatus };
}

// ── Helper: Get milestones for QC form dropdown ──

export async function getProjectMilestones(projectId: string): Promise<{ id: string; milestone_name: string; milestone_order: number }[]> {
  const op = '[getProjectMilestones]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_milestones')
    .select('id, milestone_name, milestone_order')
    .eq('project_id', projectId)
    .order('milestone_order', { ascending: true });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

// ── Helper: Get project basic info for commissioning form defaults ──

export async function getProjectForCommissioning(projectId: string): Promise<{
  system_size_kwp: number;
  panel_count: number;
  inverter_brand: string | null;
  inverter_model: string | null;
  status: string;
} | null> {
  const op = '[getProjectForCommissioning]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('system_size_kwp, panel_count, inverter_brand, inverter_model, status')
    .eq('id', projectId)
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return null;
  }
  return data;
}

// ── BOM Line CRUD (edit/add/delete within project's proposal) ──

export async function addBomLine(input: {
  projectId: string;
  data: {
    item_category: string;
    item_description: string;
    brand: string | null;
    model: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    gst_rate: number;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addBomLine]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get proposal_id from project
  const { data: project } = await supabase
    .from('projects')
    .select('proposal_id')
    .eq('id', input.projectId)
    .single();

  if (!project?.proposal_id) {
    return { success: false, error: 'No proposal linked to this project' };
  }

  // Get next line number
  const { data: existing } = await supabase
    .from('proposal_bom_lines')
    .select('line_number')
    .eq('proposal_id', project.proposal_id)
    .order('line_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextLine = (existing?.line_number ?? 0) + 1;

  const gstAmount = input.data.quantity * input.data.unit_price * (input.data.gst_rate / 100);
  const totalPrice = input.data.quantity * input.data.unit_price + gstAmount;

  const { error } = await supabase
    .from('proposal_bom_lines')
    .insert({
      proposal_id: project.proposal_id,
      line_number: nextLine,
      item_category: input.data.item_category,
      item_description: input.data.item_description,
      brand: input.data.brand,
      model: input.data.model,
      quantity: input.data.quantity,
      unit: input.data.unit,
      unit_price: input.data.unit_price,
      gst_rate: input.data.gst_rate,
      gst_amount: gstAmount,
      gst_type: 'supply' as any,
      total_price: totalPrice,
      scope_owner: 'shiroi' as any,
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function deleteBomLine(input: {
  projectId: string;
  lineId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteBomLine]';
  console.log(`${op} Deleting line: ${input.lineId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('proposal_bom_lines')
    .delete()
    .eq('id', input.lineId);

  if (error) {
    console.error(`${op} Delete failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Cost Variance CRUD ──

export async function addCostVariance(input: {
  projectId: string;
  data: {
    item_category: string;
    estimated_cost: number;
    actual_cost: number;
    notes: string | null;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addCostVariance]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get or create profitability record
  let profitabilityId: string | null = null;
  const { data: existing } = await supabase
    .from('project_profitability')
    .select('id')
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (existing) {
    profitabilityId = existing.id;
  } else {
    // Create profitability record
    const { data: newProf, error: profError } = await supabase
      .from('project_profitability')
      .insert({
        project_id: input.projectId,
        contracted_value: 0,
        total_estimated_cost: 0,
        total_actual_cost: 0,
        estimated_margin_pct: 0,
        actual_margin_pct: 0,
      } as any)
      .select('id')
      .single();

    if (profError) {
      console.error(`${op} Profitability creation failed:`, { code: profError.code, message: profError.message });
      return { success: false, error: 'Could not create profitability record' };
    }
    profitabilityId = (newProf as any).id;
  }

  const varianceAmount = input.data.actual_cost - input.data.estimated_cost;
  const variancePct = input.data.estimated_cost > 0
    ? (varianceAmount / input.data.estimated_cost) * 100
    : 0;

  const { error } = await supabase
    .from('project_cost_variances')
    .insert({
      project_id: input.projectId,
      profitability_id: profitabilityId,
      item_category: input.data.item_category,
      estimated_cost: input.data.estimated_cost,
      actual_cost: input.data.actual_cost,
      variance_amount: varianceAmount,
      variance_pct: Math.round(variancePct * 100) / 100,
      notes: input.data.notes,
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function updateCostVariance(input: {
  projectId: string;
  varianceId: string;
  actual_cost: number;
  notes: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCostVariance]';
  console.log(`${op} Updating variance: ${input.varianceId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get existing to recalculate variance
  const { data: existing } = await supabase
    .from('project_cost_variances')
    .select('estimated_cost')
    .eq('id', input.varianceId)
    .single();

  if (!existing) return { success: false, error: 'Cost variance record not found' };

  const varianceAmount = input.actual_cost - existing.estimated_cost;
  const variancePct = existing.estimated_cost > 0
    ? (varianceAmount / existing.estimated_cost) * 100
    : 0;

  const { error } = await supabase
    .from('project_cost_variances')
    .update({
      actual_cost: input.actual_cost,
      variance_amount: varianceAmount,
      variance_pct: Math.round(variancePct * 100) / 100,
      notes: input.notes,
    })
    .eq('id', input.varianceId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Seed BOQ from BOM (legacy removed — now using project_boq_items in Phase 3 actions below) ──

// ── Vendor Delivery Challan CRUD (legacy — incoming from vendors) ──

export async function createVendorDeliveryChallan(input: {
  projectId: string;
  data: {
    vendor_dc_number: string;
    vendor_dc_date: string;
    vendor_id: string | null;
    received_date: string | null;
    status: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createVendorDeliveryChallan]';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();
  if (!employee) return { success: false, error: 'Employee profile not found' };

  const { error } = await supabase
    .from('vendor_delivery_challans')
    .insert({
      project_id: input.projectId,
      received_by: employee.id,
      vendor_dc_number: input.data.vendor_dc_number,
      vendor_dc_date: input.data.vendor_dc_date,
      vendor_id: input.data.vendor_id,
      received_date: input.data.received_date,
      status: input.data.status || 'pending',
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Helper: Get vendors for delivery form ──

export async function getVendorsForDropdown(): Promise<{ id: string; company_name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('vendors')
    .select('id, company_name')
    .is('deleted_at', null)
    .order('company_name', { ascending: true })
    .limit(200);
  return data ?? [];
}

// ── BOQ Items: Seed from BOM ──

export async function seedBoqFromBom(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[seedBoqFromBom]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Check if BOQ items already exist
  const { count: existing } = await supabase
    .from('project_boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  if (existing && existing > 0) {
    return { success: false, error: 'BOQ items already exist. Delete existing items first to re-seed.' };
  }

  // Get project's proposal ID
  const { data: project } = await supabase
    .from('projects')
    .select('proposal_id')
    .eq('id', input.projectId)
    .single();

  if (!project?.proposal_id) {
    return { success: false, error: 'No proposal linked to this project' };
  }

  // Get BOM lines
  const { data: bomLines, error: bomError } = await supabase
    .from('proposal_bom_lines')
    .select('id, line_number, item_category, item_description, brand, model, quantity, unit, unit_price, gst_rate, gst_type, total_price')
    .eq('proposal_id', project.proposal_id)
    .order('line_number', { ascending: true });

  if (bomError || !bomLines?.length) {
    return { success: false, error: 'No BOM lines found to seed from' };
  }

  // Create BOQ items from BOM
  const boqItems = bomLines.map((bom: any) => ({
    project_id: input.projectId,
    bom_line_id: bom.id,
    line_number: bom.line_number,
    item_category: bom.item_category,
    item_description: bom.item_description,
    brand: bom.brand,
    model: bom.model,
    quantity: bom.quantity,
    unit: bom.unit,
    unit_price: bom.unit_price,
    gst_rate: bom.gst_rate,
    gst_type: bom.gst_type || 'supply',
    total_price: bom.total_price,
    procurement_status: 'yet_to_finalize',
  }));

  const { error: insertError } = await supabase
    .from('project_boq_items')
    .insert(boqItems as any);

  if (insertError) {
    console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
    return { success: false, error: insertError.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, count: bomLines.length };
}

// ── BOQ Items: Update procurement status ──

export async function updateBoqItemStatus(input: {
  projectId: string;
  itemId: string;
  status: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoqItemStatus]';
  console.log(`${op} Updating ${input.itemId} to ${input.status}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: input.status } as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Delivery Challan: Create from BOQ items ──

export async function createDeliveryChallan(input: {
  projectId: string;
  items: { boqItemId: string; quantity: number; description: string; unit: string; hsnCode?: string | null; itemCategory?: string | null }[];
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  transportMode?: string;
  dispatchFrom?: string;
  dispatchTo?: string;
  notes?: string;
}): Promise<{ success: boolean; challanId?: string; error?: string }> {
  const op = '[createDeliveryChallan]';
  console.log(`${op} Creating DC for project: ${input.projectId} with ${input.items.length} items`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  // Generate DC number — sequential per project (DC-001, DC-002, etc.)
  const { count } = await supabase
    .from('delivery_challans')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  const dcNumber = `DC-${String((count ?? 0) + 1).padStart(3, '0')}`;

  // Create challan
  const now = new Date();
  const { data: challanRaw, error: challanError } = await supabase
    .from('delivery_challans')
    .insert({
      project_id: input.projectId,
      dc_number: dcNumber,
      dc_date: now.toISOString().split('T')[0],
      vehicle_number: input.vehicleNumber || null,
      driver_name: input.driverName || null,
      driver_phone: input.driverPhone || null,
      transport_mode: input.transportMode || null,
      dispatch_from: input.dispatchFrom || null,
      dispatch_to: input.dispatchTo || null,
      dispatched_by: employee?.id || null,
      status: 'draft',
      notes: input.notes || null,
    } as any)
    .select('id')
    .single();

  const challan = challanRaw as any;

  if (challanError) {
    console.error(`${op} Challan create failed:`, { code: challanError.code, message: challanError.message });
    return { success: false, error: challanError.message };
  }

  // Create challan items (with hsn_code + item_category)
  const challanItems = input.items.map((item) => ({
    challan_id: challan.id,
    boq_item_id: item.boqItemId,
    quantity: item.quantity,
    item_description: item.description,
    unit: item.unit,
    hsn_code: item.hsnCode || null,
    item_category: item.itemCategory || null,
  }));

  const { error: itemsError } = await supabase
    .from('delivery_challan_items')
    .insert(challanItems as any);

  if (itemsError) {
    console.error(`${op} Items insert failed:`, { code: itemsError.code, message: itemsError.message });
    return { success: false, error: itemsError.message };
  }

  // Update dispatched_qty on BOQ items
  for (const item of input.items) {
    await supabase.rpc('increment_boq_dispatched_qty' as any, {
      p_item_id: item.boqItemId,
      p_qty: item.quantity,
    }).then(({ error: rpcError }) => {
      if (rpcError) {
        // Fallback: manual update
        console.warn(`${op} RPC not available, updating manually`);
      }
    });

    // Manual fallback — directly update dispatched qty
    const { data: boqItemRaw } = await supabase
      .from('project_boq_items')
      .select('dispatched_qty')
      .eq('id', item.boqItemId)
      .single();
    const boqItem = boqItemRaw as any;

    if (boqItem) {
      const newQty = (Number(boqItem.dispatched_qty) || 0) + item.quantity;
      await supabase
        .from('project_boq_items')
        .update({ dispatched_qty: newQty } as any)
        .eq('id', item.boqItemId);
    }
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, challanId: challan.id };
}

// ── DC: Submit (finalize) a delivery challan ──

export async function submitDeliveryChallan(input: {
  projectId: string;
  challanId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[submitDeliveryChallan]';
  console.log(`${op} Submitting DC ${input.challanId} for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('delivery_challans')
    .update({
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
    } as any)
    .eq('id', input.challanId)
    .eq('project_id', input.projectId)
    .eq('status', 'draft');

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── DC: Get project site address for auto-fill ──

export async function getProjectSiteAddress(input: {
  projectId: string;
}): Promise<string> {
  const op = '[getProjectSiteAddress]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('site_address_line1, site_address_line2, site_city, site_state, site_pincode')
    .eq('id', input.projectId)
    .single();

  if (error || !data) {
    console.error(`${op} Query failed:`, { error: error?.message, projectId: input.projectId });
    return '';
  }

  return [data.site_address_line1, data.site_address_line2, data.site_city, data.site_state, data.site_pincode]
    .filter(Boolean)
    .join(', ');
}

// ── Actuals: Update BOQ item quantity (for returned materials) ──

export async function updateBoqItemQuantity(input: {
  projectId: string;
  itemId: string;
  newQuantity: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoqItemQuantity]';
  console.log(`${op} Updating BOQ item ${input.itemId} qty to ${input.newQuantity}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Check project is not locked
  const { data: proj } = await supabase
    .from('projects')
    .select('actuals_locked')
    .eq('id', input.projectId)
    .single();

  if ((proj as any)?.actuals_locked) {
    return { success: false, error: 'Project actuals are locked. Unlock first to make changes.' };
  }

  // Update quantity and recalculate total_price
  const { data: item } = await supabase
    .from('project_boq_items')
    .select('unit_price, gst_rate')
    .eq('id', input.itemId)
    .single();

  const unitPrice = Number((item as any)?.unit_price ?? 0);
  const gstRate = Number((item as any)?.gst_rate ?? 0);
  const newTotal = input.newQuantity * unitPrice * (1 + gstRate / 100);

  const { error } = await supabase
    .from('project_boq_items')
    .update({
      quantity: input.newQuantity,
      total_price: newTotal,
    } as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Actuals: Lock project (make BOI/BOQ/Actuals read-only) ──

export async function lockProjectActuals(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[lockProjectActuals]';
  console.log(`${op} Locking actuals for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  const { error } = await supabase
    .from('projects')
    .update({
      actuals_locked: true,
      actuals_locked_at: new Date().toISOString(),
      actuals_locked_by: employee?.id || null,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Lock failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Actuals: Unlock project (PM only) ──

export async function unlockProjectActuals(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[unlockProjectActuals]';
  console.log(`${op} Unlocking actuals for project: ${input.projectId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('projects')
    .update({
      actuals_locked: false,
      actuals_locked_at: null,
      actuals_locked_by: null,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Unlock failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Milestones: Seed defaults ──

const DEFAULT_MILESTONES = [
  { milestone_name: 'material_delivery', milestone_order: 1, is_payment_gate: false, payment_gate_number: null },
  { milestone_name: 'structure_installation', milestone_order: 2, is_payment_gate: false, payment_gate_number: null },
  { milestone_name: 'panel_installation', milestone_order: 3, is_payment_gate: false, payment_gate_number: null },
  { milestone_name: 'electrical_work', milestone_order: 4, is_payment_gate: true, payment_gate_number: 1 },
  { milestone_name: 'earthing_work', milestone_order: 5, is_payment_gate: false, payment_gate_number: null },
  { milestone_name: 'civil_work', milestone_order: 6, is_payment_gate: false, payment_gate_number: null },
  { milestone_name: 'testing_commissioning', milestone_order: 7, is_payment_gate: true, payment_gate_number: 2 },
  { milestone_name: 'net_metering', milestone_order: 8, is_payment_gate: false, payment_gate_number: null },
  { milestone_name: 'handover', milestone_order: 9, is_payment_gate: true, payment_gate_number: 3 },
  { milestone_name: 'follow_ups', milestone_order: 10, is_payment_gate: false, payment_gate_number: null },
];

export async function seedProjectMilestones(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[seedProjectMilestones]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Check if milestones already exist
  const { count: existing } = await supabase
    .from('project_milestones')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  if (existing && existing > 0) {
    return { success: false, error: 'Milestones already exist. Cannot re-seed.' };
  }

  const milestones = DEFAULT_MILESTONES.map((m) => ({
    project_id: input.projectId,
    ...m,
    status: 'pending',
    completion_pct: 0,
  }));

  const { error: insertError } = await supabase
    .from('project_milestones')
    .insert(milestones as any);

  if (insertError) {
    console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
    return { success: false, error: insertError.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, count: milestones.length };
}

// ── Milestones: Update status and dates ──

export async function updateMilestoneStatus(input: {
  projectId: string;
  milestoneId: string;
  status?: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  actual_start_date?: string | null;
  actual_end_date?: string | null;
  is_blocked?: boolean;
  blocked_reason?: string | null;
  notes?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateMilestoneStatus]';
  console.log(`${op} Updating milestone ${input.milestoneId}`);

  const supabase = await createClient();

  const updateData: Record<string, any> = {};

  if (input.status !== undefined) {
    updateData.status = input.status;
    // Auto-set dates based on status transitions
    if (input.status === 'in_progress' && !input.actual_start_date) {
      updateData.actual_start_date = new Date().toISOString().split('T')[0];
    }
    if (input.status === 'completed' && !input.actual_end_date) {
      updateData.actual_end_date = new Date().toISOString().split('T')[0];
      updateData.completion_pct = 100;
    }
  }

  if (input.planned_start_date !== undefined) updateData.planned_start_date = input.planned_start_date;
  if (input.planned_end_date !== undefined) updateData.planned_end_date = input.planned_end_date;
  if (input.actual_start_date !== undefined) updateData.actual_start_date = input.actual_start_date;
  if (input.actual_end_date !== undefined) updateData.actual_end_date = input.actual_end_date;
  if (input.notes !== undefined) updateData.notes = input.notes;

  if (input.is_blocked !== undefined) {
    updateData.is_blocked = input.is_blocked;
    if (input.is_blocked) {
      updateData.blocked_reason = input.blocked_reason ?? null;
      updateData.blocked_since = new Date().toISOString();
      updateData.status = 'blocked';
    } else {
      updateData.blocked_reason = null;
      updateData.blocked_since = null;
      // Revert to in_progress when unblocked
      if (!input.status) updateData.status = 'in_progress';
    }
  }

  if (Object.keys(updateData).length === 0) {
    return { success: true }; // nothing to update
  }

  const { error } = await supabase
    .from('project_milestones')
    .update(updateData as any)
    .eq('id', input.milestoneId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Quick Task: Create from Execution step ──

export async function createQuickTask(input: {
  projectId: string;
  milestoneId?: string;
  title: string;
  priority?: string;
  dueDate?: string;
  assignedTo?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const op = '[createQuickTask]';
  console.log(`${op} Creating task for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee not found' };

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      project_id: input.projectId,
      milestone_id: input.milestoneId || null,
      title: input.title,
      priority: input.priority || 'medium',
      due_date: input.dueDate || null,
      entity_type: 'project',
      entity_id: input.projectId,
      created_by: employee.id,
      assigned_to: input.assignedTo || employee.id,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true, taskId: task?.id };
}

// ── Commissioning Report: Update existing ──

export async function updateCommissioningReport(input: {
  projectId: string;
  reportId: string;
  data: {
    commissioning_date?: string;
    system_size_kwp?: number;
    panel_count_installed?: number;
    inverter_serial_number?: string | null;
    initial_reading_kwh?: number;
    dc_voltage_v?: number | null;
    dc_current_a?: number | null;
    ac_voltage_v?: number | null;
    ac_frequency_hz?: number | null;
    earth_resistance_ohm?: number | null;
    insulation_resistance_mohm?: number | null;
    generation_confirmed?: boolean;
    customer_explained?: boolean;
    app_download_assisted?: boolean;
    notes?: string | null;
    status?: string;
    // V2 fields
    string_test_data?: unknown[];
    monitoring_portal_link?: string | null;
    monitoring_login?: string | null;
    monitoring_password?: string | null;
    performance_ratio_pct?: number | null;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCommissioningReport]';
  console.log(`${op} Updating report ${input.reportId} for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updatePayload: Record<string, unknown> = {};
  const d = input.data;
  if (d.commissioning_date !== undefined) updatePayload.commissioning_date = d.commissioning_date;
  if (d.system_size_kwp !== undefined) updatePayload.system_size_kwp = d.system_size_kwp;
  if (d.panel_count_installed !== undefined) updatePayload.panel_count_installed = d.panel_count_installed;
  if (d.inverter_serial_number !== undefined) updatePayload.inverter_serial_number = d.inverter_serial_number;
  if (d.initial_reading_kwh !== undefined) updatePayload.initial_reading_kwh = d.initial_reading_kwh;
  if (d.dc_voltage_v !== undefined) updatePayload.dc_voltage_v = d.dc_voltage_v;
  if (d.dc_current_a !== undefined) updatePayload.dc_current_a = d.dc_current_a;
  if (d.ac_voltage_v !== undefined) updatePayload.ac_voltage_v = d.ac_voltage_v;
  if (d.ac_frequency_hz !== undefined) updatePayload.ac_frequency_hz = d.ac_frequency_hz;
  if (d.earth_resistance_ohm !== undefined) updatePayload.earth_resistance_ohm = d.earth_resistance_ohm;
  if (d.insulation_resistance_mohm !== undefined) updatePayload.insulation_resistance_mohm = d.insulation_resistance_mohm;
  if (d.generation_confirmed !== undefined) updatePayload.generation_confirmed = d.generation_confirmed;
  if (d.customer_explained !== undefined) updatePayload.customer_explained = d.customer_explained;
  if (d.app_download_assisted !== undefined) updatePayload.app_download_assisted = d.app_download_assisted;
  if (d.notes !== undefined) updatePayload.notes = d.notes;
  if (d.status !== undefined) updatePayload.status = d.status;
  if (d.string_test_data !== undefined) updatePayload.string_test_data = d.string_test_data;
  if (d.monitoring_portal_link !== undefined) updatePayload.monitoring_portal_link = d.monitoring_portal_link;
  if (d.monitoring_login !== undefined) updatePayload.monitoring_login = d.monitoring_login;
  if (d.monitoring_password !== undefined) updatePayload.monitoring_password = d.monitoring_password;
  if (d.performance_ratio_pct !== undefined) updatePayload.performance_ratio_pct = d.performance_ratio_pct;

  if (Object.keys(updatePayload).length === 0) {
    return { success: true };
  }

  const { error } = await supabase
    .from('commissioning_reports')
    .update(updatePayload as any)
    .eq('id', input.reportId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function finalizeCommissioningReport(input: {
  projectId: string;
  reportId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[finalizeCommissioningReport]';
  console.log(`${op} Finalizing report for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('commissioning_reports')
    .update({ status: 'finalized' } as any)
    .eq('id', input.reportId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Finalize failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Task: Toggle completion ──

export async function toggleTaskCompletion(input: {
  taskId: string;
  isCompleted: boolean;
  projectId?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[toggleTaskCompletion]';
  console.log(`${op} Setting task ${input.taskId} to ${input.isCompleted ? 'completed' : 'pending'}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, unknown> = {
    is_completed: input.isCompleted,
  };
  if (input.isCompleted) {
    updateData.completed_at = new Date().toISOString();
  } else {
    updateData.completed_at = null;
  }

  const { error } = await supabase
    .from('tasks')
    .update(updateData as any)
    .eq('id', input.taskId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  if (input.projectId) {
    revalidatePath(`/projects/${input.projectId}`);
  }
  revalidatePath('/tasks');
  revalidatePath('/my-tasks');
  return { success: true };
}

// ── BOI Version Management (multi-BOI: BOI-1, BOI-2, etc.) ──

export async function createBoiVersion(input: {
  projectId: string;
}): Promise<{ success: boolean; boiId?: string; error?: string }> {
  const op = '[createBoiVersion]';
  console.log(`${op} Creating new BOI for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', user.id).single();
  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Get next BOI number
  const { data: maxBoi } = await supabase
    .from('project_bois')
    .select('boi_number')
    .eq('project_id', input.projectId)
    .order('boi_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNumber = ((maxBoi as any)?.boi_number ?? 0) + 1;

  const { data, error } = await supabase
    .from('project_bois')
    .insert({
      project_id: input.projectId,
      boi_number: nextNumber,
      status: 'draft',
      prepared_by: employee.id,
    } as any)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, boiId: (data as any).id };
}

export async function submitBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[submitBoiVersion]';
  console.log(`${op} Submitting BOI ${input.boiId}`);

  const supabase = await createClient();

  // Verify items exist
  const { count } = await supabase
    .from('project_boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('boi_id', input.boiId);

  if (!count || count === 0) {
    return { success: false, error: 'Cannot submit empty BOI. Add items first.' };
  }

  const { error } = await supabase
    .from('project_bois')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() } as any)
    .eq('id', input.boiId)
    .eq('status', 'draft' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function approveBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[approveBoiVersion]';
  console.log(`${op} Approving BOI ${input.boiId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', user.id).single();

  const { error } = await supabase
    .from('project_bois')
    .update({
      status: 'approved',
      approved_by: employee?.id,
      approved_at: new Date().toISOString(),
    } as any)
    .eq('id', input.boiId)
    .eq('status', 'submitted' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Update project-level flag for backward compat
  await supabase
    .from('projects')
    .update({ boi_locked: true, boi_locked_by: employee?.id, boi_locked_at: new Date().toISOString() } as any)
    .eq('id', input.projectId);

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function lockBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[lockBoiVersion]';
  console.log(`${op} Locking BOI ${input.boiId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees').select('id').eq('profile_id', user.id).single();

  const { error } = await supabase
    .from('project_bois')
    .update({
      status: 'locked',
      locked_by: employee?.id,
      locked_at: new Date().toISOString(),
    } as any)
    .eq('id', input.boiId)
    .eq('status', 'approved' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

export async function unlockBoiVersion(input: {
  projectId: string;
  boiId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[unlockBoiVersion]';
  console.log(`${op} Unlocking BOI ${input.boiId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('project_bois')
    .update({
      status: 'approved',
      locked_by: null,
      locked_at: null,
    } as any)
    .eq('id', input.boiId)
    .eq('status', 'locked' as any);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Add new item directly (with optional boiId) ──

export async function addBoqItem(input: {
  projectId: string;
  boiId?: string;
  data: {
    item_category: string;
    item_description: string;
    brand: string | null;
    model: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    gst_rate: number;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addBoqItem]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get next line number
  const { data: existing } = await supabase
    .from('project_boq_items')
    .select('line_number')
    .eq('project_id', input.projectId)
    .order('line_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextLine = ((existing as any)?.line_number ?? 0) + 1;

  const gstAmount = input.data.quantity * input.data.unit_price * (input.data.gst_rate / 100);
  const totalPrice = input.data.quantity * input.data.unit_price + gstAmount;

  const insertData: Record<string, unknown> = {
    project_id: input.projectId,
    line_number: nextLine,
    item_category: input.data.item_category,
    item_description: input.data.item_description,
    brand: input.data.brand,
    model: input.data.model,
    quantity: input.data.quantity,
    unit: input.data.unit,
    unit_price: input.data.unit_price,
    gst_rate: input.data.gst_rate,
    gst_type: 'supply',
    total_price: totalPrice,
    procurement_status: 'yet_to_finalize',
  };
  if (input.boiId) insertData.boi_id = input.boiId;

  const { error } = await supabase
    .from('project_boq_items')
    .insert(insertData as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Update item details (rate, GST, status, description, etc.) ──

export async function updateBoqItem(input: {
  projectId: string;
  itemId: string;
  data: {
    item_description?: string;
    brand?: string | null;
    model?: string | null;
    quantity?: number;
    unit_price?: number;
    gst_rate?: number;
    procurement_status?: string;
    vendor_name?: string | null;
    notes?: string | null;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateBoqItem]';
  console.log(`${op} Updating item ${input.itemId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const updateData: Record<string, any> = {};
  const d = input.data;

  if (d.item_description !== undefined) updateData.item_description = d.item_description;
  if (d.brand !== undefined) updateData.brand = d.brand;
  if (d.model !== undefined) updateData.model = d.model;
  if (d.quantity !== undefined) updateData.quantity = d.quantity;
  if (d.unit_price !== undefined) updateData.unit_price = d.unit_price;
  if (d.gst_rate !== undefined) updateData.gst_rate = d.gst_rate;
  if (d.procurement_status !== undefined) updateData.procurement_status = d.procurement_status;
  if (d.vendor_name !== undefined) updateData.vendor_name = d.vendor_name;
  if (d.notes !== undefined) updateData.notes = d.notes;

  // Recalculate total if rate or qty changed
  if (d.unit_price !== undefined || d.quantity !== undefined || d.gst_rate !== undefined) {
    // Get current values for fields not being updated
    const { data: current } = await supabase
      .from('project_boq_items')
      .select('quantity, unit_price, gst_rate')
      .eq('id', input.itemId)
      .single();

    if (current) {
      const qty = d.quantity ?? Number(current.quantity);
      const rate = d.unit_price ?? Number(current.unit_price);
      const gst = d.gst_rate ?? Number(current.gst_rate);
      const gstAmount = qty * rate * (gst / 100);
      updateData.total_price = qty * rate + gstAmount;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return { success: true };
  }

  const { error } = await supabase
    .from('project_boq_items')
    .update(updateData as any)
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ Items: Delete ──

export async function deleteBoqItem(input: {
  projectId: string;
  itemId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[deleteBoqItem]';
  console.log(`${op} Deleting item ${input.itemId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('project_boq_items')
    .delete()
    .eq('id', input.itemId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Delete failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOI: Lock (submit) ──

export async function lockBoi(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[lockBoi]';
  console.log(`${op} Locking BOI for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Verify BOQ items exist
  const { count } = await supabase
    .from('project_boq_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', input.projectId);

  if (!count || count === 0) {
    return { success: false, error: 'No BOI items to submit. Add items first.' };
  }

  const { error } = await supabase
    .from('projects')
    .update({
      boi_locked: true,
      boi_locked_at: new Date().toISOString(),
      boi_locked_by: employee.id,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOI: Unlock (for corrections) ──

export async function unlockBoi(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[unlockBoi]';
  console.log(`${op} Unlocking BOI for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({
      boi_locked: false,
      boi_locked_at: null,
      boi_locked_by: null,
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ: Mark completed ──

export async function completeBoq(input: {
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[completeBoq]';
  console.log(`${op} Completing BOQ for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({
      boq_completed: true,
      boq_completed_at: new Date().toISOString(),
    } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ: Update project manual cost (for margin calc) ──

export async function updateProjectCostManual(input: {
  projectId: string;
  projectCost: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateProjectCostManual]';
  console.log(`${op} Updating manual cost for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({ project_cost_manual: input.projectCost } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── BOQ: Send to Purchase Team (mark items as yet_to_place) ──

export async function sendBoqToPurchase(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[sendBoqToPurchase]';
  console.log(`${op} Sending BOQ to purchase for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID for tracking
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  // Update all "yet_to_finalize" items to "yet_to_place"
  const { data, error } = await supabase
    .from('project_boq_items')
    .update({ procurement_status: 'yet_to_place' } as any)
    .eq('project_id', input.projectId)
    .eq('procurement_status', 'yet_to_finalize')
    .select('id');

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Set project-level procurement tracking
  if (data && data.length > 0) {
    await supabase
      .from('projects')
      .update({
        procurement_status: 'yet_to_place',
        boq_sent_to_purchase_at: new Date().toISOString(),
        boq_sent_to_purchase_by: employee?.id ?? null,
      } as any)
      .eq('id', input.projectId);
  }

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/procurement');
  return { success: true, count: data?.length ?? 0 };
}

// ── BOQ: Apply Price Book rates to items without pricing ──

export async function applyPriceBookRates(input: {
  projectId: string;
}): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  const op = '[applyPriceBookRates]';
  console.log(`${op} Applying price book rates for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get all BOQ items with zero or null unit_price
  const { data: items, error: itemsError } = await supabase
    .from('project_boq_items')
    .select('id, item_category, item_description, quantity, unit_price')
    .eq('project_id', input.projectId);

  if (itemsError || !items) {
    return { success: false, error: itemsError?.message ?? 'Failed to fetch items' };
  }

  // Get price book entries
  const { data: priceBook } = await supabase
    .from('price_book')
    .select('item_category, item_description, base_price, gst_rate')
    .eq('is_active', true);

  if (!priceBook || priceBook.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  // Build lookup map by category+description (lowercase)
  const pbMap: Record<string, { base_price: number; gst_rate: number }> = {};
  for (const pb of priceBook) {
    pbMap[`${pb.item_category}::${pb.item_description}`.toLowerCase()] = {
      base_price: Number(pb.base_price),
      gst_rate: Number(pb.gst_rate),
    };
  }

  // Update items with zero price that match price book entries
  let updatedCount = 0;
  for (const item of items) {
    if (Number(item.unit_price) > 0) continue; // Already has pricing

    const key = `${item.item_category}::${item.item_description}`.toLowerCase();
    const match = pbMap[key];
    if (!match) continue;

    const qty = Number(item.quantity);
    const gstAmount = qty * match.base_price * (match.gst_rate / 100);
    const totalPrice = qty * match.base_price + gstAmount;

    const { error: updateError } = await supabase
      .from('project_boq_items')
      .update({
        unit_price: match.base_price,
        gst_rate: match.gst_rate,
        total_price: totalPrice,
      } as any)
      .eq('id', item.id);

    if (!updateError) updatedCount++;
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, updatedCount };
}

// ── BOQ: Update estimated site expenses budget ──

export async function updateEstimatedSiteExpenses(input: {
  projectId: string;
  budget: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateEstimatedSiteExpenses]';
  console.log(`${op} Updating estimated site expenses for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('projects')
    .update({ estimated_site_expenses_budget: input.budget } as any)
    .eq('id', input.projectId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── Employees: Get active list for dropdowns ──

export async function getActiveEmployeesForProject(): Promise<{ id: string; full_name: string }[]> {
  const op = '[getActiveEmployeesForProject]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
