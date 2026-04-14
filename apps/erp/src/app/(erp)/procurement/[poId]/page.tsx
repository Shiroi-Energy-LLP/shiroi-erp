import { getPurchaseOrder } from '@/lib/procurement-queries';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Card, CardContent, Badge, Eyebrow,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';
import { DataFlagButton } from '@/components/data-flag-button';
import { PoRateInlineEdit } from '@/components/procurement/po-rate-inline-edit';
import { PoDownloadButton } from '@/components/procurement/po-download-button';
import { PoDeleteButton } from '@/components/procurement/po-delete-button';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved': case 'fully_delivered': return 'default';
    case 'partially_delivered': return 'secondary';
    case 'cancelled': return 'destructive';
    default: return 'outline';
  }
}

function formatINR(amount: number | null): string {
  if (!amount) return '—';
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface PageProps {
  params: Promise<{ poId: string }>;
}

export default async function PODetailPage({ params }: PageProps) {
  const { poId } = await params;

  let po;
  try {
    po = await getPurchaseOrder(poId);
  } catch {
    notFound();
  }
  if (!po) notFound();

  const items = po.purchase_order_items ?? [];
  const deliveryChallans = po.vendor_delivery_challans ?? [];
  const payments = po.vendor_payments ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/procurement" className="text-sm text-[#00B050] hover:underline">
          &larr; Back to Purchase Orders
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <Eyebrow className="mb-0">PURCHASE ORDER</Eyebrow>
          <DataFlagButton entityType="po" entityId={poId} />
        </div>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">{po.po_number}</h1>
        <div className="flex items-center gap-2 mt-2">
          <PoDownloadButton poId={poId} poNumber={po.po_number ?? ''} />
          {(po.status === 'draft' || po.status === 'sent') && (
            <PoDeleteButton poId={poId} />
          )}
        </div>
      </div>

      {/* PO Header Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 space-y-2">
            <h3 className="text-xs font-bold text-[#7C818E] uppercase">Vendor</h3>
            <p className="text-sm font-medium text-[#1A1D24]">{po.vendors?.company_name ?? '—'}</p>
            {po.vendors?.contact_person && <p className="text-xs text-[#7C818E]">{po.vendors.contact_person}</p>}
            {po.vendors?.phone && <p className="text-xs text-[#7C818E]">{po.vendors.phone}</p>}
            {po.vendors?.gstin && <p className="text-xs text-[#7C818E]">GSTIN: {po.vendors.gstin}</p>}
            {po.vendors?.is_msme && <Badge variant="outline" className="text-xs mt-1">MSME</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <h3 className="text-xs font-bold text-[#7C818E] uppercase">Project</h3>
            {po.projects ? (
              <>
                <Link href={`/projects/${po.project_id}`} className="text-sm font-medium text-[#00B050] hover:underline">
                  {po.projects.project_number}
                </Link>
                <p className="text-xs text-[#7C818E]">{po.projects.customer_name}</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">No project linked</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <h3 className="text-xs font-bold text-[#7C818E] uppercase">Order Details</h3>
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(po.status)}>{po.status?.replace(/_/g, ' ')}</Badge>
            </div>
            <p className="text-sm"><span className="text-[#7C818E]">PO Date:</span> {formatDate(po.po_date)}</p>
            <p className="text-sm"><span className="text-[#7C818E]">Total:</span> <span className="font-bold">{formatINR(po.total_amount)}</span></p>
            {po.expected_delivery_date && (
              <p className="text-sm"><span className="text-[#7C818E]">Expected Delivery:</span> {formatDate(po.expected_delivery_date)}</p>
            )}
            {po.actual_delivery_date && (
              <p className="text-sm"><span className="text-[#7C818E]">Actual Delivery:</span> {formatDate(po.actual_delivery_date)}</p>
            )}
            {po.preparer && <p className="text-xs text-[#7C818E]">Prepared by: {po.preparer.full_name}</p>}
            {po.approver && <p className="text-xs text-[#7C818E]">Approved by: {po.approver.full_name}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardContent className="pt-4">
          <h2 className="text-sm font-heading font-bold text-[#1A1D24] mb-3">
            Line Items ({items.length})
          </h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Unit Rate</TableHead>
                  <TableHead>GST %</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-gray-400 py-8">
                      No line items
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item: any, idx: number) => {
                    const canEditRate = po.status === 'draft' || po.status === 'sent';
                    const unitRate = item.unit_price ?? item.unit_rate ?? 0;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs text-gray-400">{idx + 1}</TableCell>
                        <TableCell className="text-sm">{item.item_description ?? item.item_name ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{item.item_category?.replace(/_/g, ' ')}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{item.quantity_ordered ?? item.quantity ?? '—'}</TableCell>
                        <TableCell className="text-xs text-gray-500">{item.unit ?? '—'}</TableCell>
                        <TableCell className="text-sm font-mono">
                          {canEditRate ? (
                            <PoRateInlineEdit
                              poId={poId}
                              itemId={item.id}
                              currentRate={unitRate}
                            />
                          ) : (
                            <span className="font-mono">{formatINR(unitRate)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{item.gst_rate ?? item.gst_percentage ?? '—'}%</TableCell>
                        <TableCell className="text-sm font-mono font-medium">{formatINR(item.total_price ?? item.total_amount ?? 0)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delivery Challans */}
      {deliveryChallans.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-heading font-bold text-[#1A1D24] mb-3">
              Delivery Challans ({deliveryChallans.length})
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DC #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveryChallans.map((dc: any) => (
                  <TableRow key={dc.id}>
                    <TableCell className="font-mono text-sm">{dc.vendor_dc_number ?? dc.dc_number ?? '—'}</TableCell>
                    <TableCell className="text-sm">{formatDate(dc.dc_date)}</TableCell>
                    <TableCell>
                      <Badge variant={dc.status === 'received' ? 'default' : 'outline'}>
                        {dc.status?.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{dc.vendor_delivery_challan_items?.length ?? 0} items</TableCell>
                    <TableCell className="text-xs text-gray-500 max-w-[200px] truncate">{dc.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Vendor Payments */}
      {payments.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-heading font-bold text-[#1A1D24] mb-3">
              Vendor Payments ({payments.length})
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((pmt: any) => (
                  <TableRow key={pmt.id}>
                    <TableCell className="text-sm">{formatDate(pmt.payment_date)}</TableCell>
                    <TableCell className="text-sm font-mono font-medium">{formatINR(pmt.amount)}</TableCell>
                    <TableCell className="text-xs text-gray-500">{pmt.payment_mode?.replace(/_/g, ' ') ?? '—'}</TableCell>
                    <TableCell className="text-xs text-gray-500 font-mono">{pmt.reference_number ?? '—'}</TableCell>
                    <TableCell className="text-xs text-gray-500 max-w-[200px] truncate">{pmt.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {po.notes && (
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-heading font-bold text-[#1A1D24] mb-2">Notes</h2>
            <p className="text-sm text-[#7C818E] whitespace-pre-wrap">{po.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
