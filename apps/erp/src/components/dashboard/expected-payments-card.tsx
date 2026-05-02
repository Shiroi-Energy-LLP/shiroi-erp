import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { shortINR, formatDate } from '@repo/ui/formatters';
import type { ExpectedPaymentRow } from '@/lib/dashboard-expected-queries';

interface Props {
  weekRows: ExpectedPaymentRow[];
  monthOnlyRows: ExpectedPaymentRow[];
}

function rowKey(row: ExpectedPaymentRow): string {
  return `${row.project_id}::${row.milestone_order}`;
}

function daysChipClass(daysUntil: number): string {
  if (daysUntil <= 7) return 'bg-amber-100 text-amber-800';
  if (daysUntil <= 30) return 'bg-blue-100 text-blue-800';
  return 'bg-n-100 text-n-700';
}

export function ExpectedPaymentsCard({ weekRows, monthOnlyRows }: Props) {
  const total = weekRows.length + monthOnlyRows.length;
  const totalAmount = [...weekRows, ...monthOnlyRows].reduce((s, r) => s + r.amount, 0);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Expected Payments</CardTitle>
          {totalAmount > 0 && (
            <div className="text-xs text-n-500 mt-0.5 font-mono">{shortINR(totalAmount)} expected</div>
          )}
        </div>
        <Badge variant={weekRows.length > 0 ? 'warning' : 'neutral'}>{total}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <Section title="This Week" rows={weekRows} emptyText="No payments expected this week" />
        <Section title="Later This Month" rows={monthOnlyRows} emptyText="No further payments expected this month" />
        <Link href="/payments/tracker" className="block text-xs text-p-600 hover:underline pt-1">
          View payment tracker →
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
  rows: ExpectedPaymentRow[];
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
              key={rowKey(row)}
              className="flex items-start justify-between gap-2 text-xs border-b border-n-100 pb-1.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/projects/${row.project_id}`}
                  className="font-medium text-n-900 hover:text-p-600 truncate block"
                >
                  {row.customer_name}
                </Link>
                <div className="text-[10px] text-n-500 flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono">{row.project_number}</span>
                  <span>·</span>
                  <span>{row.milestone_name}</span>
                </div>
              </div>
              <div className="text-right whitespace-nowrap">
                <div className="font-mono font-medium text-n-900">{shortINR(row.amount)}</div>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  <span className="text-[10px] text-n-500">{formatDate(row.expected_payment_date)}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${daysChipClass(row.days_until)}`}>
                    {row.days_until === 0 ? 'today' : `${row.days_until}d`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
