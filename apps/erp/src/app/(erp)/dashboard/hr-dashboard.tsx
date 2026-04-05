import { getUserProfile } from '@/lib/auth';
import { getHRDashboardData } from '@/lib/hr-dashboard-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  EmptyState,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { CalendarCheck, AlertTriangle } from 'lucide-react';

function formatLeaveType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function leaveStatusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' | 'pending' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
      return 'warning';
    case 'rejected':
      return 'error';
    default:
      return 'neutral';
  }
}

export async function HRDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getHRDashboardData(profile.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">HR Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Active Employees"
          value={data.activeEmployeeCount}
          icon="UserCog"
        />
        <KpiCard
          label="Pending Leave"
          value={data.pendingLeaveCount}
          icon="CalendarCheck"
          subNote={data.pendingLeaveCount > 0 ? 'Awaiting approval' : undefined}
        />
        <KpiCard
          label="Certs Expiring"
          value={data.expiringCertCount}
          icon="Award"
          subNote={data.expiringCertCount > 0 ? 'Within 30 days' : undefined}
        />
        <KpiCard
          label="Days to Payroll"
          value={data.daysToPayroll}
          icon="Clock"
          subNote="25th of month"
        />
      </div>

      {/* Cert expiry alerts */}
      {data.certExpiryAlerts.length > 0 && (
        <Card className="border-[#F59E0B] bg-[#FFFBEB]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#D97706]" />
              Certification Expiry Alerts
            </CardTitle>
            <Badge variant="warning">{data.certExpiryAlerts.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.certExpiryAlerts.map((cert) => (
                <div
                  key={cert.id}
                  className="flex items-center justify-between rounded-md border border-[#FDE68A] bg-white px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-[#1A1D24]">
                      {cert.employee_name}
                    </span>
                    <span className="text-xs text-[#7C818E]">
                      {cert.certification_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#7C818E]">
                      Expires {formatDate(cert.expiry_date)}
                    </span>
                    {cert.blocks_deployment && (
                      <Badge variant="error">Blocks Deploy</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Recent Leave Requests */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Recent Leave Requests</CardTitle>
              <Badge variant="neutral">{data.recentLeaveRequests.length}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {data.recentLeaveRequests.length === 0 ? (
                <EmptyState
                  icon={<CalendarCheck className="h-12 w-12" />}
                  title="No recent leave requests"
                  description="Leave requests will appear here once submitted."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentLeaveRequests.map((lr) => (
                      <TableRow key={lr.id}>
                        <TableCell className="font-medium text-[#1A1D24]">
                          {lr.employee_name}
                        </TableCell>
                        <TableCell>{formatLeaveType(lr.leave_type)}</TableCell>
                        <TableCell>{formatDate(lr.from_date)}</TableCell>
                        <TableCell>{formatDate(lr.to_date)}</TableCell>
                        <TableCell>{lr.days_requested}</TableCell>
                        <TableCell>
                          <Badge variant={leaveStatusVariant(lr.status)}>
                            {lr.status.charAt(0).toUpperCase() + lr.status.slice(1)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {data.employeeId && <MyTasks employeeId={data.employeeId} />}
        </div>

        {/* Right: Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2">
                  <span className="text-sm text-[#5A5E6B]">Active employees</span>
                  <span className="font-heading text-lg font-bold text-[#111318]">
                    {data.activeEmployeeCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2">
                  <span className="text-sm text-[#5A5E6B]">Pending leaves</span>
                  <span className="font-heading text-lg font-bold text-[#111318]">
                    {data.pendingLeaveCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2">
                  <span className="text-sm text-[#5A5E6B]">Certs expiring</span>
                  <span className="font-heading text-lg font-bold text-[#111318]">
                    {data.expiringCertCount}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
