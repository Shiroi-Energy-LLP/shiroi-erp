import { createClient } from '@repo/supabase/server';

export async function getStepDetailsData(projectId: string) {
  const op = '[getStepDetailsData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select(
      'id, project_number, customer_name, customer_phone, customer_email, status, system_size_kwp, system_type, site_address_line1, site_address_line2, site_city, site_state, site_pincode, contracted_value, panel_brand, panel_model, panel_wattage, panel_count, inverter_brand, inverter_model, inverter_capacity_kw, battery_brand, battery_model, battery_capacity_kwh, structure_type, completion_pct',
    )
    .eq('id', projectId)
    .single();

  if (projectError) {
    console.error(`${op} Project query failed:`, { code: projectError.code, message: projectError.message, projectId });
    throw new Error(`Failed to fetch project: ${projectError.message}`);
  }

  const { data: cashPosition, error: cashError } = await supabase
    .from('project_cash_positions')
    .select('total_contracted, total_invoiced, total_received, total_po_value, total_paid_to_vendors, net_cash_position')
    .eq('project_id', projectId)
    .maybeSingle();

  if (cashError) {
    console.error(`${op} Cash position query failed:`, { code: cashError.code, message: cashError.message, projectId });
  }

  return { project, cashPosition };
}

export async function getStepSurveyData(projectId: string) {
  const op = '[getStepSurveyData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // First get the lead_id from the project
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

  // Select all columns — new columns from migration 023 won't error on missing (Supabase ignores unknown cols in select)
  // Using * to future-proof against column additions
  const { data: survey, error: surveyError } = await supabase
    .from('lead_site_surveys')
    .select('*')
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

export async function getStepBoqData(projectId: string) {
  const op = '[getStepBoqData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Try new BOQ items table first (migration 024)
  const { data: boqItems, error: boqError } = await supabase
    .from('project_boq_items' as any)
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

export async function getStepDeliveryData(projectId: string) {
  const op = '[getStepDeliveryData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Try new delivery challans table first (migration 024)
  const { data: newChallans, error: newError } = await supabase
    .from('delivery_challans' as any)
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

  const { data: milestones, error: milestoneError } = await supabase
    .from('project_milestones')
    .select('id, milestone_name, milestone_order, status, completion_pct, is_blocked, blocked_reason, planned_start_date, planned_end_date, actual_start_date, actual_end_date')
    .eq('project_id', projectId)
    .order('milestone_order', { ascending: true });

  if (milestoneError) {
    console.error(`${op} Milestones query failed:`, { code: milestoneError.code, message: milestoneError.message, projectId });
    throw new Error(`Failed to fetch milestones: ${milestoneError.message}`);
  }

  const { count: reportCount, error: reportError } = await supabase
    .from('daily_site_reports')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (reportError) {
    console.error(`${op} Reports count query failed:`, { code: reportError.code, message: reportError.message, projectId });
  }

  // Fetch tasks linked to this project (open tasks only)
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('id, title, milestone_id, assigned_to, priority, due_date, is_completed, employees!tasks_assigned_to_fkey(full_name)')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false });

  if (taskError) {
    console.error(`${op} Tasks query failed:`, { code: taskError.code, message: taskError.message, projectId });
  }

  return { milestones: milestones ?? [], reportCount: reportCount ?? 0, tasks: tasks ?? [] };
}

export async function getStepQcData(projectId: string) {
  const op = '[getStepQcData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: inspections, error } = await supabase
    .from('qc_gate_inspections')
    .select('id, gate_number, inspection_date, overall_result, checklist_items, requires_reinspection, inspected_by, employees!qc_gate_inspections_inspected_by_fkey(full_name)')
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

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('system_size_kwp, system_type')
    .eq('id', projectId)
    .single();

  if (projectError) {
    console.error(`${op} Project query failed:`, { code: projectError.code, message: projectError.message, projectId });
    throw new Error(`Failed to fetch project: ${projectError.message}`);
  }

  const { data: application, error: appError } = await supabase
    .from('net_metering_applications')
    .select('id, discom_name, discom_status, discom_application_date, discom_application_number, ceig_required, ceig_status, ceig_application_date, ceig_approval_date, ceig_inspection_date, net_meter_installed, net_meter_installed_date, net_meter_serial_number, followup_count, next_followup_date, notes')
    .eq('project_id', projectId)
    .maybeSingle();

  if (appError) {
    console.error(`${op} Net metering query failed:`, { code: appError.code, message: appError.message, projectId });
    throw new Error(`Failed to fetch net metering application: ${appError.message}`);
  }

  return { project, application };
}

export async function getStepCommissioningData(projectId: string) {
  const op = '[getStepCommissioningData]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  const { data: report, error } = await supabase
    .from('commissioning_reports')
    .select('id, commissioning_date, system_size_kwp, panel_count_installed, dc_voltage_v, dc_current_a, ac_voltage_v, ac_frequency_hz, insulation_resistance_mohm, earth_resistance_ohm, initial_reading_kwh, generation_confirmed, customer_explained, app_download_assisted, status, inverter_serial_number, notes')
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
