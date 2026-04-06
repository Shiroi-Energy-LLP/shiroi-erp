import { notFound, redirect } from 'next/navigation';
import { getReport, getLastReport } from '@/lib/site-report-queries';
import { getUserProfile } from '@/lib/auth';
import { isReportLocked } from '@/lib/report-lock';
import { ReportForm } from '@/components/reports/report-form';

interface EditReportPageProps {
  params: Promise<{ id: string; reportId: string }>;
}

export default async function EditReportPage({ params }: EditReportPageProps) {
  const { id: projectId, reportId } = await params;

  const [report, profile, lastReport] = await Promise.all([
    getReport(reportId),
    getUserProfile(),
    getLastReport(projectId),
  ]);

  if (!profile) {
    redirect('/login');
  }

  if (!report) {
    notFound();
  }

  // Cannot edit locked reports — redirect to correction flow
  const locked = isReportLocked(report.report_date, report.is_locked);
  if (locked) {
    redirect(`/projects/${projectId}/reports/${reportId}/correction`);
  }

  // Calculate previous cumulative (subtract today's panels from cumulative to get the baseline)
  const previousCumulative = (report.panels_installed_cumulative ?? 0) - (report.panels_installed_today ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1A1D24]">Edit Daily Site Report</h2>
        <p className="text-sm text-muted-foreground">
          Editing report for {report.report_date}
        </p>
      </div>

      <ReportForm
        projectId={projectId}
        userId={profile.id}
        defaultDate={report.report_date}
        defaultWorkersCount={lastReport?.workers_count ?? 0}
        defaultSupervisorsCount={lastReport?.supervisors_count ?? 0}
        previousCumulativePanels={previousCumulative}
        existingReport={{
          id: report.id,
          report_date: report.report_date,
          panels_installed_today: report.panels_installed_today,
          workers_count: report.workers_count,
          supervisors_count: report.supervisors_count,
          weather: report.weather,
          weather_delay: report.weather_delay,
          weather_delay_hours: report.weather_delay_hours,
          work_description: report.work_description,
          structure_progress: report.structure_progress,
          electrical_progress: report.electrical_progress,
          materials_received: report.materials_received,
          materials_summary: report.materials_summary,
          issues_reported: report.issues_reported,
          issue_summary: report.issue_summary,
          pm_visited: report.pm_visited,
          other_visitors: report.other_visitors,
        }}
      />
    </div>
  );
}
