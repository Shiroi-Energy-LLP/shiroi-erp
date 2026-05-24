'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { renderToBuffer } from '@react-pdf/renderer';
import { type ActionResult, ok, err } from '@/lib/types/actions';
import { HandoverPackPdf, type HandoverPdfData } from '@/lib/pdf/handover/handover-pack-pdf';
import React from 'react';
import type { Database } from '@repo/types/database';

type ProjectRow = Database['public']['Tables']['projects']['Row'];

/**
 * Generate the Handover Pack PDF for a project (C11):
 *  1. Fetches project data server-side.
 *  2. Renders the PDF in-process via renderToBuffer.
 *  3. Uploads to Supabase Storage (project-files bucket).
 *  4. Records the storage path in projects.handover_pdf_path.
 *  5. Returns a signed download URL (valid 1 hour).
 */
export async function generateHandoverPackPdf(
  projectId: string,
): Promise<ActionResult<{ storagePath: string; downloadUrl: string }>> {
  const op = '[generateHandoverPackPdf]';
  console.log(`${op} Starting`, { projectId });

  if (!projectId) return err('Missing project ID');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Role check — only founder + project_manager
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['founder', 'project_manager'].includes(profile.role)) {
    return err('Only founders and project managers can generate handover packs');
  }

  // Fetch project data
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('project_number, customer_name, site_address_line1, site_address_line2, site_city, site_state, site_pincode, system_size_kwp, system_type, commissioned_date, panel_brand, panel_model, panel_count, panel_wattage, inverter_brand, inverter_model, structure_type, project_manager_id')
    .eq('id', projectId)
    .single();

  if (projErr || !project) {
    console.error(`${op} Project not found`, { projectId, error: projErr?.message, timestamp: new Date().toISOString() });
    return err('Project not found');
  }

  // Fetch PM name
  let pmName: string | null = null;
  if (project.project_manager_id) {
    const { data: pmProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', project.project_manager_id)
      .maybeSingle();
    pmName = pmProfile?.full_name ?? null;
  }

  const siteAddress = [
    project.site_address_line1,
    project.site_address_line2,
    project.site_city,
    project.site_state,
    project.site_pincode,
  ].filter(Boolean).join(', ');

  const pdfData: HandoverPdfData = {
    projectNumber: project.project_number,
    customerName: project.customer_name,
    siteAddress,
    systemSizeKwp: project.system_size_kwp ?? 0,
    systemType: (project.system_type as string) ?? 'on_grid',
    commissionedDate: project.commissioned_date ?? new Date().toISOString().slice(0, 10),
    projectManagerName: pmName,
    panelBrand: project.panel_brand ?? null,
    panelModel: project.panel_model ?? null,
    panelCount: project.panel_count ?? null,
    panelWattage: project.panel_wattage ?? null,
    inverterBrand: project.inverter_brand ?? null,
    inverterModel: project.inverter_model ?? null,
    structureType: (project.structure_type as ProjectRow['structure_type']) ?? null,
  };

  // Render PDF in-process
  let pdfBytes: Uint8Array;
  try {
    const element = React.createElement(HandoverPackPdf, { data: pdfData });
    const buffer = await renderToBuffer(
      element as unknown as React.ReactElement<import('@react-pdf/renderer').DocumentProps>,
    );
    pdfBytes = new Uint8Array(buffer);
  } catch (renderErr) {
    console.error(`${op} Render failed`, {
      error: renderErr instanceof Error ? renderErr.message : String(renderErr),
      projectId,
      timestamp: new Date().toISOString(),
    });
    return err('PDF rendering failed');
  }

  // Upload to project-files bucket
  const safeNumber = project.project_number.replace(/[^a-zA-Z0-9-]/g, '-');
  const storagePath = `handover-packs/${projectId}/${safeNumber}-handover.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from('project-files')
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) {
    console.error(`${op} Storage upload failed`, { message: uploadErr.message, timestamp: new Date().toISOString() });
    return err(`Storage upload failed: ${uploadErr.message}`);
  }

  // Record path in projects table
  const { error: updateErr } = await supabase
    .from('projects')
    .update({ handover_pdf_path: storagePath })
    .eq('id', projectId);

  if (updateErr) {
    console.error(`${op} Update failed`, { code: updateErr.code, message: updateErr.message, timestamp: new Date().toISOString() });
    // Non-fatal — file is uploaded; continue
  }

  // Generate a 1-hour signed URL
  const { data: signedData, error: signErr } = await supabase.storage
    .from('project-files')
    .createSignedUrl(storagePath, 3600);

  if (signErr || !signedData) {
    console.error(`${op} Signed URL failed`, { message: signErr?.message, timestamp: new Date().toISOString() });
    return err('PDF saved but could not create download link');
  }

  revalidatePath(`/projects/${projectId}`);
  console.log(`${op} Done`, { projectId, storagePath });
  return ok({ storagePath, downloadUrl: signedData.signedUrl });
}

/**
 * Get a fresh signed download URL for an already-generated handover PDF.
 */
export async function getHandoverPackDownloadUrl(
  storagePath: string,
): Promise<ActionResult<{ url: string }>> {
  const op = '[getHandoverPackDownloadUrl]';

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('project-files')
    .createSignedUrl(storagePath, 3600);

  if (error || !data) {
    console.error(`${op} Failed`, { message: error?.message, storagePath, timestamp: new Date().toISOString() });
    return err('Could not create download link');
  }

  return ok({ url: data.signedUrl });
}
