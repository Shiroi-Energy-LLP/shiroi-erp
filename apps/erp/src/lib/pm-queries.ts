import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

export interface PMDashboardData {
  totalSystemSizeKwp: number;
  totalClients: number;
  totalSales: number;
  avgProfitPct: number;
  projectsByStatus: Array<{ status: string; count: number }>;
  openTaskCount: number;
  totalTaskCount: number;
  openServiceTicketCount: number;
  totalServiceTicketCount: number;
  amcCompletedThisMonth: number;
  amcScheduledThisMonth: number;
  priorityProjects: Array<{
    id: string;
    project_number: string;
    customer_name: string;
    city: string;
    status: string;
    reason: string;
  }>;
  employeeId: string | null;
}

async function getEmployeeId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
): Promise<string | null> {
  const op = '[getEmployeeId]';
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, profileId });
    return null;
  }
  return data?.id ?? null;
}

export async function getPMDashboardData(profileId: string): Promise<PMDashboardData> {
  const op = '[getPMDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();
  const employeeId = await getEmployeeId(supabase, profileId);

  if (!employeeId) {
    console.warn(`${op} No active employee found for profile: ${profileId}`);
    return {
      totalSystemSizeKwp: 0,
      totalClients: 0,
      totalSales: 0,
      avgProfitPct: 0,
      projectsByStatus: [],
      openTaskCount: 0,
      totalTaskCount: 0,
      openServiceTicketCount: 0,
      totalServiceTicketCount: 0,
      amcCompletedThisMonth: 0,
      amcScheduledThisMonth: 0,
      priorityProjects: [],
      employeeId: null,
    };
  }

  const excludedStatuses = ['completed', 'holding_client', 'meter_client_scope'];
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const [
    activeProjectsResult,
    openTasksResult,
    totalTasksResult,
    openTicketsResult,
    totalTicketsResult,
    amcScheduledResult,
    amcCompletedResult,
    overdueResult,
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, status, system_size_kwp, contracted_value, customer_name, site_city')
      .eq('project_manager_id', employeeId)
      .not('status', 'in', `(${excludedStatuses.join(',')})`),

    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .eq('is_completed', false)
      .is('deleted_at', null),

    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .is('deleted_at', null),

    supabase
      .from('om_service_tickets')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(resolved,closed)'),

    supabase
      .from('om_service_tickets')
      .select('id', { count: 'exact', head: true }),

    supabase
      .from('om_visit_schedules')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd),

    supabase
      .from('om_visit_schedules')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd)
      .eq('status', 'completed'),

    getOverdueProjectsForPM(supabase, employeeId, todayStr),
  ]);

  if (activeProjectsResult.error) {
    console.error(`${op} Active projects query failed:`, {
      code: activeProjectsResult.error.code,
      message: activeProjectsResult.error.message,
    });
    throw new Error(`Failed to load active projects: ${activeProjectsResult.error.message}`);
  }

  const activeProjects = activeProjectsResult.data ?? [];

  const totalSystemSize = activeProjects.reduce(
    (sum, p) => sum.add(new Decimal(p.system_size_kwp ?? '0')),
    new Decimal(0),
  );

  const uniqueClients = new Set(activeProjects.map((p) => p.customer_name));

  const totalSales = activeProjects.reduce(
    (sum, p) => sum.add(new Decimal(p.contracted_value ?? '0')),
    new Decimal(0),
  );

  const avgProfitPct = 0;

  const statusCounts = new Map<string, number>();
  for (const project of activeProjects) {
    const status = project.status ?? 'unknown';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const projectsByStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const priorityProjects = overdueResult.slice(0, 5).map((p) => ({
    ...p,
    reason: 'Missing daily report',
  }));

  return {
    totalSystemSizeKwp: totalSystemSize.toNumber(),
    totalClients: uniqueClients.size,
    totalSales: totalSales.toNumber(),
    avgProfitPct,
    projectsByStatus,
    openTaskCount: openTasksResult.count ?? 0,
    totalTaskCount: totalTasksResult.count ?? 0,
    openServiceTicketCount: openTicketsResult.count ?? 0,
    totalServiceTicketCount: totalTicketsResult.count ?? 0,
    amcCompletedThisMonth: amcCompletedResult.count ?? 0,
    amcScheduledThisMonth: amcScheduledResult.count ?? 0,
    priorityProjects,
    employeeId,
  };
}

async function getOverdueProjectsForPM(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  todayStr: string,
): Promise<Array<{ id: string; project_number: string; customer_name: string; city: string; status: string }>> {
  const op = '[getOverdueProjectsForPM]';

  const { data: activeProjects, error: projectError } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, site_city, status')
    .eq('project_manager_id', employeeId)
    .not('status', 'in', '("completed","holding_shiroi","holding_client","waiting_net_metering","meter_client_scope")');

  if (projectError) {
    console.error(`${op} Projects query failed:`, { code: projectError.code, message: projectError.message });
    throw new Error(`Failed to load PM projects: ${projectError.message}`);
  }

  if (!activeProjects || activeProjects.length === 0) return [];

  const projectIds = activeProjects.map((p) => p.id);
  const { data: todayReports, error: reportError } = await supabase
    .from('daily_site_reports')
    .select('project_id')
    .eq('report_date', todayStr)
    .in('project_id', projectIds);

  if (reportError) {
    console.error(`${op} Reports query failed:`, { code: reportError.code, message: reportError.message });
    throw new Error(`Failed to load reports: ${reportError.message}`);
  }

  const reportedProjectIds = new Set((todayReports ?? []).map((r) => r.project_id));
  return activeProjects
    .filter((p) => !reportedProjectIds.has(p.id))
    .map((p) => ({ ...p, city: p.site_city }));
}
