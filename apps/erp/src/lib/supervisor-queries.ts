import { createClient } from '@repo/supabase/server';
import { isReportLocked } from './report-lock';

export interface SupervisorDashboardData {
  activeProject: {
    id: string;
    project_number: string;
    customer_name: string;
    site_city: string;
    status: string;
    system_size_kwp: number;
    currentMilestone: string | null;
  } | null;
  todayReportSubmitted: boolean;
  todayReportId: string | null;
  recentReports: Array<{
    id: string;
    report_date: string;
    work_description: string;
    panels_installed_today: number;
    is_locked: boolean;
    computedLocked: boolean;
  }>;
  openTaskCount: number;
  employeeId: string | null;
}

export async function getSupervisorDashboardData(profileId: string): Promise<SupervisorDashboardData> {
  const op = '[getSupervisorDashboardData]';
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
    return {
      activeProject: null,
      todayReportSubmitted: false,
      todayReportId: null,
      recentReports: [],
      openTaskCount: 0,
      employeeId: null,
    };
  }
  const employeeId = emp?.id ?? null;
  if (!employeeId) {
    console.warn(`${op} No active employee found for profile: ${profileId}`);
    return {
      activeProject: null,
      todayReportSubmitted: false,
      todayReportId: null,
      recentReports: [],
      openTaskCount: 0,
      employeeId: null,
    };
  }

  // Get active project for this supervisor
  const { data: projects, error: projectError } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, site_city, status, system_size_kwp')
    .eq('site_supervisor_id', employeeId)
    .not('status', 'in', '(completed,cancelled)')
    .limit(1);

  if (projectError) {
    console.error(`${op} Projects query failed:`, { code: projectError.code, message: projectError.message });
    throw new Error(`Failed to load projects: ${projectError.message}`);
  }

  const activeProject = projects?.[0] ?? null;

  if (!activeProject) {
    // No active project — fetch open task count only
    const { count: taskCount } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .eq('is_completed', false)
      .is('deleted_at', null);

    return {
      activeProject: null,
      todayReportSubmitted: false,
      todayReportId: null,
      recentReports: [],
      openTaskCount: taskCount ?? 0,
      employeeId,
    };
  }

  // Get current milestone for the active project
  const { data: currentMilestone } = await supabase
    .from('project_milestones')
    .select('milestone_name')
    .eq('project_id', activeProject.id)
    .eq('status', 'in_progress')
    .order('milestone_order', { ascending: true })
    .limit(1);

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const [todayReportResult, recentReportsResult, taskCountResult] = await Promise.all([
    // Today's report for this project
    supabase
      .from('daily_site_reports')
      .select('id')
      .eq('project_id', activeProject.id)
      .eq('report_date', todayStr)
      .limit(1),

    // Recent 5 reports
    supabase
      .from('daily_site_reports')
      .select('id, report_date, work_description, panels_installed_today, is_locked')
      .eq('project_id', activeProject.id)
      .order('report_date', { ascending: false })
      .limit(5),

    // Open tasks
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', employeeId)
      .eq('is_completed', false)
      .is('deleted_at', null),
  ]);

  if (todayReportResult.error) {
    console.error(`${op} Today report query failed:`, { code: todayReportResult.error.code, message: todayReportResult.error.message });
  }

  if (recentReportsResult.error) {
    console.error(`${op} Recent reports query failed:`, { code: recentReportsResult.error.code, message: recentReportsResult.error.message });
  }

  if (taskCountResult.error) {
    console.error(`${op} Task count query failed:`, { code: taskCountResult.error.code, message: taskCountResult.error.message });
  }

  const todayReport = todayReportResult.data?.[0] ?? null;
  const recentReports = (recentReportsResult.data ?? []).map((r) => ({
    id: r.id,
    report_date: r.report_date,
    work_description: r.work_description,
    panels_installed_today: r.panels_installed_today,
    is_locked: r.is_locked,
    computedLocked: isReportLocked(r.report_date, r.is_locked),
  }));

  return {
    activeProject: {
      ...activeProject,
      currentMilestone: currentMilestone?.[0]?.milestone_name ?? null,
    },
    todayReportSubmitted: !!todayReport,
    todayReportId: todayReport?.id ?? null,
    recentReports,
    openTaskCount: taskCountResult.count ?? 0,
    employeeId,
  };
}
