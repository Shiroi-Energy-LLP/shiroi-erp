import { getUserProfile } from '@/lib/auth';
import { getSalesDashboardData } from '@/lib/sales-queries';
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
import { shortINR } from '@repo/ui/formatters';
import { Phone, Filter } from 'lucide-react';

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const FUNNEL_COLORS: Record<string, string> = {
  new: 'bg-[#E0F2FE] text-[#0369A1]',
  contacted: 'bg-[#DBEAFE] text-[#1E40AF]',
  site_survey_scheduled: 'bg-[#FEF3C7] text-[#92400E]',
  site_survey_done: 'bg-[#FEF9C3] text-[#854D0E]',
  proposal_sent: 'bg-[#EDE9FE] text-[#5B21B6]',
  negotiation: 'bg-[#FFF7ED] text-[#9A3412]',
  won: 'bg-[#D1FAE5] text-[#065F46]',
  on_hold: 'bg-[#F1F3F5] text-[#4B5563]',
};

export async function SalesDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getSalesDashboardData(profile.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Sales Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="New Leads"
          value={data.newLeadsThisMonth}
          icon="Users"
          subNote="This month"
        />
        <KpiCard
          label="Negotiation Pipeline"
          value={shortINR(data.pipelineValue)}
          icon="TrendingUp"
          subNote={`${data.pipelineLeadCount} lead${data.pipelineLeadCount === 1 ? '' : 's'} in negotiation`}
        />
        <KpiCard
          label="Won This Month"
          value={data.wonThisMonth}
          icon="Award"
        />
        <KpiCard
          label="Conversion Rate"
          value={`${data.conversionRate}%`}
          icon="BarChart3"
          subNote="Qualified to won"
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Follow-ups Today */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="h-4 w-4 text-[#00B050]" />
                Follow-ups Today
              </CardTitle>
              <Badge variant={data.followUpsToday.length > 0 ? 'warning' : 'neutral'}>
                {data.followUpsToday.length}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {data.followUpsToday.length === 0 ? (
                <EmptyState
                  icon={<Phone className="h-12 w-12" />}
                  title="No follow-ups today"
                  description="No follow-ups scheduled for today."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.followUpsToday.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium text-[#1A1D24]">
                          {lead.customer_name}
                        </TableCell>
                        <TableCell>{lead.phone}</TableCell>
                        <TableCell>{lead.city}</TableCell>
                        <TableCell>
                          <Badge variant="pending">{formatStatus(lead.status)}</Badge>
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

        {/* Right: Lead Funnel */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lead Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {data.leadFunnel.length === 0 ? (
                <EmptyState
                  icon={<Filter className="h-12 w-12" />}
                  title="No active leads"
                  description="No active leads in the pipeline."
                />
              ) : (
                <div className="space-y-2">
                  {data.leadFunnel.map(({ status, count }) => (
                    <div
                      key={status}
                      className="flex items-center justify-between rounded-md border border-[#DFE2E8] px-3 py-2"
                    >
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          FUNNEL_COLORS[status] ?? 'bg-[#F1F3F5] text-[#4B5563]'
                        }`}
                      >
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
