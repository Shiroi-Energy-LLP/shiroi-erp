// apps/erp/src/app/api/proposals/[id]/generate-pdf/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { renderToBuffer } from '@react-pdf/renderer';
import { assembleProposalPDFData } from '@/lib/pdf/proposal-pdf-data';
import { BudgetaryQuotePDF } from '@/lib/pdf/budgetary-quote-pdf';
import React from 'react';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const op = '[POST /api/proposals/[id]/generate-pdf]';
  const { id: proposalId } = await params;
  console.log(`${op} Starting for proposal: ${proposalId}`);

  try {
    // Validate webhook secret if called by n8n
    const webhookSecret = request.headers.get('X-N8N-Webhook-Secret');
    const isN8NCall = !!webhookSecret;

    if (isN8NCall) {
      if (webhookSecret !== process.env.N8N_WEBHOOK_SECRET) {
        console.error(`${op} Invalid webhook secret`);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      // Regular user call — verify auth
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
    }

    // Assemble PDF data
    const pdfData = await assembleProposalPDFData(proposalId);

    // Render the correct PDF type
    let pdfBuffer: Buffer;
    if (pdfData.isBudgetary) {
      pdfBuffer = await renderToBuffer(
        React.createElement(BudgetaryQuotePDF, { data: pdfData })
      );
    } else {
      // For now, use budgetary template for all — detailed template added in future task
      pdfBuffer = await renderToBuffer(
        React.createElement(BudgetaryQuotePDF, { data: pdfData })
      );
    }

    // Upload to Supabase Storage
    const admin = createAdminClient();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${pdfData.proposalNumber.replace(/\//g, '-')}_${timestamp}.pdf`;
    const storagePath = `${proposalId}/${fileName}`;

    const { error: uploadErr } = await admin.storage
      .from('proposal-files')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error(`${op} Storage upload failed:`, uploadErr.message);
      return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
    }

    // Update proposal with current PDF path
    const { error: updateErr } = await admin
      .from('proposals')
      .update({ current_pdf_storage_path: storagePath })
      .eq('id', proposalId);

    if (updateErr) {
      console.error(`${op} Proposal update failed:`, updateErr.message);
    }

    // Register in generated_documents
    const { error: docErr } = await admin
      .from('generated_documents')
      .insert({
        entity_type: 'proposal',
        entity_id: proposalId,
        document_type: pdfData.isBudgetary ? 'budgetary_quote' : 'detailed_proposal',
        storage_path: storagePath,
        file_name: fileName,
        generated_by: isN8NCall ? null : undefined, // n8n calls have no user context
        version: 1,
      });

    if (docErr) {
      console.error(`${op} Document registration failed:`, docErr.message);
      // Non-fatal — PDF was generated successfully
    }

    console.log(`${op} PDF generated and stored: ${storagePath}`);
    return NextResponse.json({
      success: true,
      storagePath,
      fileName,
    });

  } catch (error) {
    console.error(`${op} Failed:`, {
      proposalId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF generation failed' },
      { status: 500 }
    );
  }
}
