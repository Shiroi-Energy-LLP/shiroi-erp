import {
  getCashNegativeProjects,
  getPipelineSummary,
  getProposalsPendingApproval,
  getProjectsWithNoReportToday,
  daysUntilPayroll,
} from '@/lib/dashboard-queries';
import { getCompanyCashSummary } from '@/lib/cash-queries';
import { getUserProfile } from '@/lib/auth';
import { shortINR } from '@repo/ui/formatters';
import { KpiCard } from '@/components/kpi-card';

import { CashAlertTable } from './cash-alert-table';
import { PipelineSummary } from './pipeline-summary';
import { PendingApprovals } from './pending-approvals';
import { OverdueReports } from './overdue-reports';

export async function FounderDashboard() {
  const [cashProjects, pipeline, pendingApprovals, overdueReports, profile, cashSummary] = await Promise.all([
    getCashNegativeProjects(),
    getPipelineSummary(),
    getProposalsPendingApproval(),
    getProjectsWithNoReportToday(),
    getUserProfile(),
    getCompanyCashSummary(),
  ]);
  const payrollDays = daysUntilPayroll();
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Good morning, {firstName}</h1>
      {payrollDays >= 0 && payrollDays <= 5 && (
        <div className="rounded-md bg-[#FFFBEB] border border-[#FACB01] px-4 py-2 text-sm font-medium text-[#92400E]">
          Payroll export due in {payrollDays} day{payrollDays !== 1 ? 's' : ''}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Cash Invested"
          value={shortINR(parseFloat(cashSummary.totalInvestedCapital))}
          subNote={`${cashSummary.investedProjectCount} project${cashSummary.investedProjectCount !== 1 ? 's' : ''}`}
          icon="DollarSign"
        />
        <KpiCard
          label="Pipeline Value"
          value={shortINR(pipeline.totalValue)}
          subNote={`${pipeline.count} active proposal${pipeline.count !== 1 ? 's' : ''}`}
          icon="TrendingUp"
        />
        <KpiCard
          label="Active Projects"
          value={cashSummary.projectCount}
          subNote="With cash positions"
          icon="HardHat"
        />
        <KpiCard
          label="Overdue Reports"
          value={overdueReports.length}
          subNote="Missing today"
          icon="FileText"
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <CashAlertTable projects={cashProjects} />
          <OverdueReports projects={overdueReports} />
        </div>
        <div className="space-y-6">
          <PipelineSummary pipeline={pipeline} />
          <PendingApprovals proposals={pendingApprovals} />
        </div>
      </div>
    </div>
  );
}
