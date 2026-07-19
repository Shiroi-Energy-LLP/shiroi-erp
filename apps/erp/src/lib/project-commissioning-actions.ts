'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { getNextStatus, getStatusLabel } from '@/lib/project-status-helpers';
import { emitErpEvent } from '@/lib/n8n/emit';

// Item 15a (2026-06-06): QC inspection actions + getProjectMilestones moved
// to project-qc-actions.ts to keep this file under the 500-LOC ceiling.
// What lives here: commissioning reports + advanceProjectStatus +
// emitProjectCommissioned (the project-completion event).

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
// Lives here because the only side-effect-bearing branch (status === 'completed')
// emits the project.commissioned event, putting it squarely in the commissioning
// domain.

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

  if (nextStatus === 'completed') {
    void emitProjectCommissioned(input.projectId);
  }

  return { success: true, newStatus: nextStatus };
}

async function emitProjectCommissioned(projectId: string): Promise<void> {
  const op = '[emitProjectCommissioned]';
  try {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from('projects')
      .select('id, customer_name, customer_phone, system_size_kwp, commissioned_date, project_manager_id')
      .eq('id', projectId)
      .single();
    if (!project) return;

    await emitErpEvent('project.commissioned', {
      project_id: project.id,
      customer_name: project.customer_name,
      customer_phone: project.customer_phone,
      system_size_kwp: project.system_size_kwp,
      commissioning_date: project.commissioned_date,
      erp_url: `https://erp.shiroienergy.com/projects/${project.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
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
  engineerSignature?: string | null;
  customerSignature?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[finalizeCommissioningReport]';
  console.log(`${op} Finalizing report for project: ${input.projectId}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Upload engineer signature if provided
  let engineerSignaturePath: string | null = null;
  if (input.engineerSignature) {
    const base64Part = input.engineerSignature.split(',')[1];
    if (base64Part) {
      const engineerSigBuffer = Buffer.from(base64Part, 'base64');
      const path = `projects/${input.projectId}/commissioning/engineer_sig_${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from('site-photos')
        .upload(path, engineerSigBuffer, { contentType: 'image/png', upsert: true });
      if (upErr) {
        console.error(`${op} Engineer signature upload failed:`, upErr);
      } else {
        engineerSignaturePath = path;
      }
    }
  }

  // Upload customer signature if provided
  let customerSignaturePath: string | null = null;
  if (input.customerSignature) {
    const base64Part = input.customerSignature.split(',')[1];
    if (base64Part) {
      const customerSigBuffer = Buffer.from(base64Part, 'base64');
      const path = `projects/${input.projectId}/commissioning/customer_sig_${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from('site-photos')
        .upload(path, customerSigBuffer, { contentType: 'image/png', upsert: true });
      if (upErr) {
        console.error(`${op} Customer signature upload failed:`, upErr);
      } else {
        customerSignaturePath = path;
      }
    }
  }

  const updateData: Record<string, unknown> = {
    status: 'finalized',
  };
  if (engineerSignaturePath) {
    updateData.engineer_signature_path = engineerSignaturePath;
  }
  if (customerSignaturePath) {
    updateData.signature_storage_path = customerSignaturePath;
    updateData.signature_method = 'drawn_on_device';
    updateData.customer_signed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('commissioning_reports')
    .update(updateData as any)
    .eq('id', input.reportId)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Finalize failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}
