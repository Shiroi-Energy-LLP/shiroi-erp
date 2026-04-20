'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { emitErpEvent } from '@/lib/n8n/emit';

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
      discom_status: 'pending',
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

  if (input.ceigStatus === 'approved') {
    void emitCeigApprovalReceived(input.projectId, input.ceigCertificateNumber, input.ceigApprovalDate);
  }

  return { success: true };
}

async function emitCeigApprovalReceived(
  projectId: string,
  certificateNumber: string | undefined,
  approvalDate: string | undefined,
): Promise<void> {
  const op = '[emitCeigApprovalReceived]';
  try {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from('projects')
      .select('id, project_number, customer_name, customer_phone, system_size_kwp, project_manager_id')
      .eq('id', projectId)
      .single();
    if (!project) return;

    let pmName: string | null = null;
    let pmPhone: string | null = null;
    if (project.project_manager_id) {
      const { data: pm } = await supabase
        .from('employees')
        .select('full_name, whatsapp_number')
        .eq('id', project.project_manager_id)
        .maybeSingle();
      pmName = pm?.full_name ?? null;
      pmPhone = pm?.whatsapp_number ?? null;
    }

    await emitErpEvent('ceig_approval.received', {
      project_id: project.id,
      project_code: project.project_number,
      customer_name: project.customer_name,
      customer_phone: project.customer_phone,
      system_size_kwp: project.system_size_kwp,
      certificate_number: certificateNumber ?? null,
      approval_date: approvalDate ?? null,
      project_manager_name: pmName,
      project_manager_whatsapp: pmPhone,
      erp_url: `https://erp.shiroienergy.com/projects/${project.id}`,
    });
  } catch (e) {
    console.error(`${op} enrichment failed (non-blocking)`, {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
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
 * Upload a liaison document (registers in liaison_documents table).
 */
export async function uploadLiaisonDocument(input: {
  projectId: string;
  netMeteringId: string;
  documentType: string;
  documentName: string;
  storagePath: string;
  fileSizeBytes?: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[uploadLiaisonDocument]';
  console.log(`${op} Starting for project: ${input.projectId}, type: ${input.documentType}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: emp } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  const { error } = await supabase
    .from('liaison_documents')
    .insert({
      project_id: input.projectId,
      net_metering_id: input.netMeteringId,
      uploaded_by: emp?.id ?? null,
      document_type: input.documentType,
      document_name: input.documentName,
      storage_path: input.storagePath,
      file_size_bytes: input.fileSizeBytes ?? null,
      status: 'draft',
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
 * Add a liaison activity note (inline log entry).
 * Uses the activities + activity_associations tables.
 */
export async function addLiaisonActivity(input: {
  projectId: string;
  description: string;
  activityType?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addLiaisonActivity]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Insert into activities table (owner_id is profile_id, body stores the note)
  const activityId = crypto.randomUUID();
  const { error } = await supabase.from('activities').insert({
    id: activityId,
    activity_type: input.activityType ?? 'note',
    owner_id: user.id,
    title: 'Liaison Note',
    body: input.description,
    occurred_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`${op} Activities insert failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  // Link to the project via activity_associations
  await supabase.from('activity_associations').insert({
    activity_id: activityId,
    entity_type: 'project',
    entity_id: input.projectId,
  });

  revalidatePath(`/projects/${input.projectId}`);
  return { success: true };
}

/**
 * Update liaison application fields (dates, application numbers, notes).
 */
export async function updateLiaisonFields(input: {
  projectId: string;
  fields: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateLiaisonFields]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('net_metering_applications')
    .update(input.fields as any)
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
 * Set CEIG scope — whether Shiroi or Client handles the CEIG clearance process.
 */
export async function updateCeigScope(input: {
  applicationId: string;
  scope: 'shiroi' | 'client';
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCeigScope]';
  console.log(`${op} Setting CEIG scope to ${input.scope} for application: ${input.applicationId}`);

  const supabase = await createClient();

  const updateData: Record<string, unknown> = {
    ceig_scope: input.scope,
    ceig_required: input.scope === 'shiroi',
  };

  const { error } = await supabase
    .from('net_metering_applications')
    .update(updateData as any)
    .eq('id', input.applicationId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/projects');
  return { success: true };
}

/**
 * Record an objection on a net metering application.
 */
export async function createObjection(input: {
  projectId: string;
  netMeteringId: string;
  objectionSource: string;
  objectionType: string;
  description: string;
  raisedDate: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createObjection]';
  console.log(`${op} Starting for project: ${input.projectId}`);

  const supabase = await createClient();

  // Get logged_by employee ID
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: emp } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!emp) return { success: false, error: 'Employee profile not found' };

  const { error } = await supabase
    .from('liaison_objections')
    .insert({
      project_id: input.projectId,
      net_metering_id: input.netMeteringId,
      logged_by: emp.id,
      objection_source: input.objectionSource,
      objection_type: input.objectionType,
      objection_description: input.description,
      objection_date: input.raisedDate,
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
