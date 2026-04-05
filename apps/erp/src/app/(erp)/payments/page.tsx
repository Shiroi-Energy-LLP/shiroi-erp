import Link from 'next/link';
import { getPayments } from '@/lib/payment-queries';
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
  EmptyState,
} from '@repo/ui';
import { DollarSign } from 'lucide-react';

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Payments</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="type" defaultValue={params.type ?? ''} className="w-44">
              <option value="">All Types</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search receipt/reference..."
              className="w-60"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {(params.type || params.search) && (
              <Link href="/payments">
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
