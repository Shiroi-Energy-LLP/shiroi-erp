import { createClient } from '@repo/supabase/server';

export async function getInvoices(filters: { status?: string; search?: string } = {}) {
  const op = '[getInvoices]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  let query = supabase
    .from('invoices')
    .select('*, projects!invoices_project_id_fkey(project_number, customer_name)')
    .order('invoice_date', { ascending: false })
    .limit(100);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) query = query.or(`invoice_number.ilike.%${filters.search}%`);
  const { data, error } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load invoices: ${error.message}`);
  }
  return data ?? [];
}
