import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type RpcRow = Database['public']['Functions']['get_payment_tracker_rows']['Returns'][number];

export interface PaymentTrackerRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  project_status: Database['public']['Enums']['project_status'];
  order_date: string | null;
  order_date_source: string;
  completed_date: string | null;
  contracted_value: number;
  total_invoiced: number;
  total_invoice_sent: number;
  total_received: number;
  remaining: number;
  days_since_order: number;
  latest_payment_date: string | null;
}

export interface PaymentTrackerSummary {
  total_outstanding: number;
  outstanding_30d: number;
  outstanding_60d: number;
  avg_days_to_last_receipt: number | null;
}

/**
 * Fetch per-project payment tracker rollup from the database.
 * All monetary aggregation is done in SQL (NEVER-DO #12).
 */
export async function getPaymentTrackerRows(): Promise<PaymentTrackerRow[]> {
  const op = '[getPaymentTrackerRows]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_payment_tracker_rows');

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message, timestamp: new Date().toISOString() });
    throw new Error(`Failed to load payment tracker rows: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  return (data as RpcRow[]).map((row) => ({
    project_id: row.project_id,
    project_number: row.project_number,
    customer_name: row.customer_name,
    project_status: row.project_status,
    order_date: row.order_date ?? null,
    order_date_source: row.order_date_source,
    completed_date: row.completed_date ?? null,
    contracted_value: Number(row.contracted_value),
    total_invoiced: Number(row.total_invoiced),
    total_invoice_sent: Number(row.total_invoice_sent),
    total_received: Number(row.total_received),
    remaining: Number(row.remaining),
    days_since_order: Number(row.days_since_order),
    latest_payment_date: row.latest_payment_date ?? null,
  }));
}

/**
 * Compute KPI summary over the full (unfiltered) row set.
 * Inputs are project-level rollups from the SQL RPC — not raw money rows.
 */
export function computePaymentTrackerSummary(rows: PaymentTrackerRow[]): PaymentTrackerSummary {
  let totalOutstanding = 0;
  let outstanding30d = 0;
  let outstanding60d = 0;

  for (const row of rows) {
    if (row.remaining > 0) {
      totalOutstanding += row.remaining;
      if (row.days_since_order >= 30) outstanding30d += row.remaining;
      if (row.days_since_order >= 60) outstanding60d += row.remaining;
    }
  }

  const projectsWithReceipts = rows.filter(
    (r) => r.latest_payment_date && r.order_date
  );

  const avgDaysToLastReceipt: number | null =
    projectsWithReceipts.length === 0
      ? null
      : projectsWithReceipts.reduce((sum, r) => {
          const days =
            (new Date(r.latest_payment_date!).getTime() -
              new Date(r.order_date!).getTime()) /
            86400000;
          return sum + Math.max(0, days);
        }, 0) / projectsWithReceipts.length;

  return {
    total_outstanding: totalOutstanding,
    outstanding_30d: outstanding30d,
    outstanding_60d: outstanding60d,
    avg_days_to_last_receipt:
      avgDaysToLastReceipt !== null ? Math.round(avgDaysToLastReceipt) : null,
  };
}

/**
 * Filter tracker rows by the selected tab.
 * Default (unknown filter) falls through to 'outstanding'.
 */
export function filterPaymentTrackerRows(
  rows: PaymentTrackerRow[],
  filter: string
): PaymentTrackerRow[] {
  switch (filter) {
    case 'all':
      return rows;
    case 'outstanding':
      return rows.filter((r) => r.remaining > 0);
    case 'awaiting_invoice':
      return rows.filter(
        (r) => r.remaining > 0 && r.total_invoiced < r.contracted_value
      );
    case 'sent_unpaid':
      return rows.filter((r) => r.total_invoice_sent > r.total_received);
    case 'order_30d':
      return rows.filter((r) => r.days_since_order >= 30 && r.remaining > 0);
    case 'order_60d':
      return rows.filter((r) => r.days_since_order >= 60 && r.remaining > 0);
    default:
      return rows.filter((r) => r.remaining > 0);
  }
}
