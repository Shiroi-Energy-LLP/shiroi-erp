import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

export interface ProjectPaymentRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  project_status: string;
  contracted_value: number;
  completion_pct: number;
  total_received: number;
  outstanding: number;
  total_po_cost: number;
  total_site_expenses: number;
  project_pnl: number;
  next_milestone_name: string | null;
  next_milestone_amount: number | null;
  next_milestone_pct: number | null;
  payment_stage: string;
  expected_payment_date: string | null;
  pm_name: string | null;
}

export interface PaymentsSummary {
  total_contracted: number;
  total_received: number;
  total_outstanding: number;
  total_invested: number;
  net_position: number;
  expected_this_week: number;
  expected_this_month: number;
  projects_with_outstanding: number;
}

/**
 * Get all active projects with payment tracking data.
 * This is the crux query for the Payments page.
 *
 * As of migration 145 (2026-05-30) this delegates to the
 * `get_project_payment_overview()` SQL RPC. The previous
 * implementation pulled all 328+ contracted projects + 4 batched
 * IN() queries across customer_payments / purchase_orders /
 * expenses / proposal_payment_schedule, then did 4 JS reduce
 * loops to roll up money totals — violating NEVER-DO #12 and
 * scaling linearly (~10K+ rows on every page load).
 *
 * All aggregation now happens server-side in a single round-trip.
 * Output shape matches the original interface byte-for-byte.
 */
export async function getProjectPaymentOverview(): Promise<ProjectPaymentRow[]> {
  const op = '[getProjectPaymentOverview]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_project_payment_overview');

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load payment overview: ${error.message}`);
  }

  if (!data) return [];

  // Numeric columns come back as strings from Supabase (NUMERIC type) —
  // coerce to number to preserve the original ProjectPaymentRow contract.
  return data.map((row: Record<string, unknown>) => ({
    project_id: row.project_id as string,
    project_number: row.project_number as string,
    customer_name: row.customer_name as string,
    project_status: row.project_status as string,
    contracted_value: Number(row.contracted_value),
    completion_pct: Number(row.completion_pct),
    total_received: Number(row.total_received),
    outstanding: Number(row.outstanding),
    total_po_cost: Number(row.total_po_cost),
    total_site_expenses: Number(row.total_site_expenses),
    project_pnl: Number(row.project_pnl),
    next_milestone_name: (row.next_milestone_name as string | null) ?? null,
    next_milestone_amount: row.next_milestone_amount == null
      ? null
      : Number(row.next_milestone_amount),
    next_milestone_pct: row.next_milestone_pct == null
      ? null
      : Number(row.next_milestone_pct),
    payment_stage: row.payment_stage as string,
    expected_payment_date: (row.expected_payment_date as string | null) ?? null,
    pm_name: (row.pm_name as string | null) ?? null,
  }));
}

/**
 * Compute summary stats for the payments overview.
 */
export function computePaymentsSummary(rows: ProjectPaymentRow[]): PaymentsSummary {
  let totalContracted = new Decimal(0);
  let totalReceived = new Decimal(0);
  let totalInvested = new Decimal(0);
  let projectsWithOutstanding = 0;

  for (const row of rows) {
    totalContracted = totalContracted.add(row.contracted_value);
    totalReceived = totalReceived.add(row.total_received);
    totalInvested = totalInvested.add(row.total_po_cost + row.total_site_expenses);
    if (row.outstanding > 0) {
      projectsWithOutstanding++;
    }
  }

  const totalOutstanding = totalContracted.sub(totalReceived);
  const netPosition = totalReceived.sub(totalInvested);

  // Expected this week/month: sum of next_milestone_amount for active projects
  // (Projects that are in progress and have an outstanding next milestone)
  const activeStatuses = ['order_received', 'yet_to_start', 'in_progress', 'waiting_net_metering'];
  const activeRows = rows.filter(r => activeStatuses.includes(r.project_status) && r.next_milestone_amount);
  const expectedThisWeek = activeRows
    .slice(0, 10) // Top 10 active projects most likely to pay
    .reduce((sum, r) => sum + (r.next_milestone_amount ?? 0), 0);
  const expectedThisMonth = activeRows
    .reduce((sum, r) => sum + (r.next_milestone_amount ?? 0), 0);

  return {
    total_contracted: totalContracted.toNumber(),
    total_received: totalReceived.toNumber(),
    total_outstanding: totalOutstanding.toNumber(),
    total_invested: totalInvested.toNumber(),
    net_position: netPosition.toNumber(),
    expected_this_week: expectedThisWeek,
    expected_this_month: expectedThisMonth,
    projects_with_outstanding: projectsWithOutstanding,
  };
}
