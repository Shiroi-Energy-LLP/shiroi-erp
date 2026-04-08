import { createClient } from '@repo/supabase/server';

export async function getPayments(filters: { type?: string; search?: string } = {}) {
  const op = '[getPayments]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  let query = supabase
    .from('customer_payments')
    .select('*, projects!customer_payments_project_id_fkey(project_number, customer_name)')
    .order('payment_date', { ascending: false })
    .limit(100);
  if (filters.type === 'advance') query = query.eq('is_advance', true);
  if (filters.type === 'milestone') query = query.eq('is_advance', false);
  if (filters.search) query = query.or(`payment_reference.ilike.%${filters.search}%,receipt_number.ilike.%${filters.search}%`);
  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load payments: ${error.message}`);
  }
  return data ?? [];
}
