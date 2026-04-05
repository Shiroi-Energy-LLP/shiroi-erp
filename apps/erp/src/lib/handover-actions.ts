'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Generate a handover pack document for a project.
 * Aggregates all project data into a structured document stored in generated_documents.
 */
export async function generateHandoverPack(
  projectId: string
): Promise<{ success: boolean; documentId?: string; error?: string }> {
  const op = '[generateHandoverPack]';
  console.log(`${op} Starting for project: ${projectId}`);

  if (!projectId) return { success: false, error: 'Missing project ID' };

  const supabase = await createClient();

  // Fetch all project data needed for the handover pack
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select(`
      *,
      project_milestones(*),
      commissioning_reports(*),
      net_metering_applications(*)
    `)
    .eq('id', projectId)
    .single();

  if (projectErr || !project) {
    console.error(`${op} Project fetch failed:`, projectErr?.message);
    return { success: false, error: 'Project not found' };
  }

  // Get linked proposal
  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, system_type, total_after_discount, proposal_bom_lines(*)')
    .eq('id', project.proposal_id)
    .single();

  // Get warranty info from BOM
  const bomLines = (proposal as any)?.proposal_bom_lines ?? [];
  const panelLine = bomLines.find((l: any) => l.category === 'panels' || l.item_name?.toLowerCase().includes('panel'));
  const inverterLine = bomLines.find((l: any) => l.category === 'inverter' || l.item_name?.toLowerCase().includes('inverter'));

  // Build the handover content as structured JSON
  const handoverContent = {
    generatedAt: new Date().toISOString(),
    project: {
      projectNumber: project.project_number,
      customerName: project.customer_name,
      siteAddress: [project.site_address_line1, project.site_city, project.site_state, project.site_pincode].filter(Boolean).join(', '),
      systemSizeKwp: project.system_size_kwp,
      systemType: project.system_type,
      contractedValue: project.contracted_value,
      commissionedDate: project.commissioned_at ?? project.updated_at,
    },
    system: {
      panelBrand: panelLine?.brand ?? 'As per BOM',
      panelModel: panelLine?.item_name ?? '—',
      panelQuantity: panelLine?.quantity ?? 0,
      inverterBrand: inverterLine?.brand ?? 'As per BOM',
      inverterModel: inverterLine?.item_name ?? '—',
      inverterQuantity: inverterLine?.quantity ?? 1,
    },
    commissioning: project.commissioning_reports?.[0] ? {
      date: project.commissioning_reports[0].commissioning_date,
      generationConfirmed: project.commissioning_reports[0].generation_confirmed,
      customerExplained: project.commissioning_reports[0].customer_explained,
      appDownloadAssisted: project.commissioning_reports[0].app_download_assisted,
    } : null,
    netMetering: project.net_metering_applications?.[0] ? {
      discomName: project.net_metering_applications[0].discom_name,
      applicationNumber: project.net_metering_applications[0].discom_application_number,
      netMeterInstalled: project.net_metering_applications[0].net_meter_installed,
      netMeterSerial: project.net_metering_applications[0].net_meter_serial_number,
      ceigCleared: project.net_metering_applications[0].ceig_status === 'approved',
    } : null,
    warranty: {
      panelWarranty: '25 years performance guarantee',
      inverterWarranty: '5 years standard (extendable to 10)',
      workmanshipWarranty: '5 years Shiroi Energy',
      amcPeriod: '1 year complimentary',
    },
    emergencyContact: {
      company: 'Shiroi Energy Private Limited',
      phone: '+91-XXXXXXXXXX',
      email: 'support@shiroienergy.com',
      serviceHours: 'Mon-Sat, 9 AM - 6 PM IST',
    },
    checklist: [
      'System operation explained to customer',
      'Monitoring app installed and configured',
      'All warranty cards provided',
      'Net meter reading recorded (if applicable)',
      'Safety instructions provided',
      'Emergency shutdown procedure explained',
      'Maintenance schedule shared',
      'Customer feedback collected',
    ],
  };

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Check if a handover pack already exists for this project
  const { data: existing } = await supabase
    .from('generated_documents')
    .select('id, version')
    .eq('entity_type', 'project')
    .eq('entity_id', projectId)
    .eq('document_type', 'handover_pack')
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const nextVersion = existing ? (existing.version ?? 0) + 1 : 1;

  // Store in generated_documents
  const { data: doc, error: docErr } = await supabase
    .from('generated_documents')
    .insert({
      entity_type: 'project',
      entity_id: projectId,
      document_type: 'handover_pack',
      file_name: `Handover_Pack_${project.project_number}_v${nextVersion}.json`,
      storage_path: `handover-packs/${projectId}/v${nextVersion}.json`,
      version: nextVersion,
      generated_by: user?.id ?? null,
      generated_at: new Date().toISOString(),
      metadata: handoverContent,
      accessible_to_customer: true,
    } as any)
    .select('id')
    .single();

  if (docErr) {
    console.error(`${op} Document insert failed:`, docErr.message);
    return { success: false, error: docErr.message };
  }

  revalidatePath(`/projects/${projectId}`);
  console.log(`${op} Handover pack generated: v${nextVersion}`);
  return { success: true, documentId: doc.id };
}

/**
 * Get the latest handover pack for a project.
 */
export async function getHandoverPack(projectId: string) {
  const op = '[getHandoverPack]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_documents')
    .select('*')
    .eq('entity_type', 'project')
    .eq('entity_id', projectId)
    .eq('document_type', 'handover_pack')
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error(`${op} Query failed:`, error.message);
    return null;
  }

  return data;
}
