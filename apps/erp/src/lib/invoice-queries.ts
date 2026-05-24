import { createClient } from '@repo/supabase/server';

/**
 * Fetch all invoices for a specific project, ordered newest-first.
 * Used by the project detail finance tab and raise-invoice panels.
 */
export async function getProjectInvoices(projectId: string) {
  const op = '[getProjectInvoices]';
  console.log(`${op} Starting for project: ${projectId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_type, milestone_name, total_amount, amount_paid, amount_outstanding, invoice_date, due_date, status, notes, erp_created, description')
    .eq('project_id', projectId)
    .neq('status', 'cancelled')
    .order('invoice_date', { ascending: false })
    .limit(50);
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, projectId });
    throw new Error(`Failed to load project invoices: ${error.message}`);
  }
  return data ?? [];
}

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
