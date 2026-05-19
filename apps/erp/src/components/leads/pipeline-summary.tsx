import Link from 'next/link';
import { Card, CardContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import type { StageCounts } from '@/lib/leads-pipeline-queries';
import type { PipelineCloseWindow } from '@/lib/leads-pipeline-queries';

interface PipelineSummaryProps {
  stageCounts: StageCounts[];
  closingThisWeekCount: number;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  closingThisWeek: PipelineCloseWindow;
  closingThisMonth: PipelineCloseWindow;
}

/** Statuses shown in the "Closing" filtered view — active non-terminal stages */
const CLOSING_STATUSES = 'quick_quote_sent,detailed_proposal_sent,design_confirmed,negotiation,closure_soon';

export function PipelineSummary({
  stageCounts,
  weekStart,
  weekEnd,
  monthStart,
  monthEnd,
  closingThisWeek,
  closingThisMonth,
}: PipelineSummaryProps) {
  const activeLeads = stageCounts
    .filter((s) => !['won', 'lost', 'disqualified'].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);

  const totalWeighted = stageCounts
    .filter((s) => !['won', 'lost', 'disqualified'].includes(s.status))
    .reduce((sum, s) => sum + s.weighted_value, 0);

  const wonCount = stageCounts.find((s) => s.status === 'won')?.count ?? 0;
  const wonValue = stageCounts.find((s) => s.status === 'won')?.total_value ?? 0;

  const weekUrl = `/sales?closeFrom=${weekStart}&closeTo=${weekEnd}&status=${CLOSING_STATUSES}`;
  const monthUrl = `/sales?closeFrom=${monthStart}&closeTo=${monthEnd}&status=${CLOSING_STATUSES}`;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {/* 1 — Active Leads */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Active Leads</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{activeLeads}</div>
        </CardContent>
      </Card>

      {/* 2 — Weighted Pipeline */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Weighted Pipeline</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{shortINR(totalWeighted)}</div>
        </CardContent>
      </Card>

      {/* 3 — Closing This Week (clickable) */}
      <Link href={weekUrl} className="block">
        <Card className="h-full hover:shadow-md transition-shadow cursor-pointer border-transparent hover:border-shiroi-green/40">
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Closing This Week
            </div>
            <div className="text-2xl font-bold text-n-900 mt-1">{closingThisWeek.leadCount}</div>
            {(closingThisWeek.totalKwp > 0 || closingThisWeek.totalValue > 0) && (
              <div className="text-xs text-n-500 mt-0.5 space-x-2">
                <span>{closingThisWeek.totalKwp.toFixed(1)} kWp</span>
                <span>·</span>
                <span>{shortINR(closingThisWeek.totalValue)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </Link>

      {/* 4 — Closing This Month (clickable) */}
      <Link href={monthUrl} className="block">
        <Card className="h-full hover:shadow-md transition-shadow cursor-pointer border-transparent hover:border-shiroi-green/40">
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Closing This Month
            </div>
            <div className="text-2xl font-bold text-n-900 mt-1">{closingThisMonth.leadCount}</div>
            {(closingThisMonth.totalKwp > 0 || closingThisMonth.totalValue > 0) && (
              <div className="text-xs text-n-500 mt-0.5 space-x-2">
                <span>{closingThisMonth.totalKwp.toFixed(1)} kWp</span>
                <span>·</span>
                <span>{shortINR(closingThisMonth.totalValue)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </Link>

      {/* 5 — Won */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Won</div>
          <div className="text-2xl font-bold text-shiroi-green mt-1">{wonCount}</div>
          <div className="text-xs text-n-500">{shortINR(wonValue)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
