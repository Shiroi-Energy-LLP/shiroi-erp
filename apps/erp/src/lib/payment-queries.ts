import { createClient } from '@repo/supabase/server';

// Row shape returned by search_payments RPC. The page consumes this as a
// flat row + projects { project_number, customer_name } sub-object — we
// rehydrate that shape after the RPC call so the page contract is unchanged.
type SearchPaymentRow = {
  id: string;
  project_id: string | null;
  invoice_id: string | null;
  recorded_by: string;
  receipt_number: string;
  amount: number | string;
  payment_date: string;
  payment_method: string;
  payment_reference: string | null;
  bank_name: string | null;
  cheque_date: string | null;
  is_advance: boolean;
  receipt_pdf_path: string | null;
  notes: string | null;
  created_at: string;
  project_number: string | null;
  customer_name: string | null;
};

export async function getPayments(filters: { type?: string; search?: string } = {}) {
  const op = '[getPayments]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  // Item 2b: parameter-bound RPC replaces .or() interpolation. Type filter
  // and pagination preserved; embed (project_number, customer_name) is
  // re-shaped client-side to match the old .select() embed contract.
  const trimmed = filters.search?.trim();
  const { data, error } = await supabase.rpc('search_payments', {
    p_query: trimmed && trimmed.length > 0 ? trimmed : undefined,
    p_type: filters.type ?? undefined,
    p_limit: 100,
    p_offset: 0,
  });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load payments: ${error.message}`);
  }

  const rows = (data ?? []) as SearchPaymentRow[];
  return rows.map(({ project_number, customer_name, amount, ...rest }) => ({
    ...rest,
    // RPC NUMERIC columns come back as `number | string` depending on driver.
    // Coerce once here so callers can rely on a plain number.
    amount: typeof amount === 'string' ? Number(amount) : amount,
    projects: project_number !== null || customer_name !== null
      ? { project_number, customer_name }
      : null,
  }));
}
