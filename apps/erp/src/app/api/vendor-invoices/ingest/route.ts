/**
 * POST /api/vendor-invoices/ingest — D3 / S17
 *
 * Called by n8n workflow #71 (IMAP vendor invoice poll).
 * Accepts a multipart request with a PDF attachment + metadata,
 * runs Claude Sonnet vision extraction, and creates a draft vendor_bills row
 * for Vinodh (finance) to approve.
 *
 * Multipart fields:
 *   pdf           — File (PDF attachment from vendor email)
 *   source_email_id — string (unique message-id from the email)
 *   sender_email  — string (from address)
 *   subject       — string (email subject)
 *
 * Security: x-webhook-secret header must match N8N_WEBHOOK_SECRET env var.
 *
 * NEVER-DO compliance:
 * - #1: no hardcoded API keys — all from env
 * - #15: no inline Supabase in page/component — this is an API route
 * - #19: returns NextResponse, never throws across RSC boundary
 * - #5: money is NUMERIC(14,2) end-to-end; no JS arithmetic on monetary totals
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import { extractVendorInvoiceFromPdf } from '@/lib/ai/vendor-invoice-extractor';
import { createDraftFromExtractedInvoice } from '@/lib/ai/vendor-bill-draft-creator';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'vendor-invoices-inbound';
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  const op = '[POST /api/vendor-invoices/ingest]';

  // ── 1. Webhook secret guard ────────────────────────────────────────────────
  const incomingSecret = req.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    console.warn(`${op} Invalid or missing x-webhook-secret`, {
      hasEnvSecret: Boolean(expectedSecret),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 2. Early guard: ANTHROPIC_API_KEY ─────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${op} ANTHROPIC_API_KEY not set`, {
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: 'AI extraction unavailable: ANTHROPIC_API_KEY not configured.' },
      { status: 503 },
    );
  }

  // ── 3. Parse multipart ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Failed to parse multipart`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const pdfFile = formData.get('pdf') as File | null;
  const sourceEmailId = ((formData.get('source_email_id') as string | null) ?? '').trim();
  const senderEmail = ((formData.get('sender_email') as string | null) ?? '').trim();
  const subject = ((formData.get('subject') as string | null) ?? '').trim();

  // Required fields
  if (!pdfFile) {
    return NextResponse.json({ error: 'Missing required field: pdf' }, { status: 400 });
  }
  if (!sourceEmailId) {
    return NextResponse.json(
      { error: 'Missing required field: source_email_id' },
      { status: 400 },
    );
  }

  // Validate content type
  const mime = pdfFile.type || 'application/octet-stream';
  if (mime !== 'application/pdf' && !mime.includes('pdf')) {
    return NextResponse.json(
      { error: `Attachment must be a PDF. Got: ${mime}` },
      { status: 400 },
    );
  }

  // ── 4. Read PDF bytes ─────────────────────────────────────────────────────
  let pdfBuffer: Uint8Array;
  try {
    const arrayBuf = await pdfFile.arrayBuffer();
    pdfBuffer = new Uint8Array(arrayBuf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Failed to read PDF bytes`, {
      error: msg,
      source_email_id: sourceEmailId,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Could not read PDF attachment' }, { status: 400 });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return NextResponse.json(
      {
        error: `PDF too large: ${pdfBuffer.length} bytes (max ${MAX_PDF_BYTES / 1024 / 1024} MB)`,
      },
      { status: 413 },
    );
  }

  // ── 5. Upload PDF to Storage ───────────────────────────────────────────────
  const safeName = (pdfFile.name || 'invoice.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${sourceEmailId}/${safeName}`;

  const supabase = createAdminClient();

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false, // idempotent: if re-ingested, the file already exists
    });

  if (uploadErr && !uploadErr.message.toLowerCase().includes('already')) {
    // "already exists" is fine (idempotent retry); any other error is not
    console.error(`${op} Storage upload failed`, {
      error: uploadErr.message,
      storage_path: storagePath,
      source_email_id: sourceEmailId,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  console.log(`${op} PDF uploaded`, {
    storage_path: storagePath,
    bytes: pdfBuffer.length,
    source_email_id: sourceEmailId,
    sender_email: senderEmail,
    subject: subject.substring(0, 100),
    timestamp: new Date().toISOString(),
  });

  // ── 6. AI extraction ──────────────────────────────────────────────────────
  let extractionResult: Awaited<ReturnType<typeof extractVendorInvoiceFromPdf>>;
  try {
    extractionResult = await extractVendorInvoiceFromPdf(pdfBuffer, sourceEmailId, storagePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} AI extraction failed`, {
      error: msg,
      source_email_id: sourceEmailId,
      storage_path: storagePath,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: `AI extraction failed: ${msg}` },
      { status: 500 },
    );
  }

  const { extracted, ai_tokens_used } = extractionResult;

  // ── 7. Create draft bill ──────────────────────────────────────────────────
  const draftResult = await createDraftFromExtractedInvoice(
    extracted,
    storagePath,
    sourceEmailId,
  );

  if (!draftResult.success) {
    console.error(`${op} Draft bill creation failed`, {
      error: draftResult.error,
      code: draftResult.code,
      source_email_id: sourceEmailId,
      timestamp: new Date().toISOString(),
    });
    // Return 200 so n8n marks the email read anyway (prevents infinite re-ingestion).
    // Include the error details so the operator knows to intervene.
    return NextResponse.json(
      {
        success: false,
        storage_path: storagePath,
        source_email_id: sourceEmailId,
        ai_tokens_used,
        error: draftResult.error,
        code: draftResult.code,
        vendor_name_extracted: extracted.vendor_name_extracted,
        confidence_score: extracted.confidence_score,
      },
      { status: 200 },
    );
  }

  const { bill_id, vendor_matched, confidence_score } = draftResult.data;

  console.log(`${op} Ingest complete`, {
    bill_id,
    vendor_matched,
    confidence_score,
    ai_tokens_used,
    source_email_id: sourceEmailId,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      success: true,
      bill_id,
      vendor_matched,
      confidence_score,
      ai_tokens_used,
      storage_path: storagePath,
      source_email_id: sourceEmailId,
    },
    { status: 200 },
  );
}
