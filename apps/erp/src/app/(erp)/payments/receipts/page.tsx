import { getPayments } from '@/lib/payment-queries';
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
import { DollarSign } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

const TYPE_OPTIONS = [
  { value: 'advance', label: 'Advance' },
  { value: 'milestone', label: 'Milestone' },
];

interface PaymentsPageProps {
  searchParams: Promise<{
    type?: string;
    search?: string;
  }>;
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const params = await searchParams;
  const payments = await getPayments({
    type: params.type || undefined,
    search: params.search || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <FilterBar basePath="/payments/receipts" filterParams={['search', 'type']}>
            <FilterSelect paramName="type" className="w-44">
              <option value="">All Types</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search receipt/reference..."
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
                <TableHead>Receipt #</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<DollarSign className="h-12 w-12" />}
                      title="No payments found"
                      description="Payments will appear here once customers make payments against invoices."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((pmt) => (
                  <TableRow key={pmt.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      {pmt.receipt_number ?? '—'}
                    </TableCell>
                    <TableCell>
                      {pmt.projects ? (
                        <span className="text-sm">
                          <span className="font-mono text-xs text-muted-foreground">{pmt.projects.project_number}</span>
                          {' '}{pmt.projects.customer_name}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pmt.payment_date ? formatDate(pmt.payment_date) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {pmt.amount != null ? formatINR(pmt.amount) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={pmt.is_advance ? 'secondary' : 'outline'}>
                        {pmt.is_advance ? 'Advance' : 'Milestone'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {(pmt.payment_method ?? '—').replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {pmt.notes ?? '—'}
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
