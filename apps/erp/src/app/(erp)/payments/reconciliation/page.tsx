import Link from 'next/link';
import {
  getReceivablesReconciliation,
  computeReconciliationKpis,
} from '@/lib/receivables-reconciliation-queries';
import { formatINR, shortINR, formatDate } from '@repo/ui/formatters';
import { STATUS_LABELS as STATUS_LABEL } from '@/lib/project-status-helpers';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from '@repo/ui';
import { AlertCircle, CheckCircle2, FileText } from 'lucide-react';

function outstandingColor(outstanding: number, daysOverdue: number): string {
  if (outstanding === 0) return 'text-n-400';
  if (daysOverdue >= 60) return 'text-red-600 font-semibold';
  if (daysOverdue > 0) return 'text-amber-600 font-semibold';
  return 'text-n-900 font-medium';
}

export default async function ReconciliationPage() {
  const today = new Date();
  const rows = await getReceivablesReconciliation();
  const kpis = computeReconciliationKpis(rows, today);

  return (
    <div className="space-y-6">

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Total Outstanding</div>
            <div className={`text-xl font-bold font-mono mt-1 ${kpis.total_outstanding > 0 ? 'text-red-600' : 'text-shiroi-green'}`}>
              {shortINR(kpis.total_outstanding)}
            </div>
            <div className="text-xs text-n-400 mt-0.5">across {rows.filter((r) => r.outstanding > 0).length} projects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Overdue 60d+</div>
            <div className={`text-xl font-bold font-mono mt-1 ${kpis.overdue_60d > 0 ? 'text-red-700' : 'text-n-400'}`}>
              {kpis.overdue_60d > 0 ? shortINR(kpis.overdue_60d) : '—'}
            </div>
            <div className="text-xs text-n-400 mt-0.5">no payment in 60+ days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Projects Without Invoice</div>
            <div className={`text-xl font-bold font-mono mt-1 ${kpis.projects_no_invoice > 0 ? 'text-amber-600' : 'text-n-400'}`}>
              {kpis.projects_no_invoice > 0 ? kpis.projects_no_invoice : '—'}
            </div>
            <div className="text-xs text-n-400 mt-0.5">active projects with no invoice raised</div>
          </CardContent>
        </Card>
      </div>

      {/* Reconciliation table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Project</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Total Invoiced</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Total Paid</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Outstanding</TableHead>
                  <TableHead className="whitespace-nowrap text-center">Invoices</TableHead>
                  <TableHead className="whitespace-nowrap text-center">Overdue</TableHead>
                  <TableHead className="whitespace-nowrap">Last Payment</TableHead>
                  <TableHead className="whitespace-nowrap w-36">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <EmptyState
                        icon={<FileText className="h-12 w-12" />}
                        title="No data yet"
                        description="Projects with invoices or active status will appear here."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const lastPaidDate = row.last_payment_date ? new Date(row.last_payment_date) : null;
                    const daysOverdue = row.outstanding > 0
                      ? (lastPaidDate
                          ? Math.floor((today.getTime() - lastPaidDate.getTime()) / 86_400_000)
                          : 999)
                      : 0;
                    const outstandingCls = outstandingColor(row.outstanding, daysOverdue);

                    return (
                      <TableRow key={row.project_id}>
                        <TableCell>
                          <Link href={`/projects/${row.project_id}`} className="hover:text-shiroi-gold-dark">
                            <div className="text-xs font-mono text-n-500">{row.project_number}</div>
                            <div className="text-sm font-medium text-n-900 max-w-[180px] truncate">
                              {row.customer_name}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs whitespace-nowrap">
                            {STATUS_LABEL[row.project_status] ?? row.project_status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {row.total_invoiced > 0 ? formatINR(row.total_invoiced) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-shiroi-green">
                          {row.total_paid > 0 ? formatINR(row.total_paid) : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${outstandingCls}`}>
                          {row.outstanding > 0 ? formatINR(row.outstanding) : (
                            <span className="flex justify-end">
                              <CheckCircle2 className="h-4 w-4 text-shiroi-green" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {row.invoice_count > 0 ? (
                            <span className="font-mono">{row.invoice_count}</span>
                          ) : (
                            <span className="text-amber-500 text-xs">None</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.overdue_count > 0 ? (
                            <span className="flex justify-center">
                              <AlertCircle className="h-4 w-4 text-red-500" />
                              <span className="ml-1 text-red-600 text-sm font-medium">{row.overdue_count}</span>
                            </span>
                          ) : (
                            <span className="text-n-300 text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-n-600">
                          {row.last_payment_date ? formatDate(row.last_payment_date) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/projects/${row.project_id}?tab=finance`}
                              className="text-xs text-shiroi-gold-dark hover:underline whitespace-nowrap"
                            >
                              {row.invoice_count === 0 ? 'Raise Invoice' : 'View'}
                            </Link>
                          </div>
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
