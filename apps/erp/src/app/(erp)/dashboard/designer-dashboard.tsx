import { getUserProfile } from '@/lib/auth';
import { getDesignerDashboardData } from '@/lib/designer-queries';
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
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { Palette } from 'lucide-react';

export async function DesignerDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getDesignerDashboardData(profile.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Workspace</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Pending Designs"
          value={data.pendingDesigns}
          icon="Palette"
          subNote={data.pendingDesigns > 0 ? 'Awaiting design' : undefined}
        />
        <KpiCard
          label="In Progress"
          value={data.inProgress}
          icon="Clock"
          subNote="Draft proposals"
        />
        <KpiCard
          label="Completed This Month"
          value={data.completedThisMonth}
          icon="CheckCircle"
        />
        <KpiCard
          label="Queue Length"
          value={data.queueLength}
          icon="LayoutList"
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left: Design Queue + Tasks */}
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Design Queue</CardTitle>
              <Badge variant="neutral">{data.designQueue.length}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {data.designQueue.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[#9CA0AB]">
                  <Palette className="h-8 w-8 mb-2" />
                  <p className="text-sm">No leads awaiting design.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>System Size</TableHead>
                      <TableHead>Survey Date</TableHead>
                      <TableHead>Days Waiting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.designQueue.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium text-[#1A1D24]">
                          {lead.customer_name}
                        </TableCell>
                        <TableCell>{lead.city}</TableCell>
                        <TableCell>
                          {lead.estimated_size_kwp
                            ? `${lead.estimated_size_kwp} kWp`
                            : '--'}
                        </TableCell>
                        <TableCell>{formatDate(lead.status_updated_at.split('T')[0] ?? lead.status_updated_at)}</TableCell>
                        <TableCell>
                          <Badge variant={lead.daysWaiting > 3 ? 'error' : lead.daysWaiting > 1 ? 'warning' : 'neutral'}>
                            {lead.daysWaiting}d
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
                  <span className="text-sm text-[#5A5E6B]">Pending designs</span>
                  <span className="font-heading text-lg font-bold text-[#111318]">
                    {data.pendingDesigns}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2">
                  <span className="text-sm text-[#5A5E6B]">Drafts in progress</span>
                  <span className="font-heading text-lg font-bold text-[#111318]">
                    {data.inProgress}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2">
                  <span className="text-sm text-[#5A5E6B]">Completed this month</span>
                  <span className="font-heading text-lg font-bold text-[#111318]">
                    {data.completedThisMonth}
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
