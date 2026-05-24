import { getProjectInvoices } from '@/lib/invoice-queries';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
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
import { FileText } from 'lucide-react';
import { RaiseInvoiceDialog } from './raise-invoice-dialog';
import { RecordProjectPaymentDialog } from './record-project-payment-dialog';

interface ProjectInvoicesPanelProps {
  projectId: string;
}

const STATUS_VARIANT: Record<string, 'outline' | 'warning' | 'success' | 'error' | 'secondary'> = {
  draft: 'outline',
  sent: 'secondary',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'error',
  cancelled: 'outline',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export async function ProjectInvoicesPanel({ projectId }: ProjectInvoicesPanelProps) {
  const invoices = await getProjectInvoices(projectId);

  const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid), 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + Number(inv.amount_outstanding), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Invoices</CardTitle>
          <RaiseInvoiceDialog projectId={projectId} />
        </div>

        {/* KPI strip — only show if there are invoices */}
        {invoices.length > 0 && (
          <div className="flex gap-6 mt-3 pt-3 border-t border-n-100">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-n-500">Invoiced</div>
              <div className="text-sm font-mono font-semibold text-n-900">{formatINR(totalInvoiced)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-n-500">Received</div>
              <div className="text-sm font-mono font-semibold text-shiroi-green">{formatINR(totalPaid)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-n-500">Outstanding</div>
              <div className={`text-sm font-mono font-semibold ${totalOutstanding > 0 ? 'text-red-600' : 'text-n-500'}`}>
                {formatINR(totalOutstanding)}
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Milestone</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    icon={<FileText className="h-10 w-10" />}
                    title="No invoices yet"
                    description="Use Raise Invoice to create the first invoice for this project."
                  />
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => {
                const outstanding = Number(inv.amount_outstanding);
                const canRecord = outstanding > 0 && inv.status !== 'cancelled';
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      {inv.invoice_number}
                    </TableCell>
                    <TableCell className="text-sm text-n-600">
                      {inv.milestone_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.invoice_date ? formatDate(inv.invoice_date) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.due_date ? formatDate(inv.due_date) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINR(Number(inv.total_amount))}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${outstanding > 0 ? 'text-red-600 font-medium' : 'text-n-400'}`}>
                      {outstanding > 0 ? formatINR(outstanding) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[inv.status ?? 'draft'] ?? 'outline'}>
                        {STATUS_LABEL[inv.status ?? 'draft'] ?? inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {canRecord && (
                        <RecordProjectPaymentDialog
                          projectId={projectId}
                          invoiceId={inv.id}
                          invoiceNumber={inv.invoice_number}
                          outstandingAmount={outstanding}
                          trigger={
                            <button className="text-xs text-shiroi-green hover:underline font-medium whitespace-nowrap">
                              Record payment
                            </button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
