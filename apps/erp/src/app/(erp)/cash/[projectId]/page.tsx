import Link from 'next/link';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  getProjectCashDetail,
  calcDaysOverdue,
  getEscalationLevel,
  getEscalationLabel,
  getEscalationVariant,
  cashPositionColor,
} from '@/lib/cash-queries';
import { formatINR, formatDate } from '@repo/ui/formatters';
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
  Button,
  EmptyState,
  Breadcrumb,
} from '@repo/ui';
import { FileText, DollarSign } from 'lucide-react';

interface ProjectCashPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectCashPage({ params }: ProjectCashPageProps) {
  const { projectId } = await params;
  const detail = await getProjectCashDetail(projectId);

  if (!detail) {
    notFound();
  }

  const { cashPosition, invoices, vendorPayments } = detail;
  const project = cashPosition.projects;

  // Compute net position breakdown using decimal.js
  const totalReceived = new Decimal(cashPosition.total_received);
  const totalPaid = new Decimal(cashPosition.total_paid_to_vendors);
  const netPosition = totalReceived.minus(totalPaid);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Cash Flow', href: '/cash' },
          { label: project?.project_number ?? 'Project' },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1D24]">
            {project?.project_number ?? 'Project'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {project?.customer_name ?? '—'} &middot;{' '}
            {project?.system_size_kwp ? `${project.system_size_kwp} kWp` : '—'} &middot;{' '}
            {project?.system_type ?? '—'}
          </p>
        </div>
        <Link href={`/projects/${projectId}`}>
          <Button variant="outline">View Project</Button>
        </Link>
      </div>

      {/* Cash Position Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Net Cash Position</p>
            <p className={`text-2xl font-bold ${cashPositionColor(cashPosition.net_cash_position)}`}>
              {formatINR(cashPosition.net_cash_position)}
            </p>
            {cashPosition.is_invested && (
              <p className="text-xs text-red-500 mt-1">
                Invested for {cashPosition.days_invested} day{cashPosition.days_invested !== 1 ? 's' : ''}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Contracted Value</p>
            <p className="text-2xl font-bold text-[#1A1D24]">
              {formatINR(cashPosition.total_contracted)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total Received</p>
            <p className="text-2xl font-bold text-green-700">
              {formatINR(cashPosition.total_received)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Outstanding: {formatINR(cashPosition.total_outstanding)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Paid to Vendors</p>
            <p className="text-2xl font-bold text-amber-600">
              {formatINR(cashPosition.total_paid_to_vendors)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              PO Value: {formatINR(cashPosition.total_po_value)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Net Position Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Net Position Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm max-w-md">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Received from Customer</span>
              <span className="font-medium text-green-700">{formatINR(cashPosition.total_received)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Less: Paid to Vendors</span>
              <span className="font-medium text-red-600">({formatINR(cashPosition.total_paid_to_vendors)})</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Net Cash Position</span>
              <span className={cashPositionColor(cashPosition.net_cash_position)}>
                {formatINR(Number(netPosition.toFixed(2)))}
              </span>
            </div>
            {cashPosition.uninvoiced_milestone_alert && (
              <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-amber-700 text-xs">
                Uninvoiced milestone detected
                {cashPosition.uninvoiced_since ? ` since ${formatDate(cashPosition.uninvoiced_since)}` : ''}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices ({invoices.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title="No invoices"
              description="No invoices have been raised for this project yet."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Days Overdue</TableHead>
                  <TableHead>Escalation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const daysOverdue = inv.status !== 'paid' ? calcDaysOverdue(inv.due_date) : 0;
                  const level = getEscalationLevel(Math.max(0, daysOverdue));
                  const isOverdue = daysOverdue > 0 && inv.status !== 'paid';
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                      <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                      <TableCell>{inv.milestone_name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{inv.invoice_type}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatINR(inv.total_amount)}</TableCell>
                      <TableCell className="text-right">{formatINR(inv.amount_paid)}</TableCell>
                      <TableCell className={`text-right ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                        {formatINR(inv.amount_outstanding)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={inv.status === 'paid' ? 'default' : isOverdue ? 'destructive' : 'secondary'}
                        >
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isOverdue ? (
                          <span className="text-red-600 font-medium">{daysOverdue}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {isOverdue ? (
                          <>
                            <Badge variant={getEscalationVariant(level)}>
                              {getEscalationLabel(level)}
                            </Badge>
                            {inv.legal_flagged && (
                              <Badge variant="destructive" className="ml-1">
                                Legal
                              </Badge>
                            )}
                          </>
                        ) : (
                          '—'
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

      {/* Vendor Payments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor Payments ({vendorPayments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {vendorPayments.length === 0 ? (
            <EmptyState
              icon={<DollarSign className="h-12 w-12" />}
              title="No vendor payments"
              description="No vendor payments have been recorded for this project yet."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Payment Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Days from PO</TableHead>
                  <TableHead>MSME</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorPayments.map((vp) => (
                  <TableRow key={vp.id}>
                    <TableCell className="font-medium">
                      {vp.purchase_orders?.po_number ?? '—'}
                    </TableCell>
                    <TableCell>{vp.vendors?.company_name ?? '—'}</TableCell>
                    <TableCell className="text-right">{formatINR(vp.amount)}</TableCell>
                    <TableCell>{formatDate(vp.payment_date)}</TableCell>
                    <TableCell>{vp.payment_method}</TableCell>
                    <TableCell className="text-gray-500">{vp.payment_reference ?? '—'}</TableCell>
                    <TableCell className="text-right">{vp.days_from_po}</TableCell>
                    <TableCell>
                      {vp.msme_compliant ? (
                        <Badge variant="default">Compliant</Badge>
                      ) : (
                        <Badge variant="destructive">Non-compliant</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
