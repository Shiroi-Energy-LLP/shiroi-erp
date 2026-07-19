import Link from 'next/link';
import { KpiCard } from '@repo/ui';
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

export function PipelineSummary({
  stageCounts,
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

  const weekUrl = '/sales?closing=this_week';
  const monthUrl = '/sales?closing=this_month';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {/* 1 — Active Leads */}
      <KpiCard label="Active Leads" value={activeLeads} />

      {/* 2 — Weighted Pipeline */}
      <KpiCard label="Weighted Pipeline" value={shortINR(totalWeighted)} />

      {/* 3 — Closing This Week (clickable) */}
      <Link href={weekUrl} className="block">
        <KpiCard
          label="Closing This Week"
          value={closingThisWeek.leadCount}
          subNote={
            closingThisWeek.totalKwp > 0 || closingThisWeek.totalValue > 0
              ? `${closingThisWeek.totalKwp.toFixed(1)} kWp · ${shortINR(closingThisWeek.totalValue)}`
              : undefined
          }
        />
      </Link>

      {/* 4 — Closing This Month (clickable) */}
      <Link href={monthUrl} className="block">
        <KpiCard
          label="Closing This Month"
          value={closingThisMonth.leadCount}
          subNote={
            closingThisMonth.totalKwp > 0 || closingThisMonth.totalValue > 0
              ? `${closingThisMonth.totalKwp.toFixed(1)} kWp · ${shortINR(closingThisMonth.totalValue)}`
              : undefined
          }
        />
      </Link>

      {/* 5 — Won */}
      <KpiCard label="Won" value={wonCount} subNote={shortINR(wonValue)} />
    </div>
  );
}
