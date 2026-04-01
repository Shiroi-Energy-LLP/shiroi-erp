import { notFound } from 'next/navigation';
import { getProjectForReport, getLastReport } from '@/lib/site-report-queries';
import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ReportForm } from '@/components/reports/report-form';

interface NewReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewReportPage({ params }: NewReportPageProps) {
  const { id } = await params;

  const [project, lastReport, profile] = await Promise.all([
    getProjectForReport(id),
    getLastReport(id),
    getUserProfile(),
  ]);

  if (!profile) {
    redirect('/login');
  }

  if (!project) {
    notFound();
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD in IST

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1A1D24]">New Daily Site Report</h2>
        <p className="text-sm text-muted-foreground">
          {project.project_number} - {project.customer_name}
        </p>
      </div>

      <ReportForm
        projectId={id}
        userId={profile.id}
        defaultDate={today}
        defaultWorkersCount={lastReport?.workers_count ?? 0}
        defaultSupervisorsCount={lastReport?.supervisors_count ?? 0}
        previousCumulativePanels={lastReport?.panels_installed_cumulative ?? 0}
      />
    </div>
  );
}
