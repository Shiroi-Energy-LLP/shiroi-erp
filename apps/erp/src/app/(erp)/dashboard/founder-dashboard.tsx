import {
  getCashNegativeProjects,
  getProposalsPendingApproval,
  daysUntilPayroll,
} from '@/lib/dashboard-queries';
import {
  getCachedPipelineSummary,
  getCachedCompanyCashSummary,
  getCachedAmcMonthlySummary,
  getCachedProjectsWithoutTodayReport,
} from '@/lib/cached-dashboard-queries';
import { getUserProfile } from '@/lib/auth';
import { shortINR } from '@repo/ui/formatters';
import { Eyebrow } from '@repo/ui';
import { KpiCard } from '@/components/kpi-card';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import Link from 'next/link';

import { CashAlertTable } from './cash-alert-table';
import { PipelineSummary } from './pipeline-summary';
import { PendingApprovals } from './pending-approvals';
import { OverdueReports } from './overdue-reports';

export async function FounderDashboard() {
  // All five "company aggregate" queries below are cached via
  // unstable_cache (see cached-dashboard-queries.ts) and served from
  // Next.js's data cache within the TTL window. User-specific queries
  // (cashProjects, pendingApprovals, profile) still run per request.
  const [
    cashProjects,
    pipeline,
    pendingApprovals,
    overdueReports,
    profile,
    cashSummary,
    amcSummary,
  ] = await Promise.all([
    getCashNegativeProjects(),
    getCachedPipelineSummary(),
    getProposalsPendingApproval(),
    getCachedProjectsWithoutTodayReport(),
    getUserProfile(),
    getCachedCompanyCashSummary(),
    getCachedAmcMonthlySummary(),
  ]);
  const payrollDays = daysUntilPayroll();
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <Eyebrow className="mb-1">DASHBOARD</Eyebrow>
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
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">AMC This Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#1A1D24]">{amcSummary.completed}</span>
                <span className="text-sm text-n-500">/ {amcSummary.scheduled} visits</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                <div
                  className="h-full rounded-full bg-shiroi-green transition-all duration-300"
                  style={{ width: `${amcSummary.scheduled > 0 ? Math.round((amcSummary.completed / amcSummary.scheduled) * 100) : 0}%` }}
                />
              </div>
              <Link href="/om/amc" className="mt-3 block text-xs text-p-600 hover:underline">
                View AMC Schedule →
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
