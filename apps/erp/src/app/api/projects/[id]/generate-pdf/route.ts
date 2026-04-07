// apps/erp/src/app/api/projects/[id]/generate-pdf/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { assembleProjectPdfData, type ProjectPdfSection } from '@/lib/pdf/project-pdf-data';
import { ProjectReportPDF } from '@/lib/pdf/project-report-pdf';
import React from 'react';

const VALID_SECTIONS: ProjectPdfSection[] = ['survey', 'boq', 'commissioning', 'dc', 'qc'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const op = '[POST /api/projects/[id]/generate-pdf]';
  const { id: projectId } = await params;
  console.log(`${op} Starting for project: ${projectId}`);

  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Parse requested sections from body
    const body = await request.json().catch(() => ({}));
    const requestedSections: string[] = body.sections || ['survey', 'boq', 'commissioning', 'qc'];
    const sections = requestedSections.filter((s): s is ProjectPdfSection =>
      VALID_SECTIONS.includes(s as ProjectPdfSection)
    );

    if (sections.length === 0) {
      return NextResponse.json({ error: 'No valid sections specified' }, { status: 400 });
    }

    console.log(`${op} Generating PDF for sections: ${sections.join(', ')}`);

    // Assemble PDF data
    const pdfData = await assembleProjectPdfData(projectId, sections);

    // Filter out sections with no data to avoid rendering errors
    const availableSections = sections.filter((sec) => {
      if (sec === 'survey' && !pdfData.survey) return false;
      if (sec === 'boq' && (!pdfData.boqItems || pdfData.boqItems.length === 0)) return false;
      if (sec === 'commissioning' && !pdfData.commissioningReport) return false;
      if (sec === 'dc' && (!pdfData.outgoingChallans || pdfData.outgoingChallans.length === 0)) return false;
      if (sec === 'qc' && (!pdfData.qcInspections || pdfData.qcInspections.length === 0)) return false;
      return true;
    });

    console.log(`${op} Rendering PDF with available sections: ${availableSections.join(', ')}`);

    // Render PDF
    const pdfBuffer = await renderToBuffer(
      React.createElement(ProjectReportPDF, { data: pdfData, sections: availableSections }) as any
    );

    // Return as download
    const fileName = `${pdfData.project.project_number.replace(/\//g, '-')}_report.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(`${op} Failed:`, {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF generation failed' },
      { status: 500 }
    );
  }
}
