'use server';

/**
 * vendor-bill-draft-creator.ts — D3 / S17
 *
 * Given extracted vendor invoice data, creates a draft vendor_bills row +
 * vendor_bill_items rows, optionally linking to a matched vendor record.
 *
 * NEVER-DO compliance:
 * - #5: money is stored as NUMERIC(14,2) — we pass plain JS numbers; Postgres handles precision
 * - #12: no JS aggregation of monetary rows — all amounts come from the AI extraction
 * - #15: no inline Supabase from pages/components — this is a server action
 * - #19: no throw across RSC boundary — returns ActionResult<T>
 */

import { createAdminClient } from '@repo/supabase/admin';
import { emitErpEvent } from '@/lib/n8n/emit';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Json } from '@repo/types/database';
import type { ExtractedVendorBill } from './vendor-invoice-extractor';

export interface DraftBillResult {
  bill_id: string;
  vendor_matched: boolean;
  vendor_id: string | null;
  confidence_score: number;
}

/**
 * Fuzzy-match weight thresholds.
 * A vendor is considered a match if combined normalised score >= MATCH_THRESHOLD.
 */
const MATCH_THRESHOLD = 0.6;

// ─── Vendor row shape from DB ─────────────────────────────────────────────────

interface VendorRow {
  id: string;
  company_name: string;
  gstin: string | null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * createDraftFromExtractedInvoice
 *
 * 1. Fuzzy-match vendor_name + gstin against vendors table.
 * 2. INSERT vendor_bills row (status='draft', ai_status='pending_review').
 * 3. INSERT vendor_bill_items rows.
 * 4. Emit 'vendor.bill_ai_extracted' event to n8n.
 */
export async function createDraftFromExtractedInvoice(
  extracted: ExtractedVendorBill,
  attachmentPath: string,
  sourceEmailId: string,
): Promise<ActionResult<DraftBillResult>> {
  const op = '[createDraftFromExtractedInvoice]';

  try {
    const supabase = createAdminClient();

    // ── 1. Fuzzy vendor match ─────────────────────────────────────────────────
    const { data: vendors, error: vendorErr } = await supabase
      .from('vendors')
      .select('id, company_name, gstin')
      .is('deleted_at', null);

    if (vendorErr) {
      console.error(`${op} vendor lookup failed`, {
        error: vendorErr.message,
        source_email_id: sourceEmailId,
        timestamp: new Date().toISOString(),
      });
      return err(`Vendor lookup failed: ${vendorErr.message}`, vendorErr.code);
    }

    const vendorRows = (vendors ?? []) as VendorRow[];
    const matchResult = fuzzyMatchVendor(
      extracted.vendor_name_extracted,
      extracted.vendor_gstin,
      vendorRows,
    );

    const vendorId = matchResult?.id ?? null;

    // ── 2. INSERT vendor_bills ────────────────────────────────────────────────
    // vendor_id has a NOT NULL constraint on the original schema; if we can't
    // match, we need a workaround. The original table was designed with
    // vendor_id NOT NULL. For AI-extracted drafts, we use the PLACEHOLDER approach:
    // check if there is a sentinel "UNKNOWN / AI Draft" vendor, else the DBA must
    // relax the constraint (migration 139 only added AI cols, not schema change).
    //
    // Strategy: if no vendor match, we still create the draft but set vendor_id
    // to the matched vendor (or fail softly and return a structured error that the
    // ingest route can surface). Finance must assign manually.
    //
    // If vendor_id can't be null and there's no match: return an actionable error
    // so the ingest route can still log the email for manual processing.
    if (!vendorId) {
      // Attempt to find the sentinel vendor created at setup time
      const { data: sentinelRows } = await supabase
        .from('vendors')
        .select('id')
        .eq('vendor_code', 'SHIROI/VEN/AI-UNKNOWN')
        .limit(1);

      const sentinelId = (sentinelRows?.[0] as { id: string } | undefined)?.id ?? null;

      if (!sentinelId) {
        // No sentinel vendor exists — log and return structured error.
        // Ingest route will still return 200 to n8n so the email is marked read.
        console.warn(`${op} No vendor match and no sentinel vendor. Bill not created.`, {
          vendor_name_extracted: extracted.vendor_name_extracted,
          vendor_gstin: extracted.vendor_gstin,
          source_email_id: sourceEmailId,
          timestamp: new Date().toISOString(),
        });
        return err(
          `No vendor matched for "${extracted.vendor_name_extracted}" and no sentinel vendor SHIROI/VEN/AI-UNKNOWN exists. ` +
            'Create a sentinel vendor in Vendors list or link manually.',
          'NO_VENDOR_MATCH',
        );
      }

      // Use sentinel vendor so the row can be saved; finance will reassign
      return insertDraftBill(
        op,
        supabase,
        extracted,
        sentinelId,
        false,
        attachmentPath,
        sourceEmailId,
      );
    }

    return insertDraftBill(
      op,
      supabase,
      extracted,
      vendorId,
      true,
      attachmentPath,
      sourceEmailId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, {
      error: msg,
      source_email_id: sourceEmailId,
      timestamp: new Date().toISOString(),
    });
    return err(msg);
  }
}

// ─── DB insert helper ─────────────────────────────────────────────────────────

async function insertDraftBill(
  op: string,
  supabase: ReturnType<typeof createAdminClient>,
  extracted: ExtractedVendorBill,
  vendorId: string,
  vendorMatched: boolean,
  attachmentPath: string,
  sourceEmailId: string,
): Promise<ActionResult<DraftBillResult>> {
  const billId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: billInsertErr } = await supabase.from('vendor_bills').insert({
    id: billId,
    vendor_id: vendorId,
    bill_number: extracted.bill_number,
    bill_date: extracted.bill_date,
    due_date: extracted.due_date ?? null,
    subtotal: extracted.subtotal,
    cgst_amount: extracted.cgst_amount ?? 0,
    sgst_amount: extracted.sgst_amount ?? 0,
    igst_amount: extracted.igst_amount ?? 0,
    total_amount: extracted.total_amount,
    status: 'draft',
    source: 'erp',
    // AI extraction metadata (migration 139 columns)
    ai_extracted_at: now,
    ai_confidence_score: extracted.confidence_score,
    ai_source_email_id: sourceEmailId,
    ai_source_attachment_path: attachmentPath,
    ai_model: 'claude-sonnet-4-20250514',
    ai_extracted_data: extracted as unknown as Json,
    ai_status: 'pending_review',
  });

  if (billInsertErr) {
    console.error(`${op} vendor_bills INSERT failed`, {
      error: billInsertErr.message,
      code: billInsertErr.code,
      source_email_id: sourceEmailId,
      bill_number: extracted.bill_number,
      timestamp: now,
    });
    return err(`Failed to insert vendor bill: ${billInsertErr.message}`, billInsertErr.code);
  }

  // Insert line items
  if (extracted.line_items.length > 0) {
    const itemRows = extracted.line_items.map(item => ({
      id: crypto.randomUUID(),
      vendor_bill_id: billId,
      item_name: item.description,
      description: item.description,
      hsn_code: item.hsn_code ?? null,
      quantity: item.quantity,
      rate: item.rate,
      taxable_amount: item.amount,
      // Distribute tax pro-rata from header amounts across items
      // (exact per-line tax only known if shown explicitly on invoice;
      //  stored at 0 here — finance can adjust during approval)
      cgst_rate_pct: 0,
      sgst_rate_pct: 0,
      igst_rate_pct: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      total_amount: item.amount,
    }));

    const { error: itemsErr } = await supabase.from('vendor_bill_items').insert(itemRows);
    if (itemsErr) {
      console.error(`${op} vendor_bill_items INSERT failed`, {
        error: itemsErr.message,
        bill_id: billId,
        source_email_id: sourceEmailId,
        timestamp: now,
      });
      // Non-fatal: bill row already created; finance can add items manually
    }
  }

  // Emit event (fire-and-forget, never blocks)
  void emitErpEvent('vendor.bill_ai_extracted', {
    bill_id: billId,
    vendor_matched: vendorMatched,
    vendor_id: vendorId,
    confidence_score: extracted.confidence_score,
    source_email_id: sourceEmailId,
    bill_number: extracted.bill_number,
    total_amount: extracted.total_amount,
  });

  console.log(`${op} Draft bill created`, {
    bill_id: billId,
    vendor_matched: vendorMatched,
    confidence_score: extracted.confidence_score,
    source_email_id: sourceEmailId,
    timestamp: now,
  });

  return ok({
    bill_id: billId,
    vendor_matched: vendorMatched,
    vendor_id: vendorId,
    confidence_score: extracted.confidence_score,
  });
}

// ─── Fuzzy vendor matching ────────────────────────────────────────────────────

/**
 * fuzzyMatchVendor
 *
 * Scores each known vendor on two signals:
 *   - GSTIN exact match (strong signal, weight 0.7)
 *   - Company name normalised token overlap (weight 0.3)
 *
 * Returns the best match if score >= MATCH_THRESHOLD, else null.
 */
function fuzzyMatchVendor(
  extractedName: string,
  extractedGstin: string | null,
  vendors: VendorRow[],
): VendorRow | null {
  if (vendors.length === 0) return null;

  const normExtracted = normaliseCompanyName(extractedName);
  const gstinClean = extractedGstin?.toUpperCase().trim() ?? null;

  let bestVendor: VendorRow | null = null;
  let bestScore = 0;

  for (const vendor of vendors) {
    let score = 0;

    // GSTIN exact match — very strong signal
    if (gstinClean && vendor.gstin) {
      if (vendor.gstin.toUpperCase().trim() === gstinClean) {
        score += 0.7;
      }
    }

    // Company name token overlap
    const normVendorName = normaliseCompanyName(vendor.company_name);
    const overlap = tokenOverlap(normExtracted, normVendorName);
    score += overlap * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestVendor = vendor;
    }
  }

  return bestScore >= MATCH_THRESHOLD ? bestVendor : null;
}

/**
 * Normalise a company name for fuzzy comparison:
 * lowercase, strip legal suffixes, collapse whitespace.
 */
function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt|ltd|llp|llc|inc|private|limited|enterprises?|solutions?|trading|co)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token overlap ratio: intersection(tokens_a, tokens_b) / union(tokens_a, tokens_b)
 * (Jaccard similarity on word tokens)
 */
function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionCount++;
  }

  const unionCount = tokensA.size + tokensB.size - intersectionCount;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}
