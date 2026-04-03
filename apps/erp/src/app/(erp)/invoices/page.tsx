import Link from 'next/link';
import { getInvoices } from '@/lib/invoice-queries';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

const STATUS_OPTIONS = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'fully_paid', label: 'Fully Paid' },
  { value: 'overdue', label: 'Overdue' },
];

const STATUS_VARIANT: Record<string, 'outline' | 'warning' | 'success' | 'error'> = {
  unpaid: 'outline',
  partially_paid: 'warning',
  fully_paid: 'success',
  overdue: 'error',
};

interface InvoicesPageProps {
  searchParams: Promise<{
    status?: string;
    search?: string;
  }>;
}

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const params = await searchParams;
  const invoices = await getInvoices({
    status: params.status || undefined,
    search: params.search || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Invoices</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="status" defaultValue={params.status ?? ''} className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search invoice number..."
              className="w-60"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {(params.status || params.search) && (
              <Link href="/invoices">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice Number</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Invoice Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Supply</TableHead>
                <TableHead className="text-right">Works</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No invoices found.
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {inv.invoice_number}
                    </TableCell>
                    <TableCell>
                      {inv.projects ? (
                        <span className="text-sm">
                          <span className="font-mono text-xs text-muted-foreground">{inv.projects.project_number}</span>
                          {' '}{inv.projects.customer_name}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.invoice_date ? formatDate(inv.invoice_date) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.due_date ? formatDate(inv.due_date) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {inv.subtotal_supply != null ? formatINR(inv.subtotal_supply) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {inv.subtotal_works != null ? formatINR(inv.subtotal_works) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {inv.total_amount != null ? formatINR(inv.total_amount) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[inv.status ?? ''] ?? 'outline'}>
                        {(inv.status ?? 'unpaid').replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
