import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
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
} from '@repo/ui';
import { Truck } from 'lucide-react';

export default async function DeliveriesPage() {
  const op = '[DeliveriesPage]';
  const supabase = await createClient();

  const { data: challans, error } = await supabase
    .from('vendor_delivery_challans')
    .select(
      '*, vendors!vendor_delivery_challans_vendor_id_fkey(company_name), purchase_orders!vendor_delivery_challans_purchase_order_id_fkey(po_number, project_id)',
    )
    .order('vendor_dc_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
  }

  const rows = challans ?? [];

  function statusVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (status) {
      case 'received': return 'default';
      case 'partial': return 'secondary';
      case 'rejected': return 'destructive';
      default: return 'outline';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1D24]">Delivery Challans</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DC Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>PO Number</TableHead>
                <TableHead>DC Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    <div className="flex flex-col items-center gap-2">
                      <Truck className="h-8 w-8 text-muted-foreground/50" />
                      No delivery challans found.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((dc) => (
                  <TableRow key={dc.id}>
                    <TableCell className="font-medium font-mono text-sm">
                      {dc.vendor_dc_number ?? '—'}
                    </TableCell>
                    <TableCell>{dc.vendors?.company_name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {dc.purchase_orders?.po_number ?? '—'}
                    </TableCell>
                    <TableCell>
                      {dc.vendor_dc_date ? formatDate(dc.vendor_dc_date) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(dc.status)}>
                        {dc.status?.replace(/_/g, ' ').toUpperCase() ?? 'PENDING'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                      {dc.rejection_notes ?? '—'}
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
