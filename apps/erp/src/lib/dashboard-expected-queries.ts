import { createClient } from '@repo/supabase/server';

export interface ExpectedOrderRow {
  lead_id: string;
  customer_name: string;
  status: string;
  estimated_size_kwp: number | null;
  base_quote_price: number | null;
  derived_value: number;
  expected_close_date: string;
  close_probability: number | null;
  days_until: number;
}

export interface ExpectedPaymentRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  milestone_name: string;
  milestone_order: number;
  amount: number;
  expected_payment_date: string;
  days_until: number;
}

export async function getExpectedOrders(windowDays: number): Promise<ExpectedOrderRow[]> {
  const op = '[getExpectedOrders]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_expected_orders', { window_days: windowDays });
  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load expected orders: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    lead_id: r.lead_id,
    customer_name: r.customer_name,
    status: r.status,
    estimated_size_kwp: r.estimated_size_kwp !== null ? Number(r.estimated_size_kwp) : null,
    base_quote_price: r.base_quote_price !== null ? Number(r.base_quote_price) : null,
    derived_value: Number(r.derived_value),
    expected_close_date: r.expected_close_date,
    close_probability: r.close_probability,
    days_until: r.days_until,
  }));
}

export async function getExpectedPayments(windowDays: number): Promise<ExpectedPaymentRow[]> {
  const op = '[getExpectedPayments]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_expected_payments', { window_days: windowDays });
  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load expected payments: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    project_id: r.project_id,
    project_number: r.project_number,
    customer_name: r.customer_name,
    milestone_name: r.milestone_name,
    milestone_order: r.milestone_order,
    amount: Number(r.amount),
    expected_payment_date: r.expected_payment_date,
    days_until: r.days_until,
  }));
}

export function splitWeekAndMonthOnly<T extends { lead_id?: string; project_id?: string; milestone_order?: number }>(
  weekRows: T[],
  monthRows: T[],
  keyFn: (row: T) => string,
): { week: T[]; monthOnly: T[] } {
  const weekKeys = new Set(weekRows.map(keyFn));
  return {
    week: weekRows,
    monthOnly: monthRows.filter((r) => !weekKeys.has(keyFn(r))),
  };
}
