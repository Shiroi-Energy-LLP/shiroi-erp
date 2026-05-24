'use server';

/**
 * vendor-invoice-extractor.ts — D3 / S17
 *
 * Calls Claude Sonnet vision on a PDF vendor invoice and extracts structured
 * data matching the Indian GST invoice format (CGST+SGST for intra-state,
 * IGST for inter-state).
 *
 * NEVER-DO compliance:
 * - #5: money fields are plain numbers (no ₹, no commas) — stored as NUMERIC(14,2)
 * - #3: no `any` — all API shapes are typed
 * - #1: no hardcoded keys — reads ANTHROPIC_API_KEY from env
 */

const SONNET_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractedLineItem {
  description: string;
  quantity: number;
  unit: string | null;
  rate: number;
  amount: number;
  hsn_code: string | null;
  tax_rate_pct: number | null;
}

export interface ExtractedVendorBill {
  vendor_name_extracted: string;
  vendor_gstin: string | null;
  bill_number: string;
  bill_date: string; // YYYY-MM-DD
  due_date: string | null;
  subtotal: number;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  total_amount: number;
  line_items: ExtractedLineItem[];
  confidence_score: number; // 0–1
}

// ─── Internal Anthropic API types ─────────────────────────────────────────────

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicResponse {
  content: Array<AnthropicTextBlock | { type: string }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract Indian GST vendor invoices into STRICT JSON matching the ExtractedVendorBill schema.

Indian GST format rules:
- CGST + SGST for intra-state transactions (both present and roughly equal).
- IGST for inter-state transactions (CGST and SGST absent or 0).
- GSTIN: 15-character alphanumeric (e.g. 33AABCS1429B1ZB). State code is the first 2 digits.
- HSN code: 4–8 digit numeric code. Present on most line items for GST invoices.
- Common fields: Invoice No., Invoice Date, Due Date, GSTIN (both Seller and Buyer), taxable value, tax rates and amounts, grand total.

Output rules:
- Return ONLY valid JSON. No markdown fences, no commentary.
- Money as plain numbers (no ₹ symbol, no commas, no currency suffixes). Example: 12500.50
- Dates as YYYY-MM-DD (ISO 8601). Example: 2026-01-15
- If a field cannot be confidently read, return null and lower confidence_score accordingly.
- Always include ALL line items visible on the invoice.
- confidence_score: 0.9+ if all key fields are clear; 0.7–0.9 if some fields are uncertain; below 0.7 if heavily degraded or ambiguous.

JSON schema (exactly this shape, no extra keys):
{
  "vendor_name_extracted": "string — seller/supplier company name",
  "vendor_gstin": "string | null — seller GSTIN",
  "bill_number": "string — invoice/bill number",
  "bill_date": "string — YYYY-MM-DD",
  "due_date": "string | null — YYYY-MM-DD if stated",
  "subtotal": number,
  "cgst_amount": number | null,
  "sgst_amount": number | null,
  "igst_amount": number | null,
  "total_amount": number,
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit": "string | null — Nos / m / kg / set / etc.",
      "rate": number,
      "amount": number,
      "hsn_code": "string | null",
      "tax_rate_pct": number | null
    }
  ],
  "confidence_score": number
}`;

const USER_PROMPT = 'Extract this vendor invoice. Return ONLY the JSON, no other text.';

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * extractVendorInvoiceFromPdf
 *
 * Sends the PDF to Claude Sonnet vision and returns structured extraction.
 *
 * @param pdfBuffer   - Raw PDF bytes (Uint8Array, max 20 MB)
 * @param sourceEmailId - Used for logging context only
 * @param attachmentPath - Used for logging context only
 */
export async function extractVendorInvoiceFromPdf(
  pdfBuffer: Uint8Array,
  sourceEmailId: string,
  attachmentPath: string,
): Promise<{ extracted: ExtractedVendorBill; ai_tokens_used: number }> {
  const op = '[extractVendorInvoiceFromPdf]';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(`${op} ANTHROPIC_API_KEY is not set`);
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    throw new Error(
      `${op} PDF too large: ${pdfBuffer.length} bytes (max ${MAX_PDF_BYTES}). ` +
        `source_email_id=${sourceEmailId} path=${attachmentPath}`,
    );
  }

  // Base64-encode the PDF
  const b64 = bufferToBase64(pdfBuffer);

  // Build the Anthropic messages request
  const requestBody = {
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: b64,
            },
          },
          {
            type: 'text',
            text: USER_PROMPT,
          },
        ],
      },
    ],
  };

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Fetch to Anthropic failed`, {
      error: msg,
      source_email_id: sourceEmailId,
      attachment_path: attachmentPath,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Network error calling Anthropic API: ${msg}`);
  }

  if (!anthropicRes.ok) {
    const body = await anthropicRes.text().catch(() => '(unreadable)');
    console.error(`${op} Anthropic API non-2xx`, {
      status: anthropicRes.status,
      body: body.substring(0, 300),
      source_email_id: sourceEmailId,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Anthropic API error ${anthropicRes.status}: ${body.substring(0, 200)}`);
  }

  const anthropicJson = (await anthropicRes.json()) as AnthropicResponse;

  const tokensUsed =
    (anthropicJson.usage?.input_tokens ?? 0) + (anthropicJson.usage?.output_tokens ?? 0);

  const textBlock = anthropicJson.content.find((b): b is AnthropicTextBlock => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error(`${op} Anthropic returned no text content`);
  }

  // Parse and validate JSON shape
  const extracted = parseAndValidate(textBlock.text, op, sourceEmailId);

  console.log(`${op} Extraction complete`, {
    source_email_id: sourceEmailId,
    vendor: extracted.vendor_name_extracted,
    bill_number: extracted.bill_number,
    total_amount: extracted.total_amount,
    confidence_score: extracted.confidence_score,
    line_items: extracted.line_items.length,
    ai_tokens_used: tokensUsed,
    timestamp: new Date().toISOString(),
  });

  return { extracted, ai_tokens_used: tokensUsed };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert Uint8Array to base64 string without relying on Buffer (Edge-compatible).
 */
function bufferToBase64(bytes: Uint8Array): string {
  // Process in chunks to avoid call-stack overflow on large files
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.slice(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/**
 * Parse the raw text from Claude as JSON and validate the shape.
 * Throws a descriptive error if the JSON is invalid or missing required fields.
 */
function parseAndValidate(
  rawText: string,
  op: string,
  sourceEmailId: string,
): ExtractedVendorBill {
  // Strip markdown code fences if Claude wrapped it despite instructions
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`${op} JSON parse failed`, {
      source_email_id: sourceEmailId,
      raw_text_preview: rawText.substring(0, 300),
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Claude returned invalid JSON. source_email_id=${sourceEmailId}`);
  }

  const obj = parsed as Record<string, unknown>;

  // Required field presence checks
  const required = [
    'vendor_name_extracted',
    'bill_number',
    'bill_date',
    'subtotal',
    'total_amount',
    'line_items',
    'confidence_score',
  ] as const;

  for (const field of required) {
    if (obj[field] === undefined) {
      throw new Error(`${op} Missing required field '${field}' in Claude extraction`);
    }
  }

  if (!Array.isArray(obj['line_items'])) {
    throw new Error(`${op} 'line_items' must be an array`);
  }

  const lineItems: ExtractedLineItem[] = (obj['line_items'] as unknown[]).map(
    (item, idx) => {
      const li = item as Record<string, unknown>;
      return {
        description: String(li['description'] ?? ''),
        quantity: Number(li['quantity'] ?? 1),
        unit: li['unit'] != null ? String(li['unit']) : null,
        rate: Number(li['rate'] ?? 0),
        amount: Number(li['amount'] ?? 0),
        hsn_code: li['hsn_code'] != null ? String(li['hsn_code']) : null,
        tax_rate_pct: li['tax_rate_pct'] != null ? Number(li['tax_rate_pct']) : null,
      } satisfies ExtractedLineItem;
    },
  );

  // Clamp confidence_score to [0, 1]
  const rawScore = Number(obj['confidence_score'] ?? 0.5);
  const confidenceScore = Math.max(0, Math.min(1, rawScore));

  return {
    vendor_name_extracted: String(obj['vendor_name_extracted']),
    vendor_gstin:
      obj['vendor_gstin'] != null ? String(obj['vendor_gstin']) : null,
    bill_number: String(obj['bill_number']),
    bill_date: String(obj['bill_date']),
    due_date: obj['due_date'] != null ? String(obj['due_date']) : null,
    subtotal: Number(obj['subtotal']),
    cgst_amount:
      obj['cgst_amount'] != null ? Number(obj['cgst_amount']) : null,
    sgst_amount:
      obj['sgst_amount'] != null ? Number(obj['sgst_amount']) : null,
    igst_amount:
      obj['igst_amount'] != null ? Number(obj['igst_amount']) : null,
    total_amount: Number(obj['total_amount']),
    line_items: lineItems,
    confidence_score: confidenceScore,
  };
}
