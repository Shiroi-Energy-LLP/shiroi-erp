import { createClient } from '@repo/supabase/server';

export type VendorBillStatus = 'draft' | 'pending' | 'partially_paid' | 'paid' | 'cancelled';

export interface VendorBillFilters {
  status?: VendorBillStatus;
  vendor_id?: string;
}

export async function getVendorBills(filters: VendorBillFilters = {}) {
  const op = '[getVendorBills]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  let query = supabase
    .from('vendor_bills')
    .select(
      'id, bill_number, bill_date, due_date, status, total_amount, amount_paid, balance_due, vendor_id, project_id, source, zoho_bill_id, vendors!vendor_bills_vendor_id_fkey(company_name, vendor_code, is_msme), projects!vendor_bills_project_id_fkey(project_number, customer_name)'
    )
    .order('bill_date', { ascending: false })
    .limit(200);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.vendor_id) {
    query = query.eq('vendor_id', filters.vendor_id);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load vendor bills: ${error.message}`);
  }
  return data ?? [];
}

export async function getVendorBillById(id: string) {
  const op = '[getVendorBillById]';
  const supabase = await createClient();

  const [billResult, itemsResult, paymentsResult] = await Promise.all([
    supabase
      .from('vendor_bills')
      .select(
        '*, vendors!vendor_bills_vendor_id_fkey(id, company_name, vendor_code, is_msme, udyam_type, udyam_number, gstin), projects!vendor_bills_project_id_fkey(project_number, customer_name), purchase_orders!vendor_bills_purchase_order_id_fkey(po_number)'
      )
      .eq('id', id)
      .single(),

    supabase
      .from('vendor_bill_items')
      .select('*')
      .eq('vendor_bill_id', id)
      .order('id'),

    supabase
      .from('vendor_payments')
      .select('id, amount, payment_date, payment_method, payment_reference, notes')
      .eq('vendor_bill_id', id)
      .order('payment_date', { ascending: false }),
  ]);

  if (billResult.error) {
    console.error(`${op} Bill fetch failed:`, { code: billResult.error.code, message: billResult.error.message, id });
    return null;
  }

  return {
    bill: billResult.data,
    items: itemsResult.data ?? [],
    payments: paymentsResult.data ?? [],
  };
}

export async function getVendorBillsSummary() {
  const op = '[getVendorBillsSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('vendor_bills')
    .select('status, total_amount, balance_due');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return { totalPending: 0, totalPaid: 0, totalOverdue: 0, pendingCount: 0 };
  }

  const rows = data ?? [];
  const today = new Date().toISOString().split('T')[0];

  let totalPending = 0, totalPaid = 0, pendingCount = 0;
  for (const r of rows) {
    if (r.status === 'paid') {
      totalPaid += Number(r.total_amount);
    } else if (r.status !== 'cancelled') {
      totalPending += Number(r.balance_due ?? 0);
      pendingCount++;
    }
  }

  return { totalPending, totalPaid, pendingCount };
}

export async function getVendorById(id: string) {
  const op = '[getVendorById]';
  const supabase = await createClient();

  const [vendorResult, billsResult, paymentsResult] = await Promise.all([
    supabase
      .from('vendors')
      .select('*')
      .eq('id', id)
      .single(),

    supabase
      .from('vendor_bills')
      .select('id, bill_number, bill_date, due_date, status, total_amount, balance_due, projects!vendor_bills_project_id_fkey(project_number, customer_name)')
      .eq('vendor_id', id)
      .order('bill_date', { ascending: false })
      .limit(50),

    supabase
      .from('vendor_payments')
      .select('id, amount, payment_date, payment_method, payment_reference')
      .eq('vendor_id', id)
      .order('payment_date', { ascending: false })
      .limit(50),
  ]);

  if (vendorResult.error) {
    console.error(`${op} Vendor fetch failed:`, { code: vendorResult.error.code, message: vendorResult.error.message, id });
    return null;
  }

  return {
    vendor: vendorResult.data,
    bills: billsResult.data ?? [],
    payments: paymentsResult.data ?? [],
  };
}

export async function getProfitabilityV2() {
  const op = '[getProfitabilityV2]';
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_project_profitability_v2');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return [];
  }

  return (data ?? []) as Array<{
    project_id: string;
    project_number: string;
    customer_name: string;
    status: string;
    contracted_value: string | number;
    total_invoiced: string | number;
    total_received: string | number;
    total_ar_outstanding: string | number;
    total_billed: string | number;
    total_vendor_paid: string | number;
    total_ap_outstanding: string | number;
    total_expenses: string | number;
    total_cost: string | number;
    margin_amount: string | number;
    margin_pct: string | number | null;
  }>;
}

export async function getCashSummaryV2() {
  const op = '[getCashSummaryV2]';
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_company_cash_summary_v2');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return null;
  }

  return (data?.[0] ?? null) as {
    total_receivables: number;
    total_ap_bills: number;
    total_ap_pos: number;
    total_project_expenses_paid: number;
    zoho_monthly_company_expenses: number;
    open_reconciliation_count: number;
  } | null;
}

export async function getZohoMonthlySummary() {
  const op = '[getZohoMonthlySummary]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('zoho_monthly_summary')
    .select('*')
    .order('month_date', { ascending: false })
    .limit(12);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
