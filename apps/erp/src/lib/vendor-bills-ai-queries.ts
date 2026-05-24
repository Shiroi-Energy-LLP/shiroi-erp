/**
 * vendor-bills-ai-queries.ts — D3 / S17
 *
 * Server-only read helpers for the AI extraction review queue.
 *
 * NEVER-DO compliance:
 * - #15: no inline Supabase in pages/components — always imported from here
 * - #12: no JS aggregation of monetary rows — KPIs from SQL
 * - #13: no count:'exact' on large tables — using 'estimated'
 * - #3: no `any` — types from @repo/types/database
 */

import { createClient } from '@repo/supabase/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiReviewBill {
  id: string;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  total_amount: string | number;
  ai_confidence_score: number | null;
  ai_extracted_at: string | null;
  ai_source_email_id: string | null;
  ai_source_attachment_path: string | null;
  ai_status: string | null;
  vendor_id: string;
  vendors: {
    id: string;
    company_name: string;
    vendor_code: string | null;
  } | null;
}

export interface AiReviewKpis {
  pending_count: number;
  approved_today: number;
  rejected_today: number;
  avg_confidence: number | null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * listPendingAiReview
 *
 * Returns all vendor_bills with ai_status='pending_review',
 * sorted by ai_extracted_at DESC (newest ingest first).
 * Used by the /vendor-bills/review queue page.
 */
export async function listPendingAiReview(): Promise<AiReviewBill[]> {
  const op = '[listPendingAiReview]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('vendor_bills')
    .select(
      'id, bill_number, bill_date, due_date, total_amount, ai_confidence_score, ai_extracted_at, ai_source_email_id, ai_source_attachment_path, ai_status, vendor_id, vendors!vendor_bills_vendor_id_fkey(id, company_name, vendor_code)',
    )
    .eq('ai_status', 'pending_review')
    .order('ai_extracted_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error(`${op} query failed`, {
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    });
    return [];
  }

  return (data ?? []) as AiReviewBill[];
}

/**
 * getAiReviewKpis
 *
 * Returns summary counts for the review queue dashboard card.
 * "Today" is measured in IST (UTC+5:30).
 */
export async function getAiReviewKpis(): Promise<AiReviewKpis> {
  const op = '[getAiReviewKpis]';
  const supabase = await createClient();

  // Today in IST (UTC+5:30): subtract 5.5 hours from midnight IST to get UTC boundary
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMidnight = new Date(
    Math.floor((now.getTime() + istOffsetMs) / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000) -
      istOffsetMs,
  );
  const todayUtc = istMidnight.toISOString();

  const [pendingResult, approvedTodayResult, rejectedTodayResult, avgResult] = await Promise.all([
    // Pending count — use estimated on potentially large table
    supabase
      .from('vendor_bills')
      .select('id', { count: 'estimated', head: true })
      .eq('ai_status', 'pending_review')
      .is('deleted_at', null),

    // Approved today
    supabase
      .from('vendor_bills')
      .select('id', { count: 'estimated', head: true })
      .eq('ai_status', 'approved')
      .gte('ai_extracted_at', todayUtc),

    // Rejected today
    supabase
      .from('vendor_bills')
      .select('id', { count: 'estimated', head: true })
      .eq('ai_status', 'rejected')
      .gte('ai_extracted_at', todayUtc),

    // Average confidence (pending only) — computed in JS since Supabase REST has no AVG()
    supabase
      .from('vendor_bills')
      .select('ai_confidence_score')
      .eq('ai_status', 'pending_review')
      .not('ai_confidence_score', 'is', null)
      .limit(100),
  ]);

  if (pendingResult.error) {
    console.error(`${op} pending count failed`, { error: pendingResult.error.message });
  }
  if (approvedTodayResult.error) {
    console.error(`${op} approved today count failed`, { error: approvedTodayResult.error.message });
  }

  let avgConfidence: number | null = null;
  if (!avgResult.error && avgResult.data && avgResult.data.length > 0) {
    const scores = avgResult.data
      .map(r => r.ai_confidence_score)
      .filter((s): s is number => s !== null);
    if (scores.length > 0) {
      avgConfidence = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  return {
    pending_count: pendingResult.count ?? 0,
    approved_today: approvedTodayResult.count ?? 0,
    rejected_today: rejectedTodayResult.count ?? 0,
    avg_confidence: avgConfidence,
  };
}

/**
 * getVendorBillForAiReview
 *
 * Fetches a single vendor bill with its AI extraction metadata,
 * line items, and vendor details for the review detail page.
 */
export async function getVendorBillForAiReview(id: string) {
  const op = '[getVendorBillForAiReview]';
  const supabase = await createClient();

  const [billResult, itemsResult] = await Promise.all([
    supabase
      .from('vendor_bills')
      .select(
        '*, vendors!vendor_bills_vendor_id_fkey(id, company_name, vendor_code, is_msme, gstin), projects!vendor_bills_project_id_fkey(project_number, customer_name), purchase_orders!vendor_bills_purchase_order_id_fkey(po_number)',
      )
      .eq('id', id)
      .single(),

    supabase
      .from('vendor_bill_items')
      .select('*')
      .eq('vendor_bill_id', id)
      .order('id'),
  ]);

  if (billResult.error) {
    console.error(`${op} bill fetch failed`, {
      id,
      error: billResult.error.message,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  return {
    bill: billResult.data,
    items: itemsResult.data ?? [],
  };
}
