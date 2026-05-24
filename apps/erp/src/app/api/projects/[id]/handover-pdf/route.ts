// apps/erp/src/app/api/projects/[id]/handover-pdf/route.ts
// Role: GET handler — assembles project data and streams the handover PDF (C11).
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { HandoverPackPdf, type HandoverPdfData } from '@/lib/pdf/handover/handover-pack-pdf';
import React from 'react';

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

    // Fetch project + PM name in parallel
    const [projectResult, pmResult] = await Promise.all([
      supabase
        .from('projects')
        .select([
          'id', 'project_number', 'customer_name',
          'site_address_line1', 'site_address_line2', 'site_city', 'site_state', 'site_pincode',
          'system_size_kwp', 'system_type', 'commissioned_date',
          'panel_brand', 'panel_model', 'panel_count', 'panel_wattage',
          'inverter_brand', 'inverter_model', 'structure_type',
          'project_manager_id',
        ].join(', '))
        .eq('id', projectId)
        .single(),
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id',
          (await supabase.from('projects').select('project_manager_id').eq('id', projectId).single())
            .data?.project_manager_id ?? '')
        .maybeSingle(),
    ]);

    const { data: project, error: projErr } = projectResult;
    if (projErr || !project) {
      console.error(`${op} Project not found`, { projectId, error: projErr?.message });
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const pmName = pmResult.data?.full_name ?? null;

    const siteAddress = [
      (project as Record<string, unknown>).site_address_line1,
      (project as Record<string, unknown>).site_address_line2,
      (project as Record<string, unknown>).site_city,
      (project as Record<string, unknown>).site_state,
      (project as Record<string, unknown>).site_pincode,
    ].filter(Boolean).join(', ');

    const commissionedDate =
      (project as Record<string, unknown>).commissioned_date as string | null
      ?? new Date().toISOString().slice(0, 10);

    const pdfData: HandoverPdfData = {
      projectNumber: (project as Record<string, unknown>).project_number as string,
      customerName: (project as Record<string, unknown>).customer_name as string,
      siteAddress,
      systemSizeKwp: Number((project as Record<string, unknown>).system_size_kwp ?? 0),
      systemType: (project as Record<string, unknown>).system_type as string ?? 'on_grid',
      commissionedDate,
      projectManagerName: pmName,
      panelBrand: (project as Record<string, unknown>).panel_brand as string | null,
      panelModel: (project as Record<string, unknown>).panel_model as string | null,
      panelCount: (project as Record<string, unknown>).panel_count as number | null,
      panelWattage: (project as Record<string, unknown>).panel_wattage as number | null,
      inverterBrand: (project as Record<string, unknown>).inverter_brand as string | null,
      inverterModel: (project as Record<string, unknown>).inverter_model as string | null,
      structureType: (project as Record<string, unknown>).structure_type as string | null,
    };

    const pdfBuffer = await renderToBuffer(
      React.createElement(HandoverPackPdf, { data: pdfData }) as React.ReactElement,
    );

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
