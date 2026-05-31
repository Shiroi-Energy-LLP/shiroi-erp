// SECURITY: requires service-role JWT bearer — process-document doc 2026-05-30 review #3
/**
 * process-document Edge Function — E6 real implementation
 *
 * Purpose: given a document_id, fetch the file from Supabase Storage,
 * extract text (PDF text-layer only for V1), generate a Jina embedding,
 * summarize with Claude, and persist back to documents row.
 *
 * V1 scope:
 *   - Supabase-backed files only (Drive integration deferred — needs service account in fn context)
 *   - PDF: text-layer extraction via pdf-parse equivalent using PDF.js ported to Deno
 *     IMPORTANT: PDF.js is complex in Deno; for V1 we use the Claude API with base64
 *     for text PDFs and image PDFs. This is the most reliable path.
 *   - Images: Claude vision
 *   - DOCX/XLSX/CSV: treated as binary for now, skipped with status 'skipped'
 *   - Embedding: Jina jina-embeddings-v3 (1024 dims) — replaces OpenAI (mig 138)
 *   - Summary: Claude claude-sonnet-4-20250514 (1-2 sentences)
 *   - Idempotent: skip if extraction_status = 'done' (unless force=true)
 *
 * Manual steps (env vars that must be set in Supabase Dashboard > Edge Functions > Secrets):
 *   - ANTHROPIC_API_KEY
 *   - JINA_API_KEY
 *
 * Trigger: HTTP POST. Called by:
 *   - scripts/extract-existing-documents.ts (backfill, runs in batches)
 *   - Future: n8n on documents INSERT
 *
 *   curl -X POST $SUPABASE_URL/functions/v1/process-document \
 *     -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"document_id":"<uuid>"}'
 */

// @ts-expect-error — Deno-style URL import, resolved at runtime, not by tsc
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-expect-error — Deno-style URL import
import { createClient } from 'jsr:@supabase/supabase-js@2';

// @ts-expect-error — Deno global at runtime
const Deno = globalThis.Deno;

interface ProcessDocumentInput {
  document_id: string;
  /** Force re-extraction even if already done. Default false. */
  force?: boolean;
}

interface DocumentRow {
  id: string;
  project_id: string | null;
  category: string;
  storage_backend: 'drive' | 'supabase';
  external_id: string | null;
  storage_path: string | null;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  extracted_text: string | null;
  extraction_status: string | null;
  extracted_at: string | null;
  ai_summary: string | null;
}

const TEXT_EXTRACTABLE_PDF = 'application/pdf';
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_TEXT_CHARS = 50_000; // truncate before embedding

function inferStrategy(mime: string | null): 'pdf' | 'image' | 'skip' {
  if (!mime) return 'skip';
  if (mime === TEXT_EXTRACTABLE_PDF) return 'pdf';
  if (IMAGE_MIMES.has(mime) || mime.startsWith('image/')) return 'image';
  return 'skip';
}

async function downloadFromSupabaseStorage(
  supabase: ReturnType<typeof createClient>,
  storagePath: string,
): Promise<Uint8Array | null> {
  const op = '[downloadFromSupabaseStorage]';
  const { data, error } = await supabase.storage
    .from('documents')
    .download(storagePath);

  if (error || !data) {
    console.error(`${op} download failed`, { storagePath, error: error?.message });
    return null;
  }
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

async function extractTextWithClaude(
  anthropicKey: string,
  fileBytes: Uint8Array,
  fileName: string,
  strategy: 'pdf' | 'image',
): Promise<string | null> {
  const op = '[extractTextWithClaude]';

  // Encode file to base64
  let b64 = '';
  const CHUNK = 8192;
  const chars: string[] = [];
  for (let i = 0; i < fileBytes.length; i += CHUNK) {
    chars.push(String.fromCharCode(...fileBytes.slice(i, i + CHUNK)));
  }
  b64 = btoa(chars.join(''));

  const mediaType = strategy === 'pdf' ? 'application/pdf' : 'image/jpeg';
  const promptText = strategy === 'pdf'
    ? `Extract all readable text from this PDF document. Return only the extracted text, no commentary. If the PDF is scanned/image-based and has no readable text layer, reply with exactly: [SCANNED_IMAGE_NO_TEXT]`
    : `Extract all visible text from this image. Return only the text, no commentary. If there is no text, reply with exactly: [NO_TEXT]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: b64,
                },
              },
              { type: 'text', text: promptText },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`${op} Anthropic API error`, { status: res.status, body: body.substring(0, 200), fileName });
      return null;
    }

    const json = await res.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = json.content?.[0]?.text ?? null;
    if (!text || text === '[SCANNED_IMAGE_NO_TEXT]' || text === '[NO_TEXT]') return null;
    return text.substring(0, MAX_TEXT_CHARS);
  } catch (e) {
    console.error(`${op} threw`, { fileName, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function generateSummary(
  anthropicKey: string,
  extractedText: string,
  fileName: string,
): Promise<string | null> {
  const op = '[generateSummary]';
  const truncated = extractedText.substring(0, 3000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Summarize this solar EPC document in 1-2 sentences. Document name: "${fileName}"\n\nContent:\n${truncated}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { content: Array<{ type: string; text?: string }> };
    return json.content?.[0]?.text ?? null;
  } catch (e) {
    console.error(`${op} threw`, { fileName, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function generateEmbedding(
  jinaKey: string,
  text: string,
): Promise<number[] | null> {
  const op = '[generateEmbedding]';
  // Jina max input is ~8192 tokens; truncate conservatively to 8000 chars
  const truncated = text.substring(0, 8000);
  try {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jinaKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        task: 'retrieval.passage',
        input: [truncated],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`${op} Jina error`, { status: res.status, body: body.substring(0, 200) });
      return null;
    }
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    const embedding = json.data?.[0]?.embedding ?? null;
    if (embedding && embedding.length !== 1024) {
      console.error(`${op} Unexpected embedding dimension`, { dim: embedding.length });
      return null;
    }
    return embedding;
  } catch (e) {
    console.error(`${op} threw`, { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const op = '[process-document]';

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // SECURITY: require service-role bearer token. Anyone hitting this URL without
  // the project's service-role key gets a 401 — prevents anonymous callers from
  // burning ANTHROPIC_API_KEY + JINA_API_KEY quota by supplying arbitrary
  // document_ids. We accept either SUPABASE_SECRET_KEY (new naming) or
  // SUPABASE_SERVICE_ROLE_KEY (legacy / auto-injected by Supabase runtime),
  // mirroring the fallback below for `serviceKey`.
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const jinaKey = Deno.env.get('JINA_API_KEY');

  if (!supabaseUrl || !serviceKey) {
    console.error(`${op} Missing SUPABASE_URL or service key`);
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    console.warn(`${op} Unauthorized: missing or malformed Authorization header`, { timestamp: new Date().toISOString() });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const token = authHeader.slice(7).trim();
  if (token !== serviceKey) {
    console.warn(`${op} Unauthorized: token mismatch`, { timestamp: new Date().toISOString() });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
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

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Load document row
  const { data: doc, error: fetchErr } = await supabase
    .from('documents')
    .select('id, project_id, category, storage_backend, external_id, storage_path, name, mime_type, size_bytes, extracted_text, extraction_status, extracted_at, ai_summary')
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

  // Idempotency check
  if (!input.force && document.extraction_status === 'done') {
    return new Response(
      JSON.stringify({ document_id: document.id, skipped: 'already_extracted', extraction_status: 'done' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const strategy = inferStrategy(document.mime_type);

  // CAS: claim the row atomically — only flip pending|skipped|failed → processing.
  // If another worker (e.g. n8n cron + backfill script running concurrently) already
  // flipped this row to 'processing', the WHERE clause won't match and data will be [].
  // That's our signal to exit early and avoid burning duplicate Anthropic + OpenAI quota.
  const { data: claimedRows, error: claimErr } = await supabase
    .from('documents')
    .update({ extraction_status: 'processing', extracted_at: new Date().toISOString() })
    .eq('id', document.id)
    .in('extraction_status', ['pending', 'skipped', 'failed'])
    .select('id');

  if (claimErr) {
    console.error(`${op} claim failed`, { documentId: document.id, code: claimErr.code, message: claimErr.message, timestamp: new Date().toISOString() });
    return new Response(JSON.stringify({ error: 'claim_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!claimedRows || claimedRows.length === 0) {
    // Another worker already claimed this document — exit cleanly without doing duplicate work.
    console.log(`${op} already claimed by another worker, skipping`, { documentId: document.id, timestamp: new Date().toISOString() });
    return new Response(JSON.stringify({ skipped: true, reason: 'already_claimed' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Skip non-text/non-image files
  if (strategy === 'skip') {
    await supabase
      .from('documents')
      .update({ extraction_status: 'skipped', extracted_at: new Date().toISOString() })
      .eq('id', document.id);
    return new Response(
      JSON.stringify({ document_id: document.id, extraction_status: 'skipped', reason: `mime_type=${document.mime_type ?? 'unknown'}` }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  // Check for required API keys
  if (!anthropicKey) {
    await supabase
      .from('documents')
      .update({ extraction_status: 'failed' })
      .eq('id', document.id);
    console.warn(`${op} ANTHROPIC_API_KEY not set — configure in Supabase Dashboard > Edge Functions > Secrets`);
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Set it in Supabase Dashboard > Edge Functions > Secrets.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  // Only Supabase-backed files for now
  if (document.storage_backend !== 'supabase' || !document.storage_path) {
    await supabase
      .from('documents')
      .update({ extraction_status: 'skipped', extracted_at: new Date().toISOString() })
      .eq('id', document.id);
    return new Response(
      JSON.stringify({ document_id: document.id, extraction_status: 'skipped', reason: 'Drive-backed files require service account — deferred' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  // Size guard
  if (document.size_bytes && document.size_bytes > MAX_FILE_SIZE_BYTES) {
    await supabase
      .from('documents')
      .update({ extraction_status: 'skipped', extracted_at: new Date().toISOString() })
      .eq('id', document.id);
    return new Response(
      JSON.stringify({ document_id: document.id, extraction_status: 'skipped', reason: `File too large: ${document.size_bytes} bytes (max 20MB)` }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    // Download file
    const fileBytes = await downloadFromSupabaseStorage(supabase, document.storage_path);
    if (!fileBytes) {
      await supabase
        .from('documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document.id);
      return new Response(JSON.stringify({ error: 'File download failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Extract text via Claude
    const extractedText = await extractTextWithClaude(anthropicKey, fileBytes, document.name, strategy);

    // Generate summary (only if text available)
    const aiSummary = extractedText
      ? await generateSummary(anthropicKey, extractedText, document.name)
      : null;

    // Generate embedding (only if text available + Jina key configured)
    let embedding: number[] | null = null;
    if (extractedText && jinaKey) {
      embedding = await generateEmbedding(jinaKey, extractedText);
    } else if (extractedText && !jinaKey) {
      console.warn(`${op} JINA_API_KEY not set — skipping embedding. Set in Supabase Dashboard > Edge Functions > Secrets.`);
    }

    // Persist results
    const update: Record<string, unknown> = {
      extraction_status: 'done',
      extracted_at: new Date().toISOString(),
    };
    if (extractedText !== null) update['extracted_text'] = extractedText;
    if (aiSummary !== null) update['ai_summary'] = aiSummary;
    if (embedding !== null) update['embedding'] = `[${embedding.join(',')}]`;

    const { error: updateErr } = await supabase
      .from('documents')
      .update(update)
      .eq('id', document.id);

    if (updateErr) {
      console.error(`${op} Update failed`, { document_id: document.id, message: updateErr.message });
      await supabase
        .from('documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document.id);
      return new Response(JSON.stringify({ error: `Update failed: ${updateErr.message}` }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    console.log(`${op} done`, {
      document_id: document.id,
      strategy,
      text_chars: extractedText?.length ?? 0,
      has_summary: !!aiSummary,
      has_embedding: !!embedding,
    });

    return new Response(
      JSON.stringify({
        document_id: document.id,
        extraction_status: 'done',
        strategy,
        text_chars: extractedText?.length ?? 0,
        has_summary: !!aiSummary,
        has_embedding: !!embedding,
        pending_manual_steps: [
          !anthropicKey && 'Set ANTHROPIC_API_KEY in Supabase Dashboard > Edge Functions > Secrets',
          !jinaKey && 'Set JINA_API_KEY in Supabase Dashboard > Edge Functions > Secrets',
        ].filter(Boolean),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} unhandled error`, { document_id: document.id, error: msg });
    await supabase
      .from('documents')
      .update({ extraction_status: 'failed' })
      .eq('id', document.id);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
