// apps/erp/src/app/api/projects/[id]/dc/[dcId]/route.ts
// Individual Delivery Challan PDF generation
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { DeliveryChallanPDF, type DeliveryChallanPdfData } from '@/lib/pdf/delivery-challan-pdf';
import React from 'react';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dcId: string }> }
) {
  const op = '[GET /api/projects/[id]/dc/[dcId]]';
  const { id: projectId, dcId } = await params;
  console.log(`${op} Generating DC PDF for project: ${projectId}, dc: ${dcId}`);

  try {
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch DC with items
    const { data: dc, error: dcErr } = await supabase
      .from('delivery_challans')
      .select('*, delivery_challan_items(*)')
      .eq('id', dcId)
      .eq('project_id', projectId)
      .single();

    if (dcErr || !dc) {
      console.error(`${op} DC not found:`, { dcErr, dcId, projectId });
      return NextResponse.json({ error: 'Delivery Challan not found' }, { status: 404 });
    }

    // Fetch project for address + name
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('project_number, customer_name, site_address_line1, site_address_line2, site_city, site_state, site_pincode')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get dispatched_by employee name
    let dispatchedByName: string | null = null;
    if (dc.dispatched_by) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', dc.dispatched_by)
        .single();
      dispatchedByName = emp?.full_name ?? null;
    }

    // Determine sequential DC number (DC-001, DC-002, etc.)
    const { data: allDcs } = await supabase
      .from('delivery_challans')
      .select('id')
      .eq('project_id', projectId)
      .order('dc_date', { ascending: true })
      .order('created_at', { ascending: true });

    const dcIndex = (allDcs ?? []).findIndex((d: any) => d.id === dcId);
    const challanNumber = `DC-${String(dcIndex + 1).padStart(3, '0')}`;

    // Build site address
    const siteAddress = [
      project.site_address_line1,
      project.site_address_line2,
      project.site_city,
      project.site_state,
      project.site_pincode,
    ].filter(Boolean).join(', ');

    // Format date for display (dd-MMM-yyyy)
    const challanDate = dc.dc_date
      ? new Date(dc.dc_date).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
        })
      : '\u2014';

    // Build PDF data
    const items = ((dc as any).delivery_challan_items ?? []);
    const pdfData: DeliveryChallanPdfData = {
      challanNumber,
      challanDate,
      placeOfSupply: dc.dispatch_to || siteAddress || '',
      deliverTo: dc.dispatch_to || siteAddress || '',
      projectName: project.customer_name + ' — ' + project.project_number,
      customerName: project.customer_name,
      dispatchedByName,
      items: items.map((item: any, idx: number) => ({
        slNo: idx + 1,
        description: item.item_description,
        hsnCode: item.hsn_code ?? null,
        quantity: Number(item.quantity),
        unit: item.unit,
      })),
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    // Render PDF
    const pdfBuffer = await renderToBuffer(
      React.createElement(DeliveryChallanPDF, { data: pdfData }) as any
    );

    const fileName = `${challanNumber}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(`${op} Failed:`, {
      projectId,
      dcId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF generation failed' },
      { status: 500 }
    );
  }
}
