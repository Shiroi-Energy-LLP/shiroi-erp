import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

// Re-export pure helpers for convenience
export { daysUntilPayroll, classifyInvestment } from './dashboard-helpers';

export async function getCashNegativeProjects() {
  const op = '[getCashNegativeProjects]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_cash_positions')
    .select('project_id, net_cash_position, is_invested, projects!inner(project_number, customer_name, status)')
    .eq('is_invested', true)
    .order('net_cash_position', { ascending: true })
    .limit(10);
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load cash positions: ${error.message}`);
  }
  return data ?? [];
}

export async function getPipelineSummary() {
  const op = '[getPipelineSummary]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('total_after_discount, status')
    .in('status', ['draft', 'sent', 'negotiating']);
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load pipeline: ${error.message}`);
  }
  const total = (data ?? []).reduce(
    (sum, p) => sum.add(new Decimal(p.total_after_discount ?? '0')),
    new Decimal(0)
  );
  return { count: data?.length ?? 0, totalValue: total.toNumber() };
}

export async function getProposalsPendingApproval() {
  const op = '[getProposalsPendingApproval]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('id, proposal_number, total_after_discount, created_at, lead_id, margin_approval_required, leads(customer_name)')
    .eq('margin_approval_required', true)
    .is('margin_approved_by', null)
    .in('status', ['draft', 'sent'])
    .order('created_at', { ascending: true });
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load pending approvals: ${error.message}`);
  }
  return data ?? [];
}

export async function getProjectsWithNoReportToday() {
  const op = '[getProjectsWithNoReportToday]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  // Use IST date — toISOString() is UTC and wrong after midnight IST / before midnight UTC
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Get active projects (those that should have daily reports)
  const { data: activeProjects, error: projectError } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, status')
    .not('status', 'in', '("completed","cancelled","on_hold","commissioned","net_metering_pending")');
  if (projectError) {
    console.error(`${op} Projects query failed:`, { code: projectError.code, message: projectError.message });
    throw new Error(`Failed to load projects: ${projectError.message}`);
  }

  // Get today's reports
  const { data: todayReports, error: reportError } = await supabase
    .from('daily_site_reports')
    .select('project_id')
    .eq('report_date', todayStr);
  if (reportError) {
    console.error(`${op} Reports query failed:`, { code: reportError.code, message: reportError.message });
    throw new Error(`Failed to load reports: ${reportError.message}`);
  }

  const reportedProjectIds = new Set((todayReports ?? []).map(r => r.project_id));
  return (activeProjects ?? []).filter(p => !reportedProjectIds.has(p.id));
}
