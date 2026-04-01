import Link from 'next/link';
import {
  getCompanyCashSummary,
  getAllProjectPositions,
  getOverdueInvoices,
  calcDaysOverdue,
  getEscalationLevel,
  getEscalationLabel,
  getEscalationVariant,
  cashPositionColor,
} from '@/lib/cash-queries';
import { formatINR, shortINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

export default async function CashFlowPage() {
  const [summary, positions, overdueInvoices] = await Promise.all([
    getCompanyCashSummary(),
    getAllProjectPositions(),
    getOverdueInvoices(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Cash Flow</h1>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total Invested Capital</p>
            <p className="text-2xl font-bold text-red-600">
              {shortINR(Number(summary.totalInvestedCapital))}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {summary.investedProjectCount} project{summary.investedProjectCount !== 1 ? 's' : ''} with negative cash
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total Receivables</p>
            <p className="text-2xl font-bold text-amber-600">
              {shortINR(Number(summary.totalReceivables))}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Outstanding across {summary.projectCount} project{summary.projectCount !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Active PO Value</p>
            <p className="text-2xl font-bold text-[#1A1D24]">
              {shortINR(Number(summary.activePOValue))}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Total purchase order commitments
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Project Positions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Project Cash Positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No project cash positions found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Net Position</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Days Invested</TableHead>
                  <TableHead>Alerts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((pos) => {
                  const project = pos.projects;
                  return (
                    <TableRow key={pos.id}>
                      <TableCell>
                        <Link
                          href={`/cash/${pos.project_id}`}
                          className="text-[#00B050] hover:underline font-medium"
                        >
                          {project?.project_number ?? '—'}
                        </Link>
                      </TableCell>
                      <TableCell>{project?.customer_name ?? '—'}</TableCell>
                      <TableCell className={`text-right font-medium ${cashPositionColor(pos.net_cash_position)}`}>
                        {formatINR(pos.net_cash_position)}
                      </TableCell>
                      <TableCell className="text-right">{formatINR(pos.total_invoiced)}</TableCell>
                      <TableCell className="text-right">{formatINR(pos.total_received)}</TableCell>
                      <TableCell className="text-right">{formatINR(pos.total_outstanding)}</TableCell>
                      <TableCell className="text-right">
                        {pos.is_invested ? pos.days_invested : '—'}
                      </TableCell>
                      <TableCell>
                        {pos.uninvoiced_milestone_alert && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            Uninvoiced
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Overdue Invoices Section */}
      <Card>
        <CardHeader>
          <CardTitle>
            Overdue Invoices
            {overdueInvoices.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {overdueInvoices.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {overdueInvoices.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No overdue invoices. All clear.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Days Overdue</TableHead>
                  <TableHead>Escalation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueInvoices.map((inv) => {
                  const daysOverdue = calcDaysOverdue(inv.due_date);
                  const level = getEscalationLevel(daysOverdue);
                  const project = inv.projects;
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                      <TableCell>
                        <Link
                          href={`/cash/${inv.project_id}`}
                          className="text-[#00B050] hover:underline"
                        >
                          {project?.project_number ?? '—'}
                        </Link>
                      </TableCell>
                      <TableCell>{project?.customer_name ?? '—'}</TableCell>
                      <TableCell>{inv.milestone_name ?? '—'}</TableCell>
                      <TableCell className="text-right">{formatINR(inv.total_amount)}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">
                        {formatINR(inv.amount_outstanding)}
                      </TableCell>
                      <TableCell>{formatDate(inv.due_date)}</TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        {daysOverdue}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getEscalationVariant(level)}>
                          {getEscalationLabel(level)}
                        </Badge>
                        {inv.legal_flagged && (
                          <Badge variant="destructive" className="ml-1">
                            Legal
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
