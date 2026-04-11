// apps/erp/src/app/api/projects/[id]/qc/[inspectionId]/route.ts
// QC Inspection PDF generation endpoint
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { QcInspectionPDF, type QcInspectionPdfData, type QcPdfSection } from '@/lib/pdf/qc-inspection-pdf';
import React from 'react';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> },
) {
  const op = '[GET /api/projects/[id]/qc/[inspectionId]]';
  const { id: projectId, inspectionId } = await params;
  console.log(`${op} Generating QC PDF for project: ${projectId}, inspection: ${inspectionId}`);

  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch inspection
    const { data: inspection, error: inspErr } = await supabase
      .from('qc_gate_inspections')
      .select(
        'id, inspection_date, overall_result, checklist_items, remarks, approval_status, approved_by, approved_at, inspected_by',
      )
      .eq('id', inspectionId)
      .eq('project_id', projectId)
      .single();

    if (inspErr || !inspection) {
      console.error(`${op} Inspection not found:`, { inspErr, inspectionId, projectId });
      return NextResponse.json({ error: 'QC inspection not found' }, { status: 404 });
    }

    // Fetch project info
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('project_number, customer_name, system_size_kwp, system_type')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get inspector name
    let inspectorName = '—';
    if ((inspection as any).inspected_by) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', (inspection as any).inspected_by)
        .single();
      inspectorName = (emp as any)?.full_name ?? '—';
    }

    // Get approver name
    let approverName: string | null = null;
    let approvedDate: string | null = null;
    if ((inspection as any).approved_by) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', (inspection as any).approved_by)
        .single();
      approverName = (emp as any)?.full_name ?? null;
    }
    if ((inspection as any).approved_at) {
      approvedDate = new Date((inspection as any).approved_at).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }

    // Parse checklist data
    const checklistData = (inspection as any).checklist_items as {
      sections?: QcPdfSection[];
      remarks?: string;
    } | null;

    const sections: QcPdfSection[] = checklistData?.sections ?? [];

    const pdfData: QcInspectionPdfData = {
      projectNumber: (project as any).project_number ?? '',
      customerName: (project as any).customer_name ?? '',
      systemSize: String((project as any).system_size_kwp ?? ''),
      systemType: ((project as any).system_type ?? 'on_grid').replace(/_/g, ' '),
      inspectionDate: new Date((inspection as any).inspection_date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      inspectorName,
      approverName,
      approvedDate,
      sections,
      remarks: (inspection as any).remarks ?? checklistData?.remarks ?? '',
      overallResult: (inspection as any).overall_result ?? 'approved',
    };

    // Render PDF
    const pdfBuffer = await renderToBuffer(
      React.createElement(QcInspectionPDF, { data: pdfData }) as any,
    );

    const fileName = `QC-Report-${(project as any).project_number ?? projectId.slice(0, 8)}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error(`${op} Error:`, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: 'Failed to generate QC PDF' }, { status: 500 });
  }
}
