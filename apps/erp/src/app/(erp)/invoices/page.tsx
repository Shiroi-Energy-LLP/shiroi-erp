import { getInvoices } from '@/lib/invoice-queries';
import { getProjectsList } from '@/lib/procurement-queries';
import { formatINR, formatDate } from '@repo/ui/formatters';
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
  Eyebrow,
} from '@repo/ui';
import { FileText } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { CreateInvoiceDialog } from '@/components/finance/create-invoice-dialog';

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
  const [invoices, projects] = await Promise.all([
    getInvoices({ status: params.status || undefined, search: params.search || undefined }),
    getProjectsList(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">INVOICES</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Invoices</h1>
        </div>
        <CreateInvoiceDialog projects={projects} />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <FilterBar basePath="/invoices" filterParams={['search', 'status']}>
            <FilterSelect paramName="status" className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search invoice number..."
              className="w-60 h-9 text-sm"
            />
          </FilterBar>
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
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<FileText className="h-12 w-12" />}
                      title="No invoices found"
                      description="Invoices will appear here once generated for projects."
                    />
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
