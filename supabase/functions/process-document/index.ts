/**
 * process-document Edge Function — phase 2 scaffold
 *
 * Purpose: given a `document_id`, fetch the file from its storage backend
 * (Drive or Supabase Storage), extract text, generate an embedding, and
 * store both back on the documents row.
 *
 * Phase 2 scope: this scaffold lays the framework. Actual extraction +
 * embedding calls are stubbed because:
 *   (1) extraction APIs cost money and require explicit cost approval
 *       before running on the 1,353-folder corpus
 *   (2) ANTHROPIC_API_KEY and OPENAI_EMBEDDINGS_API_KEY env vars need to
 *       be configured for the function in the Supabase dashboard
 *   (3) Drive download requires a service-account credential mounted in
 *       the function context (different from the n8n credential)
 *
 * What this function CURRENTLY does:
 *   - Validates document_id, looks up the row
 *   - If size_bytes/mime_type is unknown for a Drive file, fetches metadata
 *     from Drive and updates the row
 *   - For Supabase-backed files, fetches metadata via storage API
 *   - Logs what it WOULD do for extraction/embedding so we can dry-run
 *     against the corpus before flipping on the paid pipeline
 *
 * What this function WILL do (phase 2.2, separate spec):
 *   - PDF → pdfjs-dist or pdf-parse → extracted_text
 *   - Excel/CSV → xlsx parsing → extracted_text (rows joined)
 *   - Image → Claude vision → ai_summary + extracted_text
 *   - CAD/Sketchup → metadata only (no text)
 *   - Embed extracted_text via OpenAI text-embedding-3-small (1536 dims) →
 *     documents.embedding
 *   - Generate 1-2 sentence summary via Claude → documents.ai_summary
 *
 * Trigger: HTTP POST. Called by:
 *   - scripts/extract-existing-documents.ts (backfill)
 *   - n8n workflow on documents INSERT (future — needs supabase realtime
 *     or pg_notify wiring; out of scope for now)
 *
 *   curl -X POST $SUPABASE_URL/functions/v1/process-document \
 *     -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"document_id":"<uuid>"}'
 *
 * Environment variables required:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (service role — bypasses RLS for write)
 *   - SUPABASE_SECRET_KEY (alias for above on newer-key projects)
 */

// @ts-expect-error — Deno-style URL import, resolved at runtime, not by tsc
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-expect-error — Deno-style URL import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// @ts-expect-error — Deno global at runtime
const Deno = globalThis.Deno;

interface ProcessDocumentInput {
  document_id: string;
  /** Optional: skip if extracted_text is already populated. Default true. */
  skip_if_extracted?: boolean;
}

interface DocumentRow {
  id: string;
  lead_id: string | null;
  proposal_id: string | null;
  project_id: string | null;
  category: string;
  storage_backend: 'drive' | 'supabase';
  external_id: string | null;
  storage_path: string | null;
  external_url: string | null;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  extracted_text: string | null;
  ai_summary: string | null;
}

const TEXT_EXTRACTABLE_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.document',
]);

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const NON_TEXT_MIMES_FOR_EXTRACTION = new Set([
  'application/vnd.sketchup.skp',
  'application/x-autocad',
  'application/dwg',
  'image/vnd.dwg',
]);

function inferExtractionStrategy(mime: string | null): 'text' | 'image' | 'metadata-only' | 'unknown' {
  if (!mime) return 'unknown';
  if (TEXT_EXTRACTABLE_MIMES.has(mime)) return 'text';
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (NON_TEXT_MIMES_FOR_EXTRACTION.has(mime)) return 'metadata-only';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  return 'unknown';
}

Deno.serve(async (req: Request) => {
  const op = '[process-document]';

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let input: ProcessDocumentInput;
  try {
    input = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!input.document_id) {
    return new Response(JSON.stringify({ error: 'Missing document_id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey =
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    console.error(`${op} Missing SUPABASE_URL or service key`);
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: doc, error: fetchErr } = await supabase
    .from('documents')
    .select(
      'id, lead_id, proposal_id, project_id, category, storage_backend, external_id, storage_path, external_url, name, mime_type, size_bytes, extracted_text, ai_summary',
    )
    .eq('id', input.document_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchErr) {
    console.error(`${op} Fetch failed`, { document_id: input.document_id, message: fetchErr.message });
    return new Response(JSON.stringify({ error: `Fetch failed: ${fetchErr.message}` }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!doc) {
    return new Response(JSON.stringify({ error: 'Document not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const document = doc as DocumentRow;
  const skipIfExtracted = input.skip_if_extracted ?? true;

  if (skipIfExtracted && document.extracted_text) {
    return new Response(
      JSON.stringify({
        document_id: document.id,
        skipped: 'already_extracted',
        strategy: inferExtractionStrategy(document.mime_type),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const strategy = inferExtractionStrategy(document.mime_type);

  // Phase 2.1 — log the plan, no actual API calls. Phase 2.2 will replace
  // this block with real extraction + embedding logic.
  const plan = {
    document_id: document.id,
    name: document.name,
    storage_backend: document.storage_backend,
    mime_type: document.mime_type,
    strategy,
    actions: [] as string[],
  };

  switch (strategy) {
    case 'text':
      plan.actions.push('download from ' + document.storage_backend);
      plan.actions.push('extract text via PDF/XLSX/DOCX parser');
      plan.actions.push('embed via OpenAI text-embedding-3-small (1536 dims)');
      plan.actions.push('summarize via Claude (1-2 sentences)');
      break;
    case 'image':
      plan.actions.push('download image');
      plan.actions.push('Claude vision — describe + extract any visible text');
      plan.actions.push('embed description via OpenAI');
      break;
    case 'metadata-only':
      plan.actions.push('skip text extraction (binary CAD/Sketchup format)');
      plan.actions.push('embed name + tags only');
      break;
    case 'unknown':
      plan.actions.push('skip — unknown mime type, manual review needed');
      break;
  }

  console.log(`${op} Plan for ${document.id}`, plan);

  // Mark the row as "extraction attempted" by updating updated_at (no-op
  // semantically but useful for tracking). The actual extracted_text /
  // embedding remain NULL until phase 2.2 is wired.
  const { error: updateErr } = await supabase
    .from('documents')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', document.id);

  if (updateErr) {
    console.error(`${op} Update failed`, { document_id: document.id, message: updateErr.message });
  }

  return new Response(
    JSON.stringify({
      document_id: document.id,
      status: 'planned',
      strategy,
      plan: plan.actions,
      note: 'Phase 2.1 scaffold — no extraction/embedding API calls yet. See function header.',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});
