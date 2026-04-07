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

    // Render PDF
    const pdfBuffer = await renderToBuffer(
      React.createElement(ProjectReportPDF, { data: pdfData, sections }) as any
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
