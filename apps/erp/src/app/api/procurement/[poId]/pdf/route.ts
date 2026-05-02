// apps/erp/src/app/api/procurement/[poId]/pdf/route.ts
// Purchase Order PDF generation API route
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { PurchaseOrderPDF, type PurchaseOrderPdfData } from '@/lib/pdf/purchase-order-pdf';
import React from 'react';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> }
) {
  const { poId } = await params;
  const op = '[GET /api/procurement/[poId]/pdf]';
  console.log(`${op} Generating PDF for PO: ${poId}`);

  try {
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch PO with items, vendor, project
    const { data: po, error } = await supabase
      .from('purchase_orders')
      .select(
        '*, purchase_order_items(*), vendors!purchase_orders_vendor_id_fkey(company_name, address_line1, address_line2, city, state, pincode, gstin, contact_person, phone), projects!purchase_orders_project_id_fkey(customer_name, project_number, site_address_line1, site_address_line2, site_city, site_state, site_pincode, customer_phone)'
      )
      .eq('id', poId)
      .single();

    if (error || !po) {
      console.error(`${op} PO not found:`, { error, poId });
      return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    }

    const vendor = (po as any).vendors ?? {};
    const project = (po as any).projects ?? {};
    const items = ((po as any).purchase_order_items ?? []).sort(
      (a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0)
    );

    // Build vendor address
    const vendorAddrParts: string[] = [
      vendor.address_line1,
      vendor.address_line2,
      vendor.city,
      vendor.state,
      vendor.pincode,
    ].filter((v): v is string => Boolean(v));
    const vendorAddr = vendorAddrParts.join(', ');

    // Build ship-to address from project site
    const siteAddrParts: string[] = [
      project.site_address_line1,
      project.site_address_line2,
      project.site_city,
      project.site_state,
      project.site_pincode,
    ].filter((v): v is string => Boolean(v));
    const shipTo = siteAddrParts.join(', ') || 'Address not available';

    // Calculate totals from line items
    const subtotal = items.reduce((sum: number, i: any) => sum + Number(i.total_price ?? 0), 0);

    // Aggregate GST per rate band
    const gstTotals: Record<number, number> = {};
    for (const i of items) {
      const rate = Number(i.gst_rate ?? 18);
      gstTotals[rate] = (gstTotals[rate] ?? 0) + Number(i.gst_amount ?? 0);
    }

    // Intra-state (Tamil Nadu): split each GST band 50/50 into CGST + SGST
    const gstBreakdown: { label: string; amount: number }[] = [];
    for (const [rateStr, total] of Object.entries(gstTotals)) {
      const rate = Number(rateStr);
      const half = total / 2;
      gstBreakdown.push({ label: `CGST ${rate / 2}%`, amount: half });
      gstBreakdown.push({ label: `SGST ${rate / 2}%`, amount: half });
    }

    const totalGst = Object.values(gstTotals).reduce((s, v) => s + v, 0);
    const rawTotal = subtotal + totalGst;
    const roundOff = Math.round(rawTotal) - rawTotal;
    const grandTotal = Math.round(rawTotal);

    const pdfData: PurchaseOrderPdfData = {
      poNumber: po.po_number ?? '',
      poDate: po.po_date
        ? new Date(po.po_date).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '\u2014',
      paymentTerms: po.payment_terms_days ? `${po.payment_terms_days} days` : '\u2014',
      projectName: [project.customer_name, project.project_number].filter(Boolean).join(' \u2014 '),
      placeOfSupply: project.site_state ?? 'Tamil Nadu',
      vendorName: vendor.company_name ?? '\u2014',
      vendorAddress: vendorAddr || '\u2014',
      vendorGstin: vendor.gstin ?? '\u2014',
      vendorContact: [vendor.contact_person, vendor.phone].filter(Boolean).join(' / ') || '\u2014',
      shipToAddress: shipTo,
      shipToContact: project.customer_name ?? '',
      shipToPhone: project.customer_phone ?? '',
      items: items.map((i: any, idx: number) => ({
        slNo: idx + 1,
        description: String(i.item_description ?? '\u2014'),
        hsnCode: String(i.hsn_code ?? '\u2014'),
        quantity: Number(i.quantity_ordered ?? 0),
        unit: String(i.unit ?? 'Nos'),
        rate: Number(i.unit_price ?? 0),
        amount: Number(i.total_price ?? 0),
      })),
      subtotal,
      gstBreakdown,
      roundOff,
      grandTotal,
      notes: po.notes ?? '',
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    console.log(`${op} Calling renderToBuffer for ${pdfData.items.length} items`);
    const renderStart = Date.now();
    const pdfBuffer = await renderToBuffer(
      React.createElement(PurchaseOrderPDF, { data: pdfData }) as any
    );
    console.log(`${op} renderToBuffer done in ${Date.now() - renderStart}ms, ${pdfBuffer.length} bytes`);

    const fileName = `${(po.po_number ?? 'PO').replace(/\//g, '-')}_PurchaseOrder.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${op} Failed:`, {
      poId,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new NextResponse(`PDF generation failed: ${msg}`, { status: 500 });
  }
}
