// apps/erp/src/app/api/proposals/[id]/generate-pdf/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { renderToBuffer } from '@react-pdf/renderer';
import { assembleProposalPDFData } from '@/lib/pdf/proposal-pdf-data';
import { BudgetaryQuotePDF } from '@/lib/pdf/budgetary-quote-pdf';
import { DetailedProposalPDF } from '@/lib/pdf/detailed-proposal-pdf';
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

    // Step 1: Assemble PDF data (joined query + reshape)
    let pdfData;
    try {
      pdfData = await assembleProposalPDFData(proposalId);
      console.log(`${op} step=assemble OK`, {
        proposalId,
        isBudgetary: pdfData.isBudgetary,
        bomLineCount: pdfData.bomLines?.length,
        milestoneCount: pdfData.milestones?.length,
        customerName: pdfData.customerName,
      });
    } catch (e: any) {
      console.error(`${op} step=assemble FAILED`, {
        proposalId,
        message: e?.message,
        stack: e?.stack,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { error: `[assemble] ${e?.message ?? 'unknown'}` },
        { status: 500 }
      );
    }

    // Step 2: Render React-PDF tree to buffer
    let pdfBuffer: Buffer;
    try {
      if (pdfData.isBudgetary) {
        pdfBuffer = await renderToBuffer(
          React.createElement(BudgetaryQuotePDF, { data: pdfData }) as any
        );
      } else {
        pdfBuffer = await renderToBuffer(
          React.createElement(DetailedProposalPDF, { data: pdfData }) as any
        );
      }
      console.log(`${op} step=render OK`, { bytes: pdfBuffer.length });
    } catch (e: any) {
      console.error(`${op} step=render FAILED`, {
        proposalId,
        isBudgetary: pdfData.isBudgetary,
        message: e?.message,
        stack: e?.stack,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { error: `[render] ${e?.message ?? 'unknown'}` },
        { status: 500 }
      );
    }

    // Step 3: Upload to Supabase Storage.
    //
    // Storage path uses lead_id (not proposal_id) so the legacy
    // proposal-files bucket listing on /sales/[id]/files (which lists by
    // lead_id prefix) finds the file alongside the canonical documents-table
    // row inserted below.
    const admin = createAdminClient();

    const { data: propRow } = await admin
      .from('proposals')
      .select('lead_id')
      .eq('id', proposalId)
      .single();
    const leadId = propRow?.lead_id ?? null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${pdfData.proposalNumber.replace(/\//g, '-')}_${timestamp}.pdf`;
    // Prefer leadId-scoped path so the bucket listing on the Files tab works.
    // Fallback to proposalId if leadId is missing (shouldn't happen but defensive).
    const storagePath = `${leadId ?? proposalId}/${fileName}`;

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

    // Register in the canonical documents index (mig 109) so the file shows
    // up in /sales/[id]/files Documents section. Polymorphic — both lead_id
    // and proposal_id are populated so the document follows the journey.
    if (leadId) {
      const { error: docErr } = await admin
        .from('documents')
        .insert({
          lead_id: leadId,
          proposal_id: proposalId,
          category: 'proposal_pdf',
          storage_backend: 'supabase',
          storage_path: storagePath,
          name: fileName,
          mime_type: 'application/pdf',
          size_bytes: pdfBuffer.length,
        });
      if (docErr) {
        console.error(`${op} documents index insert failed:`, docErr.message);
        // Non-fatal — PDF was generated successfully
      }
    }

    // Sign a 1-hour download URL so the caller can open the PDF immediately.
    // Storage policy: proposal-files bucket is private; signed URL is the
    // only way to read it without an authenticated server-side handle.
    const { data: signed, error: signErr } = await admin.storage
      .from('proposal-files')
      .createSignedUrl(storagePath, 60 * 60);
    if (signErr) {
      console.error(`${op} createSignedUrl failed:`, signErr.message);
    }

    console.log(`${op} PDF generated and stored: ${storagePath}`);
    return NextResponse.json({
      success: true,
      storagePath,
      fileName,
      signedUrl: signed?.signedUrl ?? null,
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
