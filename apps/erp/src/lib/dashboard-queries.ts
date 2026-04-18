import { createClient } from '@repo/supabase/server';

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

/**
 * Pipeline summary for the founder dashboard — replaces JS-side reduce
 * over all draft/sent/negotiating proposals. Uses RPC from migration 048.
 */
export async function getPipelineSummary() {
  const op = '[getPipelineSummary]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_pipeline_summary');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load pipeline: ${error.message}`);
  }
  const row = data?.[0];
  return {
    count: Number(row?.proposal_count ?? 0),
    totalValue: Number(row?.total_value ?? 0),
  };
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

/**
 * Projects missing today's daily site report — replaces 2-query N+1 +
 * JS-side filter with a single SQL anti-join. Uses RPC from migration 048
 * which resolves "today" in IST (Asia/Kolkata) server-side so client
 * timezone drift can't skew the result.
 */
export async function getProjectsWithNoReportToday() {
  const op = '[getProjectsWithNoReportToday]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_projects_without_today_report');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load projects: ${error.message}`);
  }
  // Shape-compat with old callers that expected {id, project_number, customer_name, status}
  return (data ?? []).map((r) => ({
    id: r.project_id,
    project_number: r.project_number,
    customer_name: r.customer_name,
    status: r.status,
  }));
}

/**
 * AMC monthly summary — replaces the two exact-count head queries against
 * om_visit_schedules. Uses RPC from migration 048 which filters by
 * local-month bounds (Asia/Kolkata) server-side in a single round-trip.
 */
export async function getAmcMonthlySummary(): Promise<{ scheduled: number; completed: number }> {
  const op = '[getAmcMonthlySummary]';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_amc_monthly_summary');
  if (error) {
    console.error(`${op} RPC failed:`, { code: error.code, message: error.message });
    return { scheduled: 0, completed: 0 };
  }
  const row = data?.[0];
  return {
    scheduled: Number(row?.scheduled_count ?? 0),
    completed: Number(row?.completed_count ?? 0),
  };
}

/**
 * Zoho sync queue health — counts active (pending/syncing) vs failed rows.
 * Drives the "Zoho Sync" card on the founder dashboard.
 * Enum values match migration 067: pending, syncing, synced, failed, skipped.
 */
export async function getZohoSyncHealth() {
  const op = '[getZohoSyncHealth]';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('zoho_sync_queue')
    .select('status')
    .in('status', ['pending', 'syncing', 'failed']);
  if (error) {
    console.error(`${op} query failed:`, { code: error.code, message: error.message });
    return { pending: 0, dead: 0 };
  }
  const rows = data ?? [];
  return {
    pending: rows.filter((r) => r.status === 'pending' || r.status === 'syncing').length,
    dead: rows.filter((r) => r.status === 'failed').length,
  };
}
