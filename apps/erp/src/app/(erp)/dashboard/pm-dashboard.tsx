import { getUserProfile } from '@/lib/auth';
import { getPMDashboardData } from '@/lib/pm-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

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

function formatStatus(status: string): string {
  return status
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const STATUS_COLORS: Record<string, string> = {
  proposal_accepted: 'bg-[#DBEAFE] text-[#1E40AF]',
  material_procurement: 'bg-[#FEF3C7] text-[#92400E]',
  installation: 'bg-[#D1FAE5] text-[#065F46]',
  inspection: 'bg-[#EDE9FE] text-[#5B21B6]',
  commissioned: 'bg-[#CFFAFE] text-[#155E75]',
  net_metering_pending: 'bg-[#FFF7ED] text-[#9A3412]',
  on_hold: 'bg-[#FEE2E2] text-[#991B1B]',
};

function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-[#F1F3F5] text-[#4B5563]';
}

export async function PMDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getPMDashboardData(profile.id);
  const firstName = profile.full_name?.split(' ')[0] ?? 'there';
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
        {greeting}, {firstName}
      </h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Active Projects"
          value={data.activeProjectCount}
          icon="HardHat"
        />
        <KpiCard
          label="Total System Size"
          value={data.totalSystemSizeKwp.toFixed(1)}
          unit="kWp"
          icon="Sun"
        />
        <KpiCard
          label="Open Tasks"
          value={data.openTaskCount}
          icon="ClipboardList"
          subNote={data.openTaskCount > 0 ? 'Assigned to you' : undefined}
        />
        <KpiCard
          label="Service Tickets"
          value={data.openServiceTicketCount}
          icon="Wrench"
          subNote={data.openServiceTicketCount > 0 ? 'Open across all projects' : undefined}
        />
      </div>

      {/* Main content area */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column: Tasks + Overdue Reports */}
        <div className="col-span-2 space-y-6">
          {data.employeeId && <MyTasks employeeId={data.employeeId} />}

          {/* Overdue Reports */}
          {data.overdueProjects.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[#D97706]" />
                  Missing Site Reports Today
                </CardTitle>
                <Badge variant="warning">{data.overdueProjects.length}</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.overdueProjects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[#1A1D24]">
                          {project.project_number}
                        </span>
                        <span className="text-xs text-[#7C818E]">
                          {project.customer_name}
                        </span>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(project.status)}`}>
                        {formatStatus(project.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Projects by Status */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Projects by Status</CardTitle>
            </CardHeader>
            <CardContent>
              {data.projectsByStatus.length === 0 ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">
                  No active projects assigned.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.projectsByStatus.map(({ status, count }) => (
                    <div
                      key={status}
                      className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2"
                    >
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(status)}`}>
                        {formatStatus(status)}
                      </span>
                      <span className="font-heading text-lg font-bold text-[#111318]">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
