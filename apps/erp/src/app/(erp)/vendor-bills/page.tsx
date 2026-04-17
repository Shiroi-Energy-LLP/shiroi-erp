import Link from 'next/link';
import { getVendorBills, getVendorBillsSummary, type VendorBillStatus } from '@/lib/vendor-bills-queries';
import { formatDate, formatINR } from '@repo/ui/formatters';
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
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { FileText, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { FilterBar } from '@/components/filter-bar';
import { FilterSelect } from '@/components/filter-select';

const STATUS_OPTIONS: Array<{ value: VendorBillStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'draft', label: 'Draft' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusVariant(status: string): 'error' | 'pending' | 'success' | 'neutral' {
  if (status === 'paid') return 'success';
  if (status === 'partially_paid') return 'pending';
  if (status === 'pending') return 'error';
  return 'neutral';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function VendorBillsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const statusFilter = params.status as VendorBillStatus | undefined;

  const [bills, summary] = await Promise.all([
    getVendorBills({ status: statusFilter }),
    getVendorBillsSummary(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">FINANCE</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Vendor Bills</h1>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4" />
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#991B1B]">
              {formatINR(summary.totalPending)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{summary.pendingCount} open bills</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Total Paid (all time)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#065F46]">
              {formatINR(summary.totalPaid)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Zoho Import
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#1A1D24]">
              {bills.filter(b => b.source === 'zoho_import').length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">imported from Zoho Books</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-4">
          <FilterBar basePath="/vendor-bills" filterParams={['status']}>
            <FilterSelect paramName="status" className="w-44">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </FilterSelect>
          </FilterBar>
        </CardContent>
      </Card>

      {/* Bills table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Bill Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<FileText className="h-12 w-12" />}
                      title="No vendor bills found"
                      description="Vendor bills will appear here once recorded or imported."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                bills.map(bill => (
                  <TableRow key={bill.id}>
                    <TableCell className="font-mono text-sm">
                      <Link
                        href={`/vendor-bills/${bill.id}`}
                        className="text-[#00B050] hover:underline"
                      >
                        {bill.bill_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {bill.vendors?.company_name ?? '—'}
                        {bill.vendors?.is_msme && (
                          <Badge variant="pending" className="text-xs">MSME</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {bill.projects?.project_number
                        ? (
                          <Link href={`/projects/${bill.project_id}`} className="hover:underline">
                            {bill.projects.project_number}
                          </Link>
                        )
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {bill.bill_date ? formatDate(bill.bill_date) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {bill.due_date ? formatDate(bill.due_date) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINR(Number(bill.total_amount))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {bill.balance_due != null ? formatINR(Number(bill.balance_due)) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(bill.status)}>
                        {statusLabel(bill.status)}
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
