import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

// Re-export helpers for convenience
export {
  getEscalationLevel,
  getEscalationLabel,
  getEscalationVariant,
  calcDaysOverdue,
  classifyCashPosition,
  cashPositionColor,
} from './cash-helpers';

/** Aggregated company-wide cash summary across all active projects. */
export interface CompanyCashSummary {
  totalInvestedCapital: string;
  totalReceivables: string;
  activePOValue: string;
  projectCount: number;
  investedProjectCount: number;
}

/**
 * Fetches an aggregated cash summary across all active projects.
 * Uses decimal.js for all arithmetic — no floating point.
 */
export async function getCompanyCashSummary(): Promise<CompanyCashSummary> {
  const op = '[getCompanyCashSummary]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  // Use RPC function — SUM/COUNT in SQL instead of fetching all rows to JS
  const { data, error } = await supabase.rpc('get_company_cash_summary');

  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load company cash summary: ${error.message}`);
  }

  const row = data?.[0] ?? {
    total_invested: 0, total_receivables: 0, active_po_value: 0,
    project_count: 0, invested_count: 0,
  };

  return {
    totalInvestedCapital: new Decimal(row.total_invested).toFixed(2),
    totalReceivables: new Decimal(row.total_receivables).toFixed(2),
    activePOValue: new Decimal(row.active_po_value).toFixed(2),
    projectCount: Number(row.project_count),
    investedProjectCount: Number(row.invested_count),
  };
}

/**
 * Fetches all project cash positions with joined project info.
 */
export async function getAllProjectPositions() {
  const op = '[getAllProjectPositions]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_cash_positions')
    .select(
      'id, project_id, net_cash_position, total_contracted, total_invoiced, total_received, total_outstanding, total_po_value, total_paid_to_vendors, total_vendor_outstanding, is_invested, invested_since, days_invested, uninvoiced_milestone_alert, uninvoiced_since, last_computed_at, projects!project_cash_positions_project_id_fkey(project_number, customer_name, status)',
    )
    .order('net_cash_position', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load project positions: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Fetches overdue invoices: status != 'paid' AND due_date < today.
 * Joins project info for display.
 */
export async function getOverdueInvoices() {
  const op = '[getOverdueInvoices]';
  console.log(`${op} Starting`);
  const supabase = await createClient();

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, invoice_date, due_date, total_amount, amount_paid, amount_outstanding, status, escalation_level, legal_flagged, milestone_name, project_id, projects!invoices_project_id_fkey(project_number, customer_name)',
    )
    .neq('status', 'paid')
    .lt('due_date', today)
    .order('due_date', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load overdue invoices: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Fetches the full cash detail for a single project: cash position, invoices, and vendor payments.
 */
export async function getProjectCashDetail(projectId: string) {
  const op = '[getProjectCashDetail]';
  console.log(`${op} Starting for: ${projectId}`);
  if (!projectId) throw new Error(`${op} Missing required parameter: projectId`);

  const supabase = await createClient();

  // Fetch in parallel: cash position, invoices, vendor payments with PO info
  const [cashResult, invoicesResult, paymentsResult] = await Promise.all([
    supabase
      .from('project_cash_positions')
      .select(
        '*, projects!project_cash_positions_project_id_fkey(project_number, customer_name, status, contracted_value, system_size_kwp, system_type)',
      )
      .eq('project_id', projectId)
      .single(),
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, invoice_date, due_date, invoice_type, milestone_name, total_amount, amount_paid, amount_outstanding, status, escalation_level, legal_flagged',
      )
      .eq('project_id', projectId)
      .order('invoice_date', { ascending: true }),
    supabase
      .from('vendor_payments')
      .select(
        'id, amount, payment_date, payment_method, payment_reference, po_date, days_from_po, msme_compliant, purchase_orders!vendor_payments_purchase_order_id_fkey(po_number, total_amount, status), vendors!vendor_payments_vendor_id_fkey(company_name)',
      )
      .eq('project_id', projectId)
      .order('payment_date', { ascending: false }),
  ]);

  if (cashResult.error) {
    console.error(`${op} Cash position query failed:`, {
      code: cashResult.error.code,
      message: cashResult.error.message,
      projectId,
    });
    throw new Error(`Failed to load cash position: ${cashResult.error.message}`);
  }
  if (!cashResult.data) {
    console.warn(`${op} No cash position found for project:`, { projectId });
    return null;
  }

  if (invoicesResult.error) {
    console.error(`${op} Invoices query failed:`, {
      code: invoicesResult.error.code,
      message: invoicesResult.error.message,
      projectId,
    });
    throw new Error(`Failed to load invoices: ${invoicesResult.error.message}`);
  }

  if (paymentsResult.error) {
    console.error(`${op} Vendor payments query failed:`, {
      code: paymentsResult.error.code,
      message: paymentsResult.error.message,
      projectId,
    });
    throw new Error(`Failed to load vendor payments: ${paymentsResult.error.message}`);
  }

  return {
    cashPosition: cashResult.data,
    invoices: invoicesResult.data ?? [],
    vendorPayments: paymentsResult.data ?? [],
  };
}
