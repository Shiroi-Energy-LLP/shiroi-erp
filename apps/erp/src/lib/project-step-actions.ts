'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { getNextStatus, getStatusLabel } from '@/lib/project-status-helpers';

// ── Survey CRUD ──

export async function createOrUpdateSurvey(input: {
  projectId: string;
  surveyId?: string; // if provided, update; otherwise create
  data: {
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

  // Auto-advance project status: advance_received → planning when survey is first created
  if (!input.surveyId && project.status === 'advance_received') {
    const nextStatus = getNextStatus(project.status as string);
    if (nextStatus) {
      console.log(`${op} Auto-advancing project status: ${project.status} → ${nextStatus}`);
      await supabase
        .from('projects')
        .update({ status: nextStatus } as any)
        .eq('id', input.projectId)
        .eq('status', project.status as any); // optimistic lock

      // Log status change in history
      await supabase
        .from('project_status_history')
        .insert({
          project_id: input.projectId,
          old_status: project.status,
          new_status: nextStatus,
          changed_by: employee.id,
          notes: 'Auto-advanced: site survey completed',
        } as any);
    }
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

// ── QC Inspection CRUD ──

export async function createQcInspection(input: {
  projectId: string;
  data: {
    gate_number: number;
    milestone_id: string;
    inspection_date: string;
    overall_result: string;
    requires_reinspection: boolean;
    checklist_items: Array<{ item: string; passed: boolean; notes?: string }>;
    failure_notes?: string;
    conditional_notes?: string;
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

  const { error } = await supabase
    .from('qc_gate_inspections')
    .insert({
      project_id: input.projectId,
      inspected_by: employee.id,
      gate_number: input.data.gate_number,
      milestone_id: input.data.milestone_id,
      inspection_date: input.data.inspection_date,
      overall_result: input.data.overall_result,
      requires_reinspection: input.data.requires_reinspection,
      checklist_items: input.data.checklist_items as any,
      failure_notes: input.data.failure_notes ?? null,
      conditional_notes: input.data.conditional_notes ?? null,
    } as any);

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
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
      status: 'draft',
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

  // Set commissioned_date when moving to commissioned
  if (nextStatus === 'commissioned') {
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

  // Log status change in history (changed_by is nullable per migration 012)
  try {
    const { error: historyError } = await supabase
      .from('project_status_history')
      .insert({
        project_id: input.projectId,
        from_status: input.currentStatus as any,
        to_status: nextStatus as any,
        changed_by: employee?.id ?? null,
        reason: `Advanced from ${getStatusLabel(input.currentStatus)} to ${getStatusLabel(nextStatus)}`,
      });

    if (historyError) {
      console.error(`${op} History insert failed (non-blocking):`, {
        code: historyError.code,
        message: historyError.message,
        employeeId: employee?.id,
        projectId: input.projectId,
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
      gst_type: 'supply',
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

// ── Seed BOQ from BOM: group BOM lines by category, create cost variances ──

export async function seedBoqFromBom(input: {
  projectId: string;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const op = '[seedBoqFromBom]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: project } = await supabase
    .from('projects')
    .select('proposal_id')
    .eq('id', input.projectId)
    .single();

  if (!project?.proposal_id) {
    return { success: false, error: 'No proposal linked to this project' };
  }

  const { data: bomLines, error: bomError } = await supabase
    .from('proposal_bom_lines')
    .select('item_category, total_price')
    .eq('proposal_id', project.proposal_id);

  if (bomError || !bomLines || bomLines.length === 0) {
    return { success: false, error: 'No BOM lines found to seed BOQ' };
  }

  // Group by category and sum
  const categoryTotals: Record<string, number> = {};
  for (const line of bomLines) {
    categoryTotals[line.item_category] = (categoryTotals[line.item_category] ?? 0) + line.total_price;
  }

  // Check if BOQ already has entries
  const { data: existingVariances } = await supabase
    .from('project_cost_variances')
    .select('id')
    .eq('project_id', input.projectId)
    .limit(1);

  if (existingVariances && existingVariances.length > 0) {
    return { success: false, error: 'BOQ entries already exist. Use Update Actual Costs instead.' };
  }

  // Get or create profitability record
  let profitabilityId: string | null = null;
  const { data: profRecord } = await supabase
    .from('project_profitability')
    .select('id')
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (profRecord) {
    profitabilityId = profRecord.id;
  } else {
    const { data: newProf, error: profError } = await supabase
      .from('project_profitability')
      .insert({
        project_id: input.projectId,
        contracted_value: 0, total_estimated_cost: 0, total_actual_cost: 0,
        estimated_margin_pct: 0, actual_margin_pct: 0,
      } as any)
      .select('id')
      .single();
    if (profError) return { success: false, error: 'Could not create profitability record' };
    profitabilityId = (newProf as any).id;
  }

  const entries = Object.entries(categoryTotals).map(([category, estimated]) => ({
    project_id: input.projectId,
    profitability_id: profitabilityId,
    item_category: category,
    estimated_cost: Math.round(estimated * 100) / 100,
    actual_cost: 0,
    variance_amount: -Math.round(estimated * 100) / 100,
    variance_pct: -100,
    notes: null,
  }));

  const { error: insertError } = await supabase
    .from('project_cost_variances')
    .insert(entries as any);

  if (insertError) {
    console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
    return { success: false, error: insertError.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true, count: entries.length };
}

// ── Delivery Challan CRUD ──

export async function createDeliveryChallan(input: {
  projectId: string;
  data: {
    vendor_dc_number: string;
    vendor_dc_date: string;
    vendor_id: string | null;
    received_date: string | null;
    status: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createDeliveryChallan]';
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
