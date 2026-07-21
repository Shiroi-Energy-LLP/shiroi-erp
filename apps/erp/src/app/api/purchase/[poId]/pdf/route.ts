// apps/erp/src/app/api/purchase/[poId]/pdf/route.ts
// BOI quick-PO PDF download (spec §6.2.4 minimal layout, §6.3 immutability).
//
// Regenerates the document from the FROZEN purchase_order_items rows + the
// SQL-computed PO header totals on every request — there is no "regenerate"
// concept because the inputs can never change (spec §6.3). The stored Storage
// copy (uploaded at creation) is a convenience duplicate; this route is the
// canonical download path used by the create-PO modal and the PO log.
//
// Auth: any authenticated PRICE_VISIBLE role (the document contains prices).
// Only source='boi_quick' POs are served — v2 POs use /api/procurement/[poId]/pdf.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { getSessionContext } from '@/lib/auth';
import { PRICE_VISIBLE_ROLES } from '@/lib/purchase-flow-constants';
import { getBoiPoPdfData, renderBoiPoPdfBuffer } from '@/lib/purchase-flow-pdf';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ poId: string }> },
) {
  const { poId } = await params;
  const op = '[GET /api/purchase/[poId]/pdf]';

  try {
    const { userId, role } = await getSessionContext();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!role || !(PRICE_VISIBLE_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = await createClient();
    const data = await getBoiPoPdfData(supabase, poId);
    if (!data) {
      return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    }

    const renderStart = Date.now();
    const pdfBuffer = await renderBoiPoPdfBuffer(data);
    console.log(
      `${op} rendered ${data.poNumber} (${data.items.length} items) in ${Date.now() - renderStart}ms, ${pdfBuffer.length} bytes`,
    );

    // Filename: `<PO Number>.pdf` (spec §6.2.4). PO-0001-style numbers are
    // header-safe, but sanitize defensively.
    const fileName = `${data.poNumber.replace(/[^\w.-]/g, '-')}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${op} failed:`, {
      poId,
      error: message,
      stack: e instanceof Error ? e.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    // Generic body — the full error (message + stack) stays in the server log.
    return new NextResponse('PDF generation failed', { status: 500 });
  }
}
