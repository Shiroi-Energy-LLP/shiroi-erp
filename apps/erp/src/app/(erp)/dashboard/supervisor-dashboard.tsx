import { getUserProfile } from '@/lib/auth';
import { getSupervisorDashboardData } from '@/lib/supervisor-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { HardHat, Lock, AlertTriangle } from 'lucide-react';

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function SupervisorDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getSupervisorDashboardData(profile.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Site Supervisor Dashboard</h1>

      {/* Active Project Card */}
      {data.activeProject ? (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <HardHat className="h-8 w-8 text-[#00B050]" />
                <div>
                  <h2 className="font-heading text-lg font-bold text-[#1A1D24]">
                    {data.activeProject.project_number}
                  </h2>
                  <p className="text-sm text-[#5A5E6B]">
                    {data.activeProject.customer_name} &middot; {data.activeProject.site_city}
                  </p>
                  {data.activeProject.currentMilestone && (
                    <p className="text-xs text-[#7C818E] mt-0.5">
                      Current: {data.activeProject.currentMilestone}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="neutral">
                  {data.activeProject.system_size_kwp} kWp
                </Badge>
                <Badge variant="pending">
                  {formatStatus(data.activeProject.status)}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center justify-center text-center">
              <HardHat className="h-10 w-10 text-[#9CA0AB] mb-3" />
              <h2 className="text-base font-heading font-bold text-[#1A1D24]">
                No Active Project
              </h2>
              <p className="text-sm text-[#7C818E] mt-1">
                You are not currently assigned to any active project.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Today's Report"
          value={data.todayReportSubmitted ? 'Submitted' : 'Pending'}
          icon={data.todayReportSubmitted ? "CheckCircle" : "AlertTriangle"}
          subNote={data.todayReportSubmitted ? 'Report filed' : 'Not yet submitted'}
        />
        <KpiCard
          label="Open Tasks"
          value={data.openTaskCount}
          icon="ClipboardList"
          subNote={data.openTaskCount > 0 ? 'Assigned to you' : undefined}
        />
        <KpiCard
          label="Recent Reports"
          value={data.recentReports.length}
          icon="ClipboardList"
          subNote="Last 5 reports"
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Today's Report CTA */}
          {!data.todayReportSubmitted && data.activeProject && (
            <Card className="border-[#F59E0B] bg-[#FFFBEB]">
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-[#D97706]" />
                  <div>
                    <p className="text-sm font-semibold text-[#92400E]">
                      Daily Site Report Not Submitted
                    </p>
                    <p className="text-xs text-[#92400E]">
                      Submit your report for today before end of day.
                    </p>
                  </div>
                </div>
                <Badge variant="warning">Action Required</Badge>
              </CardContent>
            </Card>
          )}

          {data.employeeId && <MyTasks employeeId={data.employeeId} />}
        </div>

        {/* Right: Recent Reports */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Reports</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentReports.length === 0 ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">
                  No reports filed yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.recentReports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[#1A1D24]">
                          {formatDate(report.report_date)}
                        </span>
                        <span className="text-xs text-[#7C818E] truncate max-w-[160px]">
                          {report.panels_installed_today} panels installed
                        </span>
                      </div>
                      {report.computedLocked ? (
                        <Lock className="h-4 w-4 text-[#9CA0AB]" />
                      ) : (
                        <Badge variant="success">Editable</Badge>
                      )}
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
