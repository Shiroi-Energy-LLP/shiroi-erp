import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type InvoiceRow = Database['public']['Tables']['invoices']['Row'];
type InvoiceListRow = InvoiceRow & {
  projects: { project_number: string | null; customer_name: string | null } | null;
};

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
  // Item 2b: typed search RPC replaces .or() interpolation. The RPC returns
  // every invoice column inline plus project_number + customer_name from
  // the projects join, so we reshape the flat row back into the `projects`
  // sub-object shape that /invoices/page.tsx consumes today.
  // Cast bridge until parent regens database.ts at end-of-batch.
  const { data, error } = await supabase.rpc('search_invoices', {
    p_status: filters.status || undefined,
    p_query: filters.search || undefined,
    p_limit: 100,
  });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load invoices: ${error.message}`);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r): InvoiceListRow => {
    const { project_number, customer_name, ...invoice } = r;
    return {
      ...(invoice as unknown as InvoiceRow),
      projects: project_number || customer_name
        ? {
            project_number: (project_number as string | null) ?? null,
            customer_name: (customer_name as string | null) ?? null,
          }
        : null,
    };
  });
}
