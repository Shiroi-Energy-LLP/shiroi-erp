import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getVendorBillById } from '@/lib/vendor-bills-queries';
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
  Eyebrow,
} from '@repo/ui';
import { ArrowLeft, Building2 } from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
}

function statusVariant(status: string): 'error' | 'pending' | 'success' | 'neutral' {
  if (status === 'paid') return 'success';
  if (status === 'partially_paid') return 'pending';
  if (status === 'pending') return 'error';
  return 'neutral';
}

export default async function VendorBillDetailPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getVendorBillById(id);
  if (!result) notFound();

  const { bill, items, payments } = result;
  const vendor = bill.vendors;
  const project = bill.projects;

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Link
          href="/vendor-bills"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Vendor Bills
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow className="mb-1">VENDOR BILL</Eyebrow>
            <h1 className="text-2xl font-heading font-bold text-[#1A1D24] font-mono">
              {bill.bill_number}
            </h1>
          </div>
          <Badge variant={statusVariant(bill.status)} className="text-sm px-3 py-1">
            {bill.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left col: meta */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4" />
                Vendor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-semibold">
                <Link href={`/vendors/${vendor?.id}`} className="hover:underline text-[#00B050]">
                  {vendor?.company_name ?? '—'}
                </Link>
              </div>
              {vendor?.vendor_code && (
                <div className="text-muted-foreground font-mono">{vendor.vendor_code}</div>
              )}
              {vendor?.is_msme && (
                <Badge variant="pending">MSME — {vendor.udyam_type ?? 'Type not set'}</Badge>
              )}
              {vendor?.gstin && (
                <div className="text-muted-foreground">GSTIN: {vendor.gstin}</div>
              )}
              {vendor?.udyam_number && (
                <div className="text-muted-foreground">Udyam: {vendor.udyam_number}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Bill Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bill Date</span>
                <span>{formatDate(bill.bill_date)}</span>
              </div>
              {bill.due_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due Date</span>
                  <span>{formatDate(bill.due_date)}</span>
                </div>
              )}
              {project && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project</span>
                  <Link href={`/projects/${bill.project_id}`} className="hover:underline text-[#00B050]">
                    {project.project_number}
                  </Link>
                </div>
              )}
              {bill.purchase_orders && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PO #</span>
                  <span className="font-mono">{bill.purchase_orders.po_number}</span>
                </div>
              )}
              {bill.source === 'zoho_import' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <Badge variant="neutral" className="text-xs">Zoho Import</Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Amounts summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Amounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatINR(Number(bill.subtotal))}</span>
              </div>
              {Number(bill.cgst_amount) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>CGST</span>
                  <span>{formatINR(Number(bill.cgst_amount))}</span>
                </div>
              )}
              {Number(bill.sgst_amount) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>SGST</span>
                  <span>{formatINR(Number(bill.sgst_amount))}</span>
                </div>
              )}
              {Number(bill.igst_amount) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>IGST</span>
                  <span>{formatINR(Number(bill.igst_amount))}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t pt-2">
                <span>Total</span>
                <span>{formatINR(Number(bill.total_amount))}</span>
              </div>
              <div className="flex justify-between text-[#065F46]">
                <span>Paid</span>
                <span>{formatINR(Number(bill.amount_paid))}</span>
              </div>
              <div className="flex justify-between text-[#991B1B] font-bold">
                <span>Balance Due</span>
                <span>{bill.balance_due != null ? formatINR(Number(bill.balance_due)) : '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right col: line items + payments */}
        <div className="lg:col-span-2 space-y-4">
          {/* Line items */}
          {items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Line Items</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>HSN</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.item_name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {item.hsn_code ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatINR(Number(item.rate))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatINR(Number(item.taxable_amount))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          {formatINR(Number(item.total_amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Payments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Payment History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No payments recorded against this bill.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.payment_date)}</TableCell>
                        <TableCell className="capitalize">
                          {p.payment_method?.replace(/_/g, ' ') ?? '—'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {p.payment_reference ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-[#065F46]">
                          {formatINR(Number(p.amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {bill.notes && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{bill.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
