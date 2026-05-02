import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { shortINR, formatDate } from '@repo/ui/formatters';
import type { ExpectedOrderRow } from '@/lib/dashboard-expected-queries';

interface Props {
  weekRows: ExpectedOrderRow[];
  monthOnlyRows: ExpectedOrderRow[];
}

export function ExpectedOrdersCard({ weekRows, monthOnlyRows }: Props) {
  const total = weekRows.length + monthOnlyRows.length;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Expected Orders</CardTitle>
        <Badge variant={weekRows.length > 0 ? 'warning' : 'neutral'}>{total}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <Section title="This Week" rows={weekRows} emptyText="No orders expected this week" />
        <Section title="Later This Month" rows={monthOnlyRows} emptyText="No further orders expected this month" />
        <Link href="/sales" className="block text-xs text-p-600 hover:underline pt-1">
          View all in sales →
        </Link>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: ExpectedOrderRow[];
  emptyText: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-n-500 uppercase tracking-wider mb-1.5">
        {title} <span className="text-n-400">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-n-400 italic">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div
              key={row.lead_id}
              className="flex items-start justify-between gap-2 text-xs border-b border-n-100 pb-1.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/sales/${row.lead_id}`}
                  className="font-medium text-n-900 hover:text-p-600 truncate block"
                >
                  {row.customer_name}
                </Link>
                <div className="text-[10px] text-n-500 flex items-center gap-1.5 flex-wrap">
                  {row.estimated_size_kwp !== null && <span>{row.estimated_size_kwp} kWp</span>}
                  {row.close_probability !== null && (
                    <span className="text-amber-700">{row.close_probability}%</span>
                  )}
                </div>
              </div>
              <div className="text-right whitespace-nowrap">
                <div className="font-mono font-medium text-n-900">{shortINR(row.derived_value)}</div>
                <div className="text-[10px] text-n-500">{formatDate(row.expected_close_date)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
