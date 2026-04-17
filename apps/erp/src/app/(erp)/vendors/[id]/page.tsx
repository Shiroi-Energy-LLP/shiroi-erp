import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getVendorById } from '@/lib/vendor-bills-queries';
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
import { ArrowLeft, Building2, FileText, DollarSign } from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VendorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getVendorById(id);
  if (!result) notFound();

  const { vendor, bills, payments } = result;

  const totalBilled = bills.reduce((s, b) => s + Number(b.total_amount), 0);
  const totalOutstanding = bills
    .filter(b => b.status !== 'paid' && b.status !== 'cancelled')
    .reduce((s, b) => s + Number(b.balance_due ?? 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Link
          href="/vendors"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Vendors
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow className="mb-1">VENDOR</Eyebrow>
            <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
              {vendor.company_name}
            </h1>
            <p className="text-muted-foreground font-mono text-sm mt-1">{vendor.vendor_code}</p>
          </div>
          <div className="flex items-center gap-2">
            {vendor.is_msme && (
              <Badge variant="pending">MSME — {vendor.udyam_type ?? 'Unknown'}</Badge>
            )}
            <Badge variant={vendor.is_active ? 'success' : 'neutral'}>
              {vendor.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-4 w-4" />
              Total Billed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold font-mono">{formatINR(totalBilled)}</p>
            <p className="text-xs text-muted-foreground mt-1">{bills.length} bills</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold font-mono text-[#991B1B]">{formatINR(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Total Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold font-mono text-[#065F46]">{formatINR(totalPaid)}</p>
            <p className="text-xs text-muted-foreground mt-1">{payments.length} payments</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: vendor info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4" />
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {vendor.vendor_type && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="capitalize">{vendor.vendor_type.replace(/_/g, ' ')}</span>
              </div>
            )}
            {vendor.gstin && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">GSTIN</span>
                <span className="font-mono">{vendor.gstin}</span>
              </div>
            )}
            {vendor.pan_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">PAN</span>
                <span className="font-mono">{vendor.pan_number}</span>
              </div>
            )}
            {vendor.udyam_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Udyam #</span>
                <span className="font-mono text-xs">{vendor.udyam_number}</span>
              </div>
            )}
            {vendor.udyam_type && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">MSME Type</span>
                <Badge variant="pending">{vendor.udyam_type}</Badge>
              </div>
            )}
            {vendor.payment_terms_days != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Terms</span>
                <span>{vendor.payment_terms_days} days</span>
              </div>
            )}
            {vendor.contact_person && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contact</span>
                <span>{vendor.contact_person}</span>
              </div>
            )}
            {vendor.phone && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span className="font-mono">{vendor.phone}</span>
              </div>
            )}
            {vendor.zoho_vendor_id && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Zoho ID</span>
                <span className="font-mono text-xs text-muted-foreground">{vendor.zoho_vendor_id}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: bills + payments */}
        <div className="lg:col-span-2 space-y-4">
          {/* Bills */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Bills</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {bills.length === 0 ? (
                <div className="p-4 text-sm text-center text-muted-foreground">No bills found.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill #</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bills.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-sm">
                          <Link href={`/vendor-bills/${b.id}`} className="text-[#00B050] hover:underline">
                            {b.bill_number}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.projects?.project_number ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(b.bill_date)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatINR(Number(b.total_amount))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-[#991B1B]">
                          {b.balance_due != null && Number(b.balance_due) > 0
                            ? formatINR(Number(b.balance_due))
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            b.status === 'paid' ? 'success'
                              : b.status === 'partially_paid' ? 'pending'
                                : b.status === 'pending' ? 'error'
                                  : 'neutral'
                          }>
                            {b.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Recent payments */}
          {payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent Payments</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
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
                    {payments.slice(0, 20).map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.payment_date)}</TableCell>
                        <TableCell className="capitalize text-sm">
                          {p.payment_method?.replace(/_/g, ' ') ?? '—'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{p.payment_reference ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono font-semibold text-[#065F46]">
                          {formatINR(Number(p.amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
