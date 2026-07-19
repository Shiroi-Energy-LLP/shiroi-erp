import Link from 'next/link';
import { getUserProfile } from '@/lib/auth';
import { getPMDashboardData } from '@/lib/pm-queries';
import { getProjectsWithNoReportToday } from '@/lib/dashboard-queries';
import { KpiCard } from '@repo/ui';
import { MyTasks } from '@/components/my-tasks';
import { PMDonutChart } from '@/components/dashboard/pm-donut-chart';
import { OperationsWidget } from '@/components/dashboard/operations-widget';
import { TodayPriorities } from '@/components/dashboard/today-priorities';
import { DataReviewBanner } from '@/components/dashboard/data-review-banner';
import { shortINR } from '@repo/ui/formatters';

function getGreeting(): string {
  const hour = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  });
  const h = parseInt(hour, 10);
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export async function PMDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const [data, projectsMissingReport] = await Promise.all([
    getPMDashboardData(profile.id),
    getProjectsWithNoReportToday(),
  ]);
  const firstName = profile.full_name?.split(' ')[0] ?? 'there';
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-n-950">
        {greeting}, {firstName}
      </h1>

      <DataReviewBanner />

      <div className="grid grid-cols-5 gap-4">
        <KpiCard
          label="Total System Size"
          value={data.totalSystemSizeKwp.toFixed(1)}
          unit="kWp"
          icon="Sun"
        />
        <KpiCard
          label="Total Clients"
          value={data.totalClients}
          icon="Users"
        />
        <KpiCard
          label="Total Sales"
          value={shortINR(data.totalSales)}
          icon="TrendingUp"
        />
        <KpiCard
          label="Avg. Profit %"
          value={data.avgProfitPct > 0 ? `${data.avgProfitPct.toFixed(1)}%` : '—'}
          icon="BarChart3"
          subNote={data.avgProfitPct === 0 ? 'No cost data yet' : undefined}
        />
        <Link href="/daily-reports" className="block">
          <KpiCard
            label="No Report Today"
            value={projectsMissingReport.length}
            subNote={projectsMissingReport.length === 0 ? 'All caught up' : 'Active projects'}
            icon="FileText"
          />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <PMDonutChart data={data.projectsByStatus} />
          {data.employeeId && <MyTasks employeeId={data.employeeId} />}
        </div>

        <div className="space-y-6">
          <OperationsWidget
            openTasks={data.openTaskCount}
            totalTasks={data.totalTaskCount}
            openTickets={data.openServiceTicketCount}
            totalTickets={data.totalServiceTicketCount}
            amcCompleted={data.amcCompletedThisMonth}
            amcScheduled={data.amcScheduledThisMonth}
          />
          <TodayPriorities projects={data.priorityProjects} />
        </div>
      </div>
    </div>
  );
}
