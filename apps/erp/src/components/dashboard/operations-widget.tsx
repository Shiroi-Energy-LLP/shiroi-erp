import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface OperationsWidgetProps {
  openTasks: number;
  totalTasks: number;
  openTickets: number;
  totalTickets: number;
  amcCompleted: number;
  amcScheduled: number;
}

function ProgressRow({ label, current, total }: { label: string; current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[#3F424D]">{label}</span>
        <span className="text-[12px] font-mono font-bold text-[#111318]">
          {current} / {total}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#00B050] transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function OperationsWidget({
  openTasks,
  totalTasks,
  openTickets,
  totalTickets,
  amcCompleted,
  amcScheduled,
}: OperationsWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Operations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProgressRow label="Open Tasks" current={openTasks} total={totalTasks} />
        <ProgressRow label="Open Services" current={openTickets} total={totalTickets} />
        <ProgressRow label="AMCs This Month" current={amcCompleted} total={amcScheduled} />
      </CardContent>
    </Card>
  );
}
