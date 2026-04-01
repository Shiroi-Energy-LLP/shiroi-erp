import { getUserProfile } from '@/lib/auth';
import { getFinanceDashboardData } from '@/lib/finance-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import { CashAlertTable } from './cash-alert-table';
import { shortINR } from '@repo/ui/formatters';



export async function FinanceDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getFinanceDashboardData(profile.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Finance Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Invested Capital"
          value={shortINR(parseFloat(data.totalInvestedCapital))}
          icon="DollarSign"
          subNote="Cash-negative positions"
        />
        <KpiCard
          label="Total Receivables"
          value={shortINR(parseFloat(data.totalReceivables))}
          icon="TrendingUp"
          subNote="Outstanding invoices"
        />
        <KpiCard
          label="MSME Due"
          value={data.msmeDueThisWeek}
          icon="Shield"
          subNote={data.msmeDueThisWeek > 0 ? 'Due this week' : 'No urgent payments'}
        />
        <KpiCard
          label="Overdue Invoices"
          value={data.overdueInvoiceCount}
          icon="FileText"
          subNote={data.overdueInvoiceCount > 0 ? 'Past due date' : undefined}
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <CashAlertTable projects={data.cashNegativeProjects} />
          {data.employeeId && <MyTasks employeeId={data.employeeId} />}
        </div>

        <div className="space-y-6">
          {/* Summary card can be extended later */}
        </div>
      </div>
    </div>
  );
}
