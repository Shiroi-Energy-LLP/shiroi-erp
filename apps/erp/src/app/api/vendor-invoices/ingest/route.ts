/**
 * POST /api/vendor-invoices/ingest — D3 / S17
 *
 * Called by n8n workflow #71 (IMAP vendor invoice poll).
 * Accepts a JSON body with base64-encoded PDF attachment + metadata,
 * runs Claude Sonnet vision extraction, and creates a draft vendor_bills row
 * for Vinodh (finance) to approve.
 *
 * JSON body shape (from n8n workflow 71):
 *   {
 *     email_id:     string   — unique message-id from the email (for idempotency)
 *     sender_email: string   — from address
 *     subject:      string   — email subject
 *     body:         string   — email body text (first 2000 chars)
 *     attachments:  Array<{ filename: string; base64: string }>
 *   }
 *
 * Security: x-webhook-secret header must match N8N_WEBHOOK_SECRET env var.
 *
 * Idempotency: if the same email_id + filename is re-ingested, the Storage
 * upload uses upsert:false and returns "already exists" — the route treats
 * this as a soft success so n8n won't retry indefinitely.
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

// ── JSON body shape sent by n8n workflow 71 ───────────────────────────────────

interface IngestAttachment {
  filename: string;
  base64: string;
}

interface IngestBody {
  email_id: string;
  sender_email?: string;
  subject?: string;
  body?: string;
  attachments: IngestAttachment[];
}

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

  // ── 3. Parse JSON body ────────────────────────────────────────────────────
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Failed to parse JSON body`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sourceEmailId = (body.email_id ?? '').trim();
  const senderEmail = (body.sender_email ?? '').trim();
  const subject = (body.subject ?? '').trim();

  if (!sourceEmailId) {
    return NextResponse.json(
      { error: 'Missing required field: email_id' },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
    return NextResponse.json(
      { error: 'Missing required field: attachments (must be a non-empty array)' },
      { status: 400 },
    );
  }

  // Process the first attachment (n8n emits one item per PDF)
  const attachment = body.attachments[0];
  if (!attachment?.base64) {
    return NextResponse.json(
      { error: 'attachments[0].base64 is empty' },
      { status: 400 },
    );
  }

  // ── 4. Decode base64 → Uint8Array ─────────────────────────────────────────
  let pdfBuffer: Uint8Array;
  try {
    const binStr = atob(attachment.base64);
    pdfBuffer = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      pdfBuffer[i] = binStr.charCodeAt(i);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Failed to decode base64 attachment`, {
      error: msg,
      source_email_id: sourceEmailId,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Could not decode PDF base64 data' }, { status: 400 });
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
  const safeName = (attachment.filename || 'invoice.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
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
    filename: safeName,
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
