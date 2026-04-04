import { getUserProfile } from '@/lib/auth';
import { getPMDashboardData } from '@/lib/pm-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import { PMDonutChart } from '@/components/dashboard/pm-donut-chart';
import { OperationsWidget } from '@/components/dashboard/operations-widget';
import { TodayPriorities } from '@/components/dashboard/today-priorities';
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

  const data = await getPMDashboardData(profile.id);
  const firstName = profile.full_name?.split(' ')[0] ?? 'there';
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
        {greeting}, {firstName}
      </h1>

      <div className="grid grid-cols-4 gap-4">
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
