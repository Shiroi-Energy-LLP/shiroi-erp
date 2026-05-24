// apps/erp/src/app/api/projects/[id]/handover-pdf/route.ts
// Role: GET handler — assembles project data and streams the handover PDF (C11).
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { HandoverPackPdf, type HandoverPdfData } from '@/lib/pdf/handover/handover-pack-pdf';
import type { Database } from '@repo/types/database';
import React from 'react';

type ProjectRow = Database['public']['Tables']['projects']['Row'];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const op = '[GET /api/projects/[id]/handover-pdf]';
  const { id: projectId } = await params;
  console.log(`${op} Starting for project: ${projectId}`);

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch project with all fields needed for PDF
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('project_number, customer_name, site_address_line1, site_address_line2, site_city, site_state, site_pincode, system_size_kwp, system_type, commissioned_date, panel_brand, panel_model, panel_count, panel_wattage, inverter_brand, inverter_model, structure_type, project_manager_id')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      console.error(`${op} Project not found`, { projectId, error: projErr?.message });
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Fetch PM name separately
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

    const commissionedDate =
      project.commissioned_date ?? new Date().toISOString().slice(0, 10);

    const pdfData: HandoverPdfData = {
      projectNumber: project.project_number,
      customerName: project.customer_name,
      siteAddress,
      systemSizeKwp: project.system_size_kwp ?? 0,
      systemType: (project.system_type as string) ?? 'on_grid',
      commissionedDate,
      projectManagerName: pmName,
      panelBrand: project.panel_brand ?? null,
      panelModel: project.panel_model ?? null,
      panelCount: project.panel_count ?? null,
      panelWattage: project.panel_wattage ?? null,
      inverterBrand: project.inverter_brand ?? null,
      inverterModel: project.inverter_model ?? null,
      structureType: (project.structure_type as ProjectRow['structure_type']) ?? null,
    };

    // renderToBuffer expects a ReactElement with DocumentProps; cast through unknown
    const element = React.createElement(HandoverPackPdf, { data: pdfData });
    const pdfBuffer = await renderToBuffer(element as unknown as React.ReactElement<import('@react-pdf/renderer').DocumentProps>);

    const fileName = `${pdfData.projectNumber.replace(/\//g, '-')}-handover.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(`${op} Failed`, {
      projectId,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF generation failed' },
      { status: 500 },
    );
  }
}
