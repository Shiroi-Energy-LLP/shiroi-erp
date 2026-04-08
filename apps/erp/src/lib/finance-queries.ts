import { createClient } from '@repo/supabase/server';
import { getCompanyCashSummary } from './cash-queries';
import { getCashNegativeProjects } from './dashboard-queries';
import Decimal from 'decimal.js';

export interface FinanceDashboardData {
  totalInvestedCapital: string;
  totalReceivables: string;
  msmeDueThisWeek: number;
  overdueInvoiceCount: number;
  cashNegativeProjects: Array<{
    project_id: string;
    net_cash_position: number;
    is_invested: boolean;
    projects: {
      project_number: string;
      customer_name: string;
      status: string;
    };
  }>;
  employeeId: string | null;
}

export async function getFinanceDashboardData(profileId: string): Promise<FinanceDashboardData> {
  const op = '[getFinanceDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();

  // Get employee ID
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (empError) {
    console.error(`${op} Employee lookup failed:`, { code: empError.code, message: empError.message, profileId });
  }
  const employeeId = emp?.id ?? null;

  // Calculate MSME due this week
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const [
    cashSummary,
    cashNegativeProjects,
    overdueResult,
    msmeDueResult,
  ] = await Promise.all([
    getCompanyCashSummary(),
    getCashNegativeProjects(),
    // Overdue invoices count
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'paid')
      .lt('due_date', new Date().toISOString().split('T')[0]),
    // MSME vendor POs due this week — uses RPC to filter in SQL
    supabase.rpc('get_msme_due_count', { p_due_before: weekEndStr }),
  ]);

  if (overdueResult.error) {
    console.error(`${op} Overdue invoices query failed:`, { code: overdueResult.error.code, message: overdueResult.error.message });
  }

  if (msmeDueResult.error) {
    console.error(`${op} MSME due RPC failed:`, { code: msmeDueResult.error.code, message: msmeDueResult.error.message });
  }

  const msmeDueCount = Number(msmeDueResult.data ?? 0);

  return {
    totalInvestedCapital: cashSummary.totalInvestedCapital,
    totalReceivables: cashSummary.totalReceivables,
    msmeDueThisWeek: msmeDueCount,
    overdueInvoiceCount: overdueResult.count ?? 0,
    cashNegativeProjects,
    employeeId,
  };
}
