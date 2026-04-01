import { createClient } from '@repo/supabase/server';
import Decimal from 'decimal.js';

export interface PMDashboardData {
  activeProjectCount: number;
  totalSystemSizeKwp: number;
  openTaskCount: number;
  openServiceTicketCount: number;
  projectsByStatus: Array<{ status: string; count: number }>;
  overdueProjects: Array<{
    id: string;
    project_number: string;
    customer_name: string;
    status: string;
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
      activeProjectCount: 0,
      totalSystemSizeKwp: 0,
      openTaskCount: 0,
      openServiceTicketCount: 0,
      projectsByStatus: [],
      overdueProjects: [],
      employeeId: null,
    };
  }

  const excludedStatuses = ['completed', 'cancelled'];

  const [
    activeProjectsResult,
    openTasksResult,
    serviceTicketsResult,
    overdueResult,
  ] = await Promise.all([
    // Active projects with system size
    supabase
      .from('projects')
      .select('id, status, system_size_kwp')
      .eq('project_manager_id', employeeId)
      .not('status', 'in', `(${excludedStatuses.join(',')})`),

    // Open task count
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .eq('is_completed', false)
      .is('deleted_at', null),

    // Open service tickets (for PM's projects)
    supabase
      .from('om_service_tickets')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(resolved,closed)'),

    // Projects with no report today (overdue reports)
    getOverdueProjectsForPM(supabase, employeeId),
  ]);

  // Handle active projects
  if (activeProjectsResult.error) {
    console.error(`${op} Active projects query failed:`, {
      code: activeProjectsResult.error.code,
      message: activeProjectsResult.error.message,
    });
    throw new Error(`Failed to load active projects: ${activeProjectsResult.error.message}`);
  }

  if (openTasksResult.error) {
    console.error(`${op} Open tasks query failed:`, {
      code: openTasksResult.error.code,
      message: openTasksResult.error.message,
    });
    throw new Error(`Failed to load open tasks: ${openTasksResult.error.message}`);
  }

  if (serviceTicketsResult.error) {
    console.error(`${op} Service tickets query failed:`, {
      code: serviceTicketsResult.error.code,
      message: serviceTicketsResult.error.message,
    });
    throw new Error(`Failed to load service tickets: ${serviceTicketsResult.error.message}`);
  }

  const activeProjects = activeProjectsResult.data ?? [];

  // Calculate total system size using decimal.js
  const totalSystemSize = activeProjects.reduce(
    (sum, p) => sum.add(new Decimal(p.system_size_kwp ?? '0')),
    new Decimal(0),
  );

  // Group projects by status
  const statusCounts = new Map<string, number>();
  for (const project of activeProjects) {
    const status = project.status ?? 'unknown';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const projectsByStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    activeProjectCount: activeProjects.length,
    totalSystemSizeKwp: totalSystemSize.toNumber(),
    openTaskCount: openTasksResult.count ?? 0,
    openServiceTicketCount: serviceTicketsResult.count ?? 0,
    projectsByStatus,
    overdueProjects: overdueResult,
    employeeId,
  };
}

async function getOverdueProjectsForPM(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
): Promise<Array<{ id: string; project_number: string; customer_name: string; status: string }>> {
  const op = '[getOverdueProjectsForPM]';
  // Use IST date
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Get active projects for this PM that should have daily reports
  const { data: activeProjects, error: projectError } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, status')
    .eq('project_manager_id', employeeId)
    .not('status', 'in', '("completed","cancelled","on_hold","commissioned","net_metering_pending")');

  if (projectError) {
    console.error(`${op} Projects query failed:`, { code: projectError.code, message: projectError.message });
    throw new Error(`Failed to load PM projects: ${projectError.message}`);
  }

  if (!activeProjects || activeProjects.length === 0) return [];

  // Get today's reports
  const projectIds = activeProjects.map(p => p.id);
  const { data: todayReports, error: reportError } = await supabase
    .from('daily_site_reports')
    .select('project_id')
    .eq('report_date', todayStr)
    .in('project_id', projectIds);

  if (reportError) {
    console.error(`${op} Reports query failed:`, { code: reportError.code, message: reportError.message });
    throw new Error(`Failed to load reports: ${reportError.message}`);
  }

  const reportedProjectIds = new Set((todayReports ?? []).map(r => r.project_id));
  return activeProjects.filter(p => !reportedProjectIds.has(p.id));
}
