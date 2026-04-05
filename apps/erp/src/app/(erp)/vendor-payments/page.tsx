import { createClient } from '@repo/supabase/server';
import { formatDate, formatINR } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from '@repo/ui';
import { DollarSign } from 'lucide-react';

export default async function VendorPaymentsPage() {
  const op = '[VendorPaymentsPage]';
  const supabase = await createClient();

  const { data: payments, error } = await supabase
    .from('vendor_payments')
    .select(
      '*, vendors!vendor_payments_vendor_id_fkey(company_name), purchase_orders!vendor_payments_purchase_order_id_fkey(po_number)',
    )
    .order('payment_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
  }

  const rows = payments ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Vendor Payments</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>PO Number</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Reference #</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<DollarSign className="h-12 w-12" />}
                      title="No vendor payments found"
                      description="Vendor payments will appear here once recorded against purchase orders."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">
                      {payment.vendors?.company_name ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {payment.purchase_orders?.po_number ?? '—'}
                    </TableCell>
                    <TableCell>
                      {payment.payment_date ? formatDate(payment.payment_date) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {payment.amount != null ? formatINR(Number(payment.amount)) : '—'}
                    </TableCell>
                    <TableCell className="capitalize">
                      {payment.payment_method?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {payment.payment_reference ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {payment.notes ?? '—'}
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
