import Link from 'next/link';
import { DollarSign } from 'lucide-react';
import { formatINR, shortINR } from '@repo/ui/formatters';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui';
import type { PaymentTrackerRow, PaymentTrackerSummary } from '@/lib/payments-tracker-queries';
import { filterPaymentTrackerRows } from '@/lib/payments-tracker-queries';
import { STATUS_LABEL } from '@/components/payments/payments-helpers';

interface Props {
  rows: PaymentTrackerRow[];
  allRows: PaymentTrackerRow[];
  summary: PaymentTrackerSummary;
  filter: string;
}

const FILTER_TABS = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'all', label: 'All' },
  { value: 'awaiting_invoice', label: 'Awaiting Invoice' },
  { value: 'sent_unpaid', label: 'Sent Unpaid' },
  { value: 'order_30d', label: '≥30 Days' },
  { value: 'order_60d', label: '≥60 Days' },
] as const;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export function PaymentsTrackerTable({ rows, allRows, summary, filter }: Props) {
  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Total Outstanding
            </div>
            <div className="text-xl font-bold font-mono text-red-600 mt-1">
              {shortINR(summary.total_outstanding)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Outstanding ≥30d
            </div>
            <div className="text-xl font-bold font-mono text-amber-600 mt-1">
              {shortINR(summary.outstanding_30d)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Outstanding ≥60d
            </div>
            <div className="text-xl font-bold font-mono text-red-600 mt-1">
              {shortINR(summary.outstanding_60d)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Avg Days Order → Receipt
            </div>
            <div className="text-xl font-bold font-mono text-n-900 mt-1">
              {summary.avg_days_to_last_receipt !== null
                ? `${summary.avg_days_to_last_receipt}d`
                : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_TABS.map((tab) => {
          const count = filterPaymentTrackerRows(allRows, tab.value).length;
          const isActive = filter === tab.value;
          return (
            <Link key={tab.value} href={`/payments/tracker?filter=${tab.value}`}>
              <Badge
                variant={isActive ? 'default' : 'outline'}
                className="cursor-pointer"
              >
                {tab.label} ({count})
              </Badge>
            </Link>
          );
        })}
      </div>

      {/* Main table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Project / Customer</TableHead>
                  <TableHead className="whitespace-nowrap">Order Date</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Completed</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Contract ₹</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Invoiced ₹</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Sent ₹</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Received ₹</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Remaining ₹</TableHead>
                  <TableHead className="whitespace-nowrap text-center">Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState
                        icon={<DollarSign className="h-12 w-12" />}
                        title="No projects match this filter"
                        description="Try a different filter above."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const daysBg =
                      row.days_since_order >= 60
                        ? 'bg-red-100 text-red-800'
                        : row.days_since_order >= 30
                          ? 'bg-amber-100 text-amber-800'
                          : 'text-n-500';

                    return (
                      <TableRow key={row.project_id}>
                        {/* Project / Customer */}
                        <TableCell>
                          <Link
                            href={`/projects/${row.project_id}`}
                            className="hover:text-shiroi-green"
                          >
                            <div className="text-xs font-mono text-n-500">
                              {row.project_number}
                            </div>
                            <div className="text-sm font-medium text-n-900 max-w-[180px] truncate">
                              {row.customer_name}
                            </div>
                          </Link>
                        </TableCell>

                        {/* Order Date */}
                        <TableCell>
                          <div className="text-sm text-n-900">
                            {formatDate(row.order_date)}
                          </div>
                          <div className="text-xs text-n-400">
                            ({row.order_date_source})
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {STATUS_LABEL[row.project_status] ??
                              row.project_status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>

                        {/* Completed */}
                        <TableCell className="text-sm text-n-600">
                          {formatDate(row.completed_date)}
                        </TableCell>

                        {/* Contract ₹ */}
                        <TableCell className="text-right font-mono text-sm">
                          {formatINR(row.contracted_value)}
                        </TableCell>

                        {/* Invoiced ₹ */}
                        <TableCell className="text-right font-mono text-sm text-n-700">
                          {row.total_invoiced > 0 ? formatINR(row.total_invoiced) : '—'}
                        </TableCell>

                        {/* Sent ₹ */}
                        <TableCell className="text-right font-mono text-sm text-n-700">
                          {row.total_invoice_sent > 0
                            ? formatINR(row.total_invoice_sent)
                            : '—'}
                        </TableCell>

                        {/* Received ₹ */}
                        <TableCell
                          className={`text-right font-mono text-sm font-medium ${
                            row.total_received > 0 ? 'text-shiroi-green' : 'text-n-400'
                          }`}
                        >
                          {row.total_received > 0 ? formatINR(row.total_received) : '—'}
                        </TableCell>

                        {/* Remaining ₹ */}
                        <TableCell
                          className={`text-right font-mono text-sm font-bold ${
                            row.remaining > 0 ? 'text-red-600' : 'text-n-400'
                          }`}
                        >
                          {row.remaining > 0 ? formatINR(row.remaining) : '—'}
                        </TableCell>

                        {/* Days since order */}
                        <TableCell className="text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${daysBg}`}
                          >
                            {row.days_since_order}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
