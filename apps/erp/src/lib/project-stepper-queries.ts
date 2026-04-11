import { createClient } from '@repo/supabase/server';

export async function getStepDetailsData(projectId: string) {
  const op = '[getStepDetailsData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Parallelize the two independent queries
  const [projectResult, cashResult] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'id, project_number, customer_name, customer_phone, customer_email, status, system_size_kwp, system_type, site_address_line1, site_address_line2, site_city, site_state, site_pincode, contracted_value, panel_brand, panel_model, panel_wattage, panel_count, inverter_brand, inverter_model, inverter_capacity_kw, battery_brand, battery_model, battery_capacity_kwh, structure_type, completion_pct',
      )
      .eq('id', projectId)
      .single(),
    supabase
      .from('project_cash_positions')
      .select('total_contracted, total_invoiced, total_received, total_po_value, total_paid_to_vendors, net_cash_position')
      .eq('project_id', projectId)
      .maybeSingle(),
  ]);

  if (projectResult.error) {
    console.error(`${op} Project query failed:`, { code: projectResult.error.code, message: projectResult.error.message, projectId });
    throw new Error(`Failed to fetch project: ${projectResult.error.message}`);
  }

  if (cashResult.error) {
    console.error(`${op} Cash position query failed:`, { code: cashResult.error.code, message: cashResult.error.message, projectId });
  }

  return { project: projectResult.data, cashPosition: cashResult.data };
}

export async function getStepSurveyData(projectId: string) {
  const op = '[getStepSurveyData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Get lead_id first (needed to query surveys)
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('lead_id')
    .eq('id', projectId)
    .single();

  if (projectError) {
    console.error(`${op} Project query failed:`, { code: projectError.code, message: projectError.message, projectId });
    throw new Error(`Failed to fetch project lead: ${projectError.message}`);
  }

  if (!project?.lead_id) return null;

  const { data: survey, error: surveyError } = await supabase
    .from('lead_site_surveys')
    .select('id, lead_id, survey_date, survey_status, contact_person_name, contact_phone, gps_lat, gps_lng, site_access_notes, roof_type, roof_condition, roof_age_years, roof_orientation, roof_tilt_degrees, roof_area_sqft, usable_area_sqft, number_of_floors, building_height_ft, mounting_feasibility_checked, shadow_analysis_done, roof_condition_photo_path, shadow_area_photo_path, structure_type, existing_structure_condition, mounting_procedure_explained, fixing_arrangement_discussed, existing_load_kw, sanctioned_load_kw, meter_type, supply_voltage, discom_name, earthing_type, earthing_condition, net_metering_eligible, inverter_location_finalized, inverter_location_photo_path, dc_routing_finalized, dc_routing_photo_path, earthing_pit_finalized, earthing_pit_photo_path, la_location_finalized, la_location_photo_path, termination_point_finalized, termination_point_photo_path, spare_feeder_available, spare_feeder_photo_path, dg_eb_checked, dg_eb_photo_path, spare_feeder_rating, spare_feeder_rating_photo_path, ac_routing_finalized, ac_routing_photo_path, shading_assessment, shade_sources, morning_shade, afternoon_shade, shading_notes, recommended_size_kwp, recommended_system_type, estimated_generation_kwh_year, panel_placement_notes, inverter_location, cable_routing_notes, additional_panels_required, additional_panels_remarks, additional_inverter_required, additional_inverter_remarks, routing_changes, cable_size_changes, other_special_requests, notes, surveyor_signature, customer_signature, created_at')
    .eq('lead_id', project.lead_id)
    .order('survey_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (surveyError) {
    console.error(`${op} Survey query failed:`, { code: surveyError.code, message: surveyError.message, projectId });
    throw new Error(`Failed to fetch site survey: ${surveyError.message}`);
  }

  return survey as any;
}

export async function getStepBomData(projectId: string) {
  const op = '[getStepBomData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('proposal_id')
    .eq('id', projectId)
    .single();

  if (projectError) {
    console.error(`${op} Project query failed:`, { code: projectError.code, message: projectError.message, projectId });
    throw new Error(`Failed to fetch project proposal: ${projectError.message}`);
  }

  if (!project?.proposal_id) return [];

  const { data: bomLines, error: bomError } = await supabase
    .from('proposal_bom_lines')
    .select('id, item_category, item_description, quantity, unit, unit_price, total_price, gst_rate, gst_amount, brand, model')
    .eq('proposal_id', project.proposal_id)
    .order('line_number', { ascending: true });

  if (bomError) {
    console.error(`${op} BOM query failed:`, { code: bomError.code, message: bomError.message, projectId });
    throw new Error(`Failed to fetch BOM lines: ${bomError.message}`);
  }

  return bomLines ?? [];
}

export async function getBoiState(projectId: string) {
  const op = '[getBoiState]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('boi_locked, boi_locked_at, boi_locked_by, boq_completed, boq_completed_at, project_cost_manual, contracted_value, proposal_id, estimated_site_expenses_budget')
    .eq('id', projectId)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    return null;
  }

  // Get prepared-by employee name if BOI is locked
  let preparedByName: string | null = null;
  if ((data as any)?.boi_locked_by) {
    const { data: emp } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', (data as any).boi_locked_by)
      .single();
    preparedByName = emp?.full_name ?? null;
  }

  return { ...(data as any), preparedByName };
}

/** Fetch all BOI versions for a project with employee names */
export async function getBoisForProject(projectId: string) {
  const op = '[getBoisForProject]';
  const supabase = await createClient();

  const { data: bois, error } = await supabase
    .from('project_bois')
    .select('*')
    .eq('project_id', projectId)
    .order('boi_number', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    return [];
  }

  if (!bois || bois.length === 0) return [];

  // Collect unique employee IDs for name lookup
  const empIds = new Set<string>();
  for (const b of bois) {
    if ((b as any).prepared_by) empIds.add((b as any).prepared_by);
    if ((b as any).approved_by) empIds.add((b as any).approved_by);
    if ((b as any).locked_by) empIds.add((b as any).locked_by);
  }

  let empMap: Record<string, string> = {};
  if (empIds.size > 0) {
    const { data: emps } = await supabase
      .from('employees')
      .select('id, full_name')
      .in('id', Array.from(empIds));
    empMap = Object.fromEntries((emps ?? []).map(e => [e.id, e.full_name]));
  }

  return bois.map(b => ({
    ...(b as any),
    prepared_by_name: (b as any).prepared_by ? empMap[(b as any).prepared_by] ?? null : null,
    approved_by_name: (b as any).approved_by ? empMap[(b as any).approved_by] ?? null : null,
    locked_by_name: (b as any).locked_by ? empMap[(b as any).locked_by] ?? null : null,
  }));
}

/** Fetch BOQ items for a specific BOI version */
export async function getBoiItems(boiId: string) {
  const op = '[getBoiItems]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_boq_items')
    .select('id, boi_id, line_number, item_category, item_description, brand, model, quantity, unit, unit_price, gst_rate, total_price, procurement_status, notes, created_at')
    .eq('boi_id', boiId)
    .order('line_number', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, boiId });
    return [];
  }

  return data ?? [];
}

export async function getStepBoqData(projectId: string) {
  const op = '[getStepBoqData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Try new BOQ items table first (migration 024)
  const { data: boqItems, error: boqError } = await supabase
    .from('project_boq_items')
    .select('*')
    .eq('project_id', projectId)
    .order('line_number', { ascending: true });

  if (!boqError && boqItems && boqItems.length > 0) {
    return { type: 'items' as const, items: boqItems as any[], variances: [] };
  }

  // Fallback to legacy cost variances
  const { data: variances, error } = await supabase
    .from('project_cost_variances')
    .select('id, item_category, estimated_cost, actual_cost, variance_amount, variance_pct')
    .eq('project_id', projectId)
    .order('item_category', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    // Non-fatal — return empty
  }

  return { type: 'variances' as const, items: [], variances: variances ?? [] };
}

/** Fetch approved site expenses total for a project */
export async function getApprovedSiteExpenses(projectId: string): Promise<number> {
  const op = '[getApprovedSiteExpenses]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_site_expenses')
    .select('amount')
    .eq('project_id', projectId)
    .eq('status', 'approved');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    return 0;
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

/** Fetch price book entries for auto-pricing BOQ items */
export async function getPriceBookMap(): Promise<Record<string, { base_price: number; gst_rate: number }>> {
  const op = '[getPriceBookMap]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('price_book')
    .select('item_category, item_description, base_price, gst_rate')
    .eq('is_active', true);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return {};
  }

  // Build a map keyed by lowercase category+description for fuzzy matching
  const map: Record<string, { base_price: number; gst_rate: number }> = {};
  for (const item of data ?? []) {
    const key = `${item.item_category}::${item.item_description}`.toLowerCase();
    map[key] = { base_price: Number(item.base_price), gst_rate: Number(item.gst_rate) };
  }
  return map;
}

export async function getStepDeliveryData(projectId: string) {
  const op = '[getStepDeliveryData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Try new delivery challans table first (migration 024)
  const { data: newChallans, error: newError } = await supabase
    .from('delivery_challans')
    .select('*, delivery_challan_items(*)')
    .eq('project_id', projectId)
    .order('dc_date', { ascending: false });

  // Also get vendor delivery challans (legacy)
  const { data: vendorChallans, error: vendorError } = await supabase
    .from('vendor_delivery_challans')
    .select('id, vendor_dc_number, vendor_dc_date, status, received_date, vendor_id, vendors!vendor_delivery_challans_vendor_id_fkey(company_name)')
    .eq('project_id', projectId)
    .order('vendor_dc_date', { ascending: false });

  if (vendorError) {
    console.error(`${op} Vendor DC query failed:`, { code: vendorError.code, message: vendorError.message, projectId });
  }

  return {
    outgoingChallans: (newChallans ?? []) as any[],
    vendorChallans: vendorChallans ?? [],
  };
}

export async function getStepExecutionData(projectId: string) {
  const op = '[getStepExecutionData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Parallelize all three independent queries
  const [milestonesResult, reportResult, tasksResult] = await Promise.all([
    supabase
      .from('project_milestones')
      .select('id, milestone_name, milestone_order, status, completion_pct, is_blocked, blocked_reason, planned_start_date, planned_end_date, actual_start_date, actual_end_date')
      .eq('project_id', projectId)
      .order('milestone_order', { ascending: true }),
    supabase
      .from('daily_site_reports')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId),
    supabase
      .from('tasks')
      .select('id, title, milestone_id, assigned_to, assigned_date, priority, due_date, is_completed, completed_at, completed_by, remarks, category, employees!tasks_assigned_to_fkey(full_name), completedByEmployee:employees!tasks_completed_by_fkey(full_name)')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);

  if (milestonesResult.error) {
    console.error(`${op} Milestones query failed:`, { code: milestonesResult.error.code, message: milestonesResult.error.message, projectId });
    throw new Error(`Failed to fetch milestones: ${milestonesResult.error.message}`);
  }

  if (reportResult.error) {
    console.error(`${op} Reports count query failed:`, { code: reportResult.error.code, message: reportResult.error.message, projectId });
  }

  if (tasksResult.error) {
    console.error(`${op} Tasks query failed:`, { code: tasksResult.error.code, message: tasksResult.error.message, projectId });
  }

  return {
    milestones: milestonesResult.data ?? [],
    reportCount: reportResult.count ?? 0,
    tasks: tasksResult.data ?? [],
  };
}

export async function getStepQcData(projectId: string) {
  const op = '[getStepQcData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: inspections, error } = await supabase
    .from('qc_gate_inspections')
    .select('id, gate_number, inspection_date, overall_result, checklist_items, requires_reinspection, inspected_by, approval_status, approved_by, approved_at, remarks, employees!qc_gate_inspections_inspected_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('gate_number', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to fetch QC inspections: ${error.message}`);
  }

  return inspections ?? [];
}

export async function getStepLiaisonData(projectId: string) {
  const op = '[getStepLiaisonData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Parallelize the two independent queries
  const [projectResult, appResult] = await Promise.all([
    supabase
      .from('projects')
      .select('system_size_kwp, system_type')
      .eq('id', projectId)
      .single(),
    supabase
      .from('net_metering_applications')
      .select('id, discom_name, discom_status, discom_application_date, discom_application_number, ceig_required, ceig_status, ceig_application_date, ceig_approval_date, ceig_inspection_date, net_meter_installed, net_meter_installed_date, net_meter_serial_number, followup_count, next_followup_date, notes')
      .eq('project_id', projectId)
      .maybeSingle(),
  ]);

  if (projectResult.error) {
    console.error(`${op} Project query failed:`, { code: projectResult.error.code, message: projectResult.error.message, projectId });
    throw new Error(`Failed to fetch project: ${projectResult.error.message}`);
  }

  if (appResult.error) {
    console.error(`${op} Net metering query failed:`, { code: appResult.error.code, message: appResult.error.message, projectId });
    throw new Error(`Failed to fetch net metering application: ${appResult.error.message}`);
  }

  return { project: projectResult.data, application: appResult.data };
}

export async function getStepCommissioningData(projectId: string) {
  const op = '[getStepCommissioningData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: report, error } = await supabase
    .from('commissioning_reports')
    .select('id, commissioning_date, system_size_kwp, panel_count_installed, dc_voltage_v, dc_current_a, ac_voltage_v, ac_frequency_hz, insulation_resistance_mohm, earth_resistance_ohm, initial_reading_kwh, generation_confirmed, customer_explained, app_download_assisted, status, inverter_serial_number, notes, string_test_data, monitoring_portal_link, monitoring_login, monitoring_password, performance_ratio_pct, prepared_by')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to fetch commissioning report: ${error.message}`);
  }

  return report;
}

export async function getStepAmcData(projectId: string) {
  const op = '[getStepAmcData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: visits, error } = await supabase
    .from('om_visit_schedules')
    .select('id, visit_number, scheduled_date, status, visit_type, assigned_to, completed_at, employees!om_visit_schedules_assigned_to_fkey(full_name)')
    .eq('project_id', projectId)
    .order('visit_number', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to fetch O&M visit schedules: ${error.message}`);
  }

  return visits ?? [];
}
