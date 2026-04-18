import Link from 'next/link';
import { formatDate, formatINR } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { DollarSign, AlertCircle } from 'lucide-react';
import {
  getRecentVendorPayments,
  getMsmeAgingSummary,
  type MsmeAgingBucket,
} from '@/lib/vendor-payments-queries';

const BUCKET_ORDER: Record<string, number> = {
  '0-30': 0,
  '31-40': 1,
  '41-45': 2,
  overdue: 3,
};

function bucketLabel(bucket: string): string {
  switch (bucket) {
    case '0-30':
      return '0–30 days';
    case '31-40':
      return '31–40 days';
    case '41-45':
      return '41–45 days';
    case 'overdue':
      return 'Overdue (>45 days)';
    default:
      return bucket;
  }
}

function bucketTone(bucket: string): string {
  switch (bucket) {
    case 'overdue':
      return 'text-[#991B1B] font-bold';
    case '41-45':
      return 'text-[#92400E] font-semibold';
    case '31-40':
      return 'text-[#92400E]';
    default:
      return '';
  }
}

export default async function VendorPaymentsPage() {
  const [rows, msmeBuckets] = await Promise.all([
    getRecentVendorPayments(),
    getMsmeAgingSummary(),
  ]);

  const sortedBuckets: MsmeAgingBucket[] = [...msmeBuckets].sort(
    (a, b) => (BUCKET_ORDER[a.bucket] ?? 99) - (BUCKET_ORDER[b.bucket] ?? 99)
  );
  const overdueBucket = sortedBuckets.find((b) => b.bucket === 'overdue');

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">FINANCE</Eyebrow>
        <h1 className="text-2xl font-bold text-[#1A1D24]">Vendor Payments</h1>
      </div>

      {/* MSME overdue alert strip */}
      {overdueBucket && overdueBucket.bill_count > 0 && (
        <Card className="border-[#991B1B] bg-[#FEF2F2]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-[#991B1B]">
              <AlertCircle className="h-4 w-4" />
              MSME Bills Overdue ({'>'}45 days) — {overdueBucket.bill_count} bill
              {overdueBucket.bill_count !== 1 ? 's' : ''} · {formatINR(overdueBucket.total_amount)}
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* MSME aging summary by bucket */}
      {sortedBuckets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">MSME Aging Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Bills</TableHead>
                  <TableHead className="text-right">Total Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedBuckets.map((b) => (
                  <TableRow key={b.bucket}>
                    <TableCell className={bucketTone(b.bucket)}>{bucketLabel(b.bucket)}</TableCell>
                    <TableCell className="text-right font-mono">{b.bill_count}</TableCell>
                    <TableCell className={`text-right font-mono ${bucketTone(b.bucket)}`}>
                      {formatINR(b.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payments table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Payments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Bill / PO</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Reference #</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      icon={<DollarSign className="h-12 w-12" />}
                      title="No vendor payments found"
                      description="Vendor payments will appear here once recorded against bills or purchase orders."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">
                      <Link href={`/vendors/${payment.vendor_id}`} className="hover:underline">
                        {payment.vendors?.company_name ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {payment.vendor_bill_id && payment.vendor_bills ? (
                        <Link
                          href={`/vendor-bills/${payment.vendor_bill_id}`}
                          className="text-[#00B050] hover:underline"
                        >
                          {payment.vendor_bills.bill_number}
                        </Link>
                      ) : (
                        payment.purchase_orders?.po_number ?? '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {payment.payment_date ? formatDate(payment.payment_date) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {payment.amount != null ? formatINR(Number(payment.amount)) : '—'}
                    </TableCell>
                    <TableCell className="capitalize text-sm">
                      {payment.payment_method?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {payment.payment_reference ?? '—'}
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
