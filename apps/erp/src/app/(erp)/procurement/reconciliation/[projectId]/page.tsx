/**
 * /procurement/reconciliation/[projectId] — PO vs Vendor Bill vs Paid view.
 *
 * Shows every non-cancelled PO for the project with a billing summary:
 * - How much was ordered (PO total)
 * - How much has been billed (linked vendor bills total)
 * - How much has been paid
 * - Balance remaining
 * - Bill status: unbilled / pending / partial / paid
 *
 * Useful for Vinodh (finance/co-founder) to track procurement vs accounts payable.
 * Role access: founder, finance, project_manager, purchase_officer.
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Eyebrow,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { ArrowLeft, FileText } from 'lucide-react';
import { getPOBillReconciliation, getProjectBasicInfo } from '@/lib/material-requisition-queries';
import { getUserProfile } from '@/lib/auth';

const BILL_STATUS_CLASSES: Record<string, string> = {
  unbilled: 'bg-n-100 text-n-600 border-n-200',
  pending:  'bg-amber-100 text-amber-700 border-amber-200',
  partial:  'bg-blue-100 text-blue-700 border-blue-200',
  paid:     'bg-green-100 text-green-700 border-green-200',
};

const BILL_STATUS_LABELS: Record<string, string> = {
  unbilled: 'Unbilled',
  pending:  'Bill pending',
  partial:  'Partially paid',
  paid:     'Paid',
};

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function POReconciliationPage({ params }: PageProps) {
  const { projectId } = await params;

  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const role = profile.role;
  if (!['founder', 'finance', 'project_manager', 'purchase_officer'].includes(role)) {
    redirect('/dashboard');
  }

  // Load project info for header
  const project = await getProjectBasicInfo(projectId);
  if (!project) notFound();

  const rows = await getPOBillReconciliation(projectId);

  // Summary KPIs
  const totalPO = rows.reduce((s, r) => s + Number(r.po_total), 0);
  const totalBilled = rows.reduce((s, r) => s + Number(r.billed_amount), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paid_amount), 0);
  const totalUnbilled = totalPO - totalBilled;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/procurement/project/${projectId}?tab=po`}>
            <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs px-2 mb-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to POs
            </Button>
          </Link>
          <Eyebrow className="mb-0.5">PROCUREMENT — RECONCILIATION</Eyebrow>
          <h1 className="text-xl font-bold text-n-900">
            {project.project_number} — PO vs Bill Reconciliation
          </h1>
          <p className="text-xs text-n-500 mt-0.5">{project.customer_name}</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4 text-center">
            <div className="text-base font-bold font-mono text-n-900">{formatINR(totalPO)}</div>
            <div className="text-[10px] text-n-500 uppercase font-medium mt-0.5">Total PO Value</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-base font-bold font-mono text-amber-700">{formatINR(totalUnbilled)}</div>
            <div className="text-[10px] text-amber-600 uppercase font-medium mt-0.5">Unbilled</div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-base font-bold font-mono text-blue-700">{formatINR(totalBilled)}</div>
            <div className="text-[10px] text-blue-600 uppercase font-medium mt-0.5">Billed</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 px-4 text-center">
            <div className="text-base font-bold font-mono text-green-700">{formatINR(totalPaid)}</div>
            <div className="text-[10px] text-green-600 uppercase font-medium mt-0.5">Paid</div>
          </CardContent>
        </Card>
      </div>

      {/* Reconciliation table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">
            PO Reconciliation ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="h-8 w-8 text-n-300 mx-auto mb-2" />
              <p className="text-sm text-n-600">No POs found for this project.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">PO Total</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Bills</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const balanceClass = Number(row.balance) > 0 ? 'text-amber-700' : 'text-green-700';
                    return (
                      <TableRow key={row.po_id}>
                        <TableCell>
                          <Link
                            href={`/procurement/${row.po_id}`}
                            className="text-p-600 hover:underline font-medium"
                          >
                            {row.po_number}
                          </Link>
                          {row.vendor_is_msme && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 border-purple-300 text-purple-700"
                            >
                              MSME
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-n-700">{row.vendor_name}</TableCell>
                        <TableCell className="text-n-500">
                          {row.po_date ? formatDate(row.po_date) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINR(Number(row.po_total))}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-n-700">
                          {Number(row.billed_amount) > 0 ? formatINR(Number(row.billed_amount)) : <span className="text-n-400">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-green-700">
                          {Number(row.paid_amount) > 0 ? formatINR(Number(row.paid_amount)) : <span className="text-n-400">—</span>}
                        </TableCell>
                        <TableCell className={`text-right font-mono tabular-nums font-medium ${balanceClass}`}>
                          {formatINR(Number(row.balance))}
                        </TableCell>
                        <TableCell className="text-n-600 text-center">
                          {Number(row.bill_count) > 0 ? (
                            <Link
                              href={`/vendor-bills?po=${row.po_id}`}
                              className="text-p-600 hover:underline"
                            >
                              View {row.bill_count} bill{row.bill_count === 1 ? '' : 's'}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={BILL_STATUS_CLASSES[row.bill_status] ?? ''}
                          >
                            {BILL_STATUS_LABELS[row.bill_status] ?? row.bill_status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  {rows.length > 1 && (
                    <TableRow className="border-t-2 border-n-300 bg-n-50 font-semibold">
                      <TableCell colSpan={3} className="text-n-700">
                        Total ({rows.length} POs)
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-n-900">
                        {formatINR(totalPO)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-n-700">
                        {formatINR(totalBilled)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-green-700">
                        {formatINR(totalPaid)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-amber-700">
                        {formatINR(totalPO - totalPaid)}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
