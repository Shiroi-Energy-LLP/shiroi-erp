'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Create a net metering application for a project.
 */
export async function createNetMeteringApplication(input: {
  projectId: string;
  discomName: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createNetMeteringApplication]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Check if one already exists
  const { data: existing } = await supabase
    .from('net_metering_applications')
    .select('id')
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (existing) {
    return { success: false, error: 'Net metering application already exists for this project.' };
  }

  const { error } = await supabase
    .from('net_metering_applications')
    .insert({
      project_id: input.projectId,
      discom_name: input.discomName || 'TANGEDCO',
      discom_status: 'not_started',
      ceig_required: false,
      followup_count: 0,
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/liaison/net-metering`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

/**
 * Update CEIG status on a net metering application.
 */
export async function updateCeigStatus(input: {
  projectId: string;
  ceigStatus: string;
  ceigApplicationDate?: string;
  ceigInspectionDate?: string;
  ceigApprovalDate?: string;
  ceigCertificateNumber?: string;
  ceigRejectionReason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCeigStatus]';
  console.log(`${op} Starting for project: ${input.projectId}, status: ${input.ceigStatus}`);

  const supabase = await createClient();

  const updatePayload: Record<string, unknown> = {
    ceig_status: input.ceigStatus,
  };

  if (input.ceigApplicationDate) updatePayload.ceig_application_date = input.ceigApplicationDate;
  if (input.ceigInspectionDate) updatePayload.ceig_inspection_date = input.ceigInspectionDate;
  if (input.ceigApprovalDate) updatePayload.ceig_approval_date = input.ceigApprovalDate;
  if (input.ceigCertificateNumber) updatePayload.ceig_certificate_number = input.ceigCertificateNumber;
  if (input.ceigRejectionReason) updatePayload.ceig_rejection_reason = input.ceigRejectionReason;

  const { error } = await supabase
    .from('net_metering_applications')
    .update(updatePayload as any)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // If CEIG approved, also update the projects table
  if (input.ceigStatus === 'approved') {
    await supabase
      .from('projects')
      .update({ ceig_cleared: true, ceig_cleared_at: new Date().toISOString() } as any)
      .eq('id', input.projectId);
  }

  revalidatePath(`/liaison/net-metering`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

/**
 * Update DISCOM/TNEB status on a net metering application.
 * Will be blocked by DB trigger if CEIG is required but not approved.
 */
export async function updateDiscomStatus(input: {
  projectId: string;
  discomStatus: string;
  discomApplicationDate?: string;
  discomApplicationNumber?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateDiscomStatus]';
  console.log(`${op} Starting for project: ${input.projectId}, status: ${input.discomStatus}`);

  const supabase = await createClient();

  const updatePayload: Record<string, unknown> = {
    discom_status: input.discomStatus,
  };

  if (input.discomApplicationDate) updatePayload.discom_application_date = input.discomApplicationDate;
  if (input.discomApplicationNumber) updatePayload.discom_application_number = input.discomApplicationNumber;
  if (input.notes) updatePayload.notes = input.notes;

  const { error } = await supabase
    .from('net_metering_applications')
    .update(updatePayload as any)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    // Check if this is the CEIG gate trigger error
    if (error.message?.includes('CEIG clearance required')) {
      return { success: false, error: 'CEIG clearance must be approved before TNEB submission can proceed.' };
    }
    return { success: false, error: error.message };
  }

  revalidatePath(`/liaison/net-metering`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

/**
 * Update net meter installation details.
 */
export async function updateNetMeterInstallation(input: {
  projectId: string;
  netMeterInstalled: boolean;
  netMeterInstalledDate?: string;
  netMeterSerialNumber?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateNetMeterInstallation]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('net_metering_applications')
    .update({
      net_meter_installed: input.netMeterInstalled,
      net_meter_installed_date: input.netMeterInstalledDate || null,
      net_meter_serial_number: input.netMeterSerialNumber || null,
    } as any)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/liaison/net-metering`);
  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

/**
 * Record a followup for a net metering application.
 */
export async function recordFollowup(input: {
  projectId: string;
  nextFollowupDate?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[recordFollowup]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Get current followup count
  const { data: current } = await supabase
    .from('net_metering_applications')
    .select('followup_count')
    .eq('project_id', input.projectId)
    .single();

  const newCount = ((current as any)?.followup_count ?? 0) + 1;

  const { error } = await supabase
    .from('net_metering_applications')
    .update({
      last_followup_date: new Date().toISOString().split('T')[0],
      next_followup_date: input.nextFollowupDate || null,
      followup_count: newCount,
      notes: input.notes || null,
    } as any)
    .eq('project_id', input.projectId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/liaison/net-metering`);
  return { success: true };
}

/**
 * Record an objection on a net metering application.
 */
export async function createObjection(input: {
  projectId: string;
  objectionSource: string;
  objectionType: string;
  description: string;
  raisedDate: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createObjection]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('liaison_objections')
    .insert({
      project_id: input.projectId,
      objection_source: input.objectionSource,
      objection_type: input.objectionType,
      description: input.description,
      raised_date: input.raisedDate,
      status: 'open',
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Update DISCOM status to objection_raised
  await supabase
    .from('net_metering_applications')
    .update({ discom_status: 'objection_raised' } as any)
    .eq('project_id', input.projectId);

  revalidatePath(`/liaison/net-metering`);
  return { success: true };
}
