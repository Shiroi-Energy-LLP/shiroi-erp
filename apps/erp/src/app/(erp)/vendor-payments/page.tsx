import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
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
  Badge,
} from '@repo/ui';
import { DollarSign, AlertCircle } from 'lucide-react';

interface MsmeAgingRow {
  vendor_id: string;
  company_name: string;
  msme_category: string | null;
  days_outstanding: number;
  total_outstanding: number;
  bill_count: number;
}

export default async function VendorPaymentsPage() {
  const op = '[VendorPaymentsPage]';
  const supabase = await createClient();

  const [paymentsResult, msmeResult] = await Promise.all([
    supabase
      .from('vendor_payments')
      .select(
        'id, amount, payment_date, payment_method, payment_reference, notes, vendor_id, vendor_bill_id, purchase_order_id, vendors!vendor_payments_vendor_id_fkey(company_name, is_msme), vendor_bills!vendor_payments_vendor_bill_id_fkey(bill_number), purchase_orders!vendor_payments_purchase_order_id_fkey(po_number)'
      )
      .order('payment_date', { ascending: false })
      .limit(100),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('get_msme_aging_summary'),
  ]);

  if (paymentsResult.error) {
    console.error(`${op} payments query failed:`, { code: paymentsResult.error.code, message: paymentsResult.error.message });
  }
  if (msmeResult.error) {
    console.error(`${op} MSME aging RPC failed:`, { code: msmeResult.error.code, message: msmeResult.error.message });
  }

  const rows = paymentsResult.data ?? [];
  const msmeRows: MsmeAgingRow[] = msmeResult.data ?? [];
  const criticalMsme = msmeRows.filter((r: MsmeAgingRow) => r.days_outstanding >= 30);

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">FINANCE</Eyebrow>
        <h1 className="text-2xl font-bold text-[#1A1D24]">Vendor Payments</h1>
      </div>

      {/* MSME Aging Strip */}
      {criticalMsme.length > 0 && (
        <Card className="border-[#991B1B] bg-[#FEF2F2]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-[#991B1B]">
              <AlertCircle className="h-4 w-4" />
              MSME Bills Overdue ≥30 Days ({criticalMsme.length} vendors)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {criticalMsme.slice(0, 10).map((r: MsmeAgingRow) => (
                <Link key={r.vendor_id} href={`/vendors/${r.vendor_id}`}>
                  <div className="rounded border border-[#991B1B]/30 bg-white px-3 py-2 text-xs hover:bg-[#FEF2F2]">
                    <div className="font-semibold">{r.company_name}</div>
                    <div className="text-muted-foreground">
                      {r.days_outstanding}d · {formatINR(Number(r.total_outstanding))}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* MSME full aging table */}
      {msmeRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              MSME Aging Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Days Outstanding</TableHead>
                  <TableHead className="text-right">Total Outstanding</TableHead>
                  <TableHead className="text-right">Bills</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {msmeRows.slice(0, 20).map((r: MsmeAgingRow) => (
                  <TableRow key={r.vendor_id}>
                    <TableCell>
                      <Link href={`/vendors/${r.vendor_id}`} className="text-[#00B050] hover:underline font-medium">
                        {r.company_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.msme_category ? <Badge variant="pending">{r.msme_category}</Badge> : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={r.days_outstanding >= 45 ? 'text-[#991B1B] font-bold' : r.days_outstanding >= 30 ? 'text-[#92400E]' : ''}>
                        {r.days_outstanding}d
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[#991B1B]">
                      {formatINR(Number(r.total_outstanding))}
                    </TableCell>
                    <TableCell className="text-right font-mono">{r.bill_count}</TableCell>
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
                        <Link href={`/vendor-bills/${payment.vendor_bill_id}`} className="text-[#00B050] hover:underline">
                          {payment.vendor_bills.bill_number}
                        </Link>
                      ) : payment.purchase_orders?.po_number ?? '—'}
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
