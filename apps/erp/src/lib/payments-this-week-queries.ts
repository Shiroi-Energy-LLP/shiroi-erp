/**
 * payments-this-week-queries.ts
 *
 * Queries for the "Payments Expected This Week" KPI surface.
 * Uses the get_payments_expected_this_week() RPC (migration 117).
 *
 * Separate from payments-tracker-queries.ts to keep each file focused
 * and avoid bundling dashboard-level queries with tracker-level queries.
 */

import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type RpcRow = Database['public']['Functions']['get_payments_expected_this_week']['Returns'][number];

export interface PaymentThisWeekRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  expected_payment_date: string;
  amount_due: number;
  follow_up_count: number;
  milestone_name: string;
  milestone_order: number;
  /** SQL SUM over all this-week rows — same value on every row (NEVER-DO #12). */
  week_total: number;
}

/**
 * Fetch all payment-schedule rows whose expected_payment_date falls within
 * the current ISO week (Mon–Sun IST). All filtering done in SQL via the
 * get_payments_expected_this_week() RPC (migration 117).
 */
export async function getPaymentsExpectedThisWeek(): Promise<PaymentThisWeekRow[]> {
  const op = '[getPaymentsExpectedThisWeek]';

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_payments_expected_this_week');

  if (error) {
    console.error(`${op} RPC failed`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load this-week payments: ${error.message}`);
  }

  return (data ?? []).map((r: RpcRow) => ({
    project_id: String(r.project_id),
    project_number: r.project_number,
    customer_name: r.customer_name,
    expected_payment_date: r.expected_payment_date,
    amount_due: Number(r.amount_due),
    follow_up_count: Number(r.follow_up_count),
    milestone_name: r.milestone_name,
    milestone_order: Number(r.milestone_order),
    week_total: Number(r.week_total),
  }));
}

/**
 * Return the SQL-computed total for all this-week rows.
 * The total is carried as week_total on every row (SUM OVER () in the RPC),
 * satisfying NEVER-DO #12 — no JS summation of raw money rows.
 */
export function sumThisWeekAmount(rows: PaymentThisWeekRow[]): number {
  return rows[0]?.week_total ?? 0;
}
