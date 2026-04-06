import { Card, CardContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';
import type { StageCounts } from '@/lib/leads-pipeline-queries';

interface PipelineSummaryProps {
  stageCounts: StageCounts[];
  closingThisWeekCount: number;
}

export function PipelineSummary({ stageCounts, closingThisWeekCount }: PipelineSummaryProps) {
  const activeLeads = stageCounts
    .filter(s => !['won', 'lost', 'disqualified'].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);

  const totalWeighted = stageCounts
    .filter(s => !['won', 'lost', 'disqualified'].includes(s.status))
    .reduce((sum, s) => sum + s.weighted_value, 0);

  const wonCount = stageCounts.find(s => s.status === 'won')?.count ?? 0;
  const wonValue = stageCounts.find(s => s.status === 'won')?.total_value ?? 0;

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Active Leads</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{activeLeads}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Weighted Pipeline</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{shortINR(totalWeighted)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Closing This Week</div>
          <div className="text-2xl font-bold text-n-900 mt-1">{closingThisWeekCount}</div>
        </CardContent>
      </Card>
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
