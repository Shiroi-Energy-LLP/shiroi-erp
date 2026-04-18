import { createClient } from '@repo/supabase/server';

export interface MsmeAgingBucket {
  bucket: string;
  bill_count: number;
  total_amount: number;
}

export async function getRecentVendorPayments() {
  const op = '[getRecentVendorPayments]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('vendor_payments')
    .select(
      'id, amount, payment_date, payment_method, payment_reference, notes, vendor_id, vendor_bill_id, purchase_order_id, vendors!vendor_payments_vendor_id_fkey(company_name, is_msme), vendor_bills!vendor_payments_vendor_bill_id_fkey(bill_number), purchase_orders!vendor_payments_purchase_order_id_fkey(po_number)'
    )
    .order('payment_date', { ascending: false })
    .limit(100);

  if (error) {
    console.error(`${op} query failed:`, { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}

export async function getMsmeAgingSummary(): Promise<MsmeAgingBucket[]> {
  const op = '[getMsmeAgingSummary]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_msme_aging_summary');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((r) => ({
    bucket: r.bucket,
    bill_count: Number(r.bill_count),
    total_amount: Number(r.total_amount),
  }));
}
