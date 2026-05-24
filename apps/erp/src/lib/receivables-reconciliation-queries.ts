import { createClient } from '@repo/supabase/server';

export interface ReconciliationRow {
  project_id: string;
  project_number: string;
  customer_name: string;
  project_status: string;
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  invoice_count: number;
  overdue_count: number;
  last_payment_date: string | null;
}

export interface ReconciliationKpis {
  total_outstanding: number;
  overdue_60d: number;
  projects_no_invoice: number;
}

/**
 * Fetch per-project receivables reconciliation from SQL RPC.
 * All monetary aggregation is done in SQL (NEVER-DO #12).
 */
export async function getReceivablesReconciliation(): Promise<ReconciliationRow[]> {
  const op = '[getReceivablesReconciliation]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_receivables_reconciliation');

  if (error) {
    console.error(`${op} RPC failed:`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load receivables reconciliation: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  return (data as ReconciliationRow[]).map((row) => ({
    project_id: row.project_id,
    project_number: row.project_number,
    customer_name: row.customer_name,
    project_status: row.project_status,
    total_invoiced: Number(row.total_invoiced),
    total_paid: Number(row.total_paid),
    outstanding: Number(row.outstanding),
    invoice_count: Number(row.invoice_count),
    overdue_count: Number(row.overdue_count),
    last_payment_date: row.last_payment_date ?? null,
  }));
}

/**
 * Compute KPI strip totals from already-fetched reconciliation rows.
 * No monetary aggregation in JS — this only sums pre-aggregated SQL row values.
 */
export function computeReconciliationKpis(
  rows: ReconciliationRow[],
  today: Date = new Date(),
): ReconciliationKpis {
  let total_outstanding = 0;
  let overdue_60d = 0;
  let projects_no_invoice = 0;

  for (const row of rows) {
    total_outstanding += row.outstanding;
    if (row.invoice_count === 0) {
      projects_no_invoice += 1;
    }
    // 60+ day overdue: project has outstanding and last_payment_date is >60d ago or never paid
    if (row.outstanding > 0) {
      const lastPaid = row.last_payment_date ? new Date(row.last_payment_date) : null;
      const daysSincePayment = lastPaid
        ? Math.floor((today.getTime() - lastPaid.getTime()) / 86_400_000)
        : 999;
      if (daysSincePayment >= 60) {
        overdue_60d += row.outstanding;
      }
    }
  }

  return { total_outstanding, overdue_60d, projects_no_invoice };
}
