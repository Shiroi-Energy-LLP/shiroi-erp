/**
 * /vendor-bills/[id] — Vendor Bill detail page.
 *
 * Extended for S17 / D3: when ai_status='pending_review', shows the AI
 * Extraction Review section at the top with side-by-side extracted fields
 * and embedded PDF viewer.
 *
 * NEVER-DO compliance:
 * - #15: no inline Supabase — uses vendor-bills-queries.ts + vendor-bills-ai-queries.ts
 * - #21: client components only import from server actions; no server Supabase client
 */

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
import { ArrowLeft, Building2, Bot, FileText } from 'lucide-react';
import { createAdminClient } from '@repo/supabase/admin';
import { ReviewActions } from './ai-review-actions';

interface PageProps {
  params: Promise<{ id: string }>;
}

function statusVariant(status: string): 'error' | 'pending' | 'success' | 'neutral' {
  if (status === 'paid') return 'success';
  if (status === 'partially_paid') return 'pending';
  if (status === 'pending') return 'error';
  return 'neutral';
}

function confidenceColour(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 0.85) return 'text-[#065F46]';
  if (score >= 0.7) return 'text-[#92400E]';
  return 'text-[#991B1B]';
}

const STORAGE_BUCKET = 'vendor-invoices-inbound';
const SIGNED_URL_TTL_S = 3600; // 1 hour

export default async function VendorBillDetailPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getVendorBillById(id);
  if (!result) notFound();

  const { bill, items, payments } = result;
  const vendor = bill.vendors;
  const project = bill.projects;

  // ── Generate signed URL for PDF (only when pending review) ────────────────
  let pdfSignedUrl: string | null = null;
  const isPendingReview = bill.ai_status === 'pending_review';

  if (isPendingReview && bill.ai_source_attachment_path) {
    // Use admin client — signed URL generation for private bucket needs service role
    const admin = createAdminClient();
    const { data: signedData, error: signedErr } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(bill.ai_source_attachment_path, SIGNED_URL_TTL_S);

    if (signedErr) {
      console.warn('[VendorBillDetailPage] signed URL failed', {
        id,
        path: bill.ai_source_attachment_path,
        error: signedErr.message,
      });
    } else {
      pdfSignedUrl = signedData?.signedUrl ?? null;
    }
  }

  // Extract AI fields from ai_extracted_data (JSONB) for display
  type ExtractedData = {
    vendor_name_extracted?: string;
    vendor_gstin?: string | null;
    bill_number?: string;
    bill_date?: string;
    due_date?: string | null;
    subtotal?: number;
    cgst_amount?: number | null;
    sgst_amount?: number | null;
    igst_amount?: number | null;
    total_amount?: number;
    confidence_score?: number;
  };
  const aiData = (bill.ai_extracted_data ?? null) as ExtractedData | null;

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Link
          href={isPendingReview ? '/vendor-bills/review' : '/vendor-bills'}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {isPendingReview ? 'AI Review Queue' : 'Vendor Bills'}
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow className="mb-1">VENDOR BILL</Eyebrow>
            <h1 className="text-2xl font-heading font-bold text-[#1A1D24] font-mono">
              {bill.bill_number}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {isPendingReview && (
              <Badge variant="pending" className="text-sm px-3 py-1 gap-1">
                <Bot className="h-3.5 w-3.5" />
                AI Pending Review
              </Badge>
            )}
            <Badge variant={statusVariant(bill.status)} className="text-sm px-3 py-1">
              {bill.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Badge>
          </div>
        </div>
      </div>

      {/* ── AI Extraction Review Section (only when pending_review) ──────────── */}
      {isPendingReview && (
        <Card className="border-2 border-[#00B050] bg-[#f0faf4]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-5 w-5 text-[#00B050]" />
                AI Extraction Review
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Confidence:</span>
                <span
                  className={`text-sm font-bold font-mono ${confidenceColour(bill.ai_confidence_score)}`}
                >
                  {bill.ai_confidence_score !== null
                    ? `${Math.round(Number(bill.ai_confidence_score) * 100)}%`
                    : 'N/A'}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Extracted from:{' '}
              <span className="font-mono">{bill.ai_source_email_id ?? 'unknown'}</span>
              {bill.ai_extracted_at && (
                <>
                  {' '}
                  &middot;{' '}
                  {new Date(bill.ai_extracted_at).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </>
              )}
            </p>
          </CardHeader>
          <CardContent>
            {/* Side-by-side: extracted fields | PDF viewer */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Left: AI-extracted fields */}
              <div className="space-y-3 text-sm">
                <h3 className="font-semibold text-[#1A1D24]">AI-Extracted Fields</h3>
                <div className="rounded-md border bg-white p-4 space-y-2">
                  {aiData?.vendor_name_extracted && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Vendor Name (extracted)</span>
                      <span className="font-medium">{aiData.vendor_name_extracted}</span>
                    </div>
                  )}
                  {aiData?.vendor_gstin && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GSTIN (extracted)</span>
                      <span className="font-mono text-xs">{aiData.vendor_gstin}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bill Number</span>
                    <span className="font-mono">{bill.bill_number}</span>
                  </div>
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
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono">{formatINR(Number(bill.subtotal))}</span>
                  </div>
                  {Number(bill.cgst_amount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>CGST</span>
                      <span className="font-mono">{formatINR(Number(bill.cgst_amount))}</span>
                    </div>
                  )}
                  {Number(bill.sgst_amount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>SGST</span>
                      <span className="font-mono">{formatINR(Number(bill.sgst_amount))}</span>
                    </div>
                  )}
                  {Number(bill.igst_amount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>IGST</span>
                      <span className="font-mono">{formatINR(Number(bill.igst_amount))}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Total</span>
                    <span className="font-mono">{formatINR(Number(bill.total_amount))}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Matched vendor:{' '}
                  <span className="font-semibold">
                    {vendor?.company_name ?? '(unmatched — assign vendor before approving)'}
                  </span>
                </p>
              </div>

              {/* Right: PDF viewer */}
              <div className="space-y-3">
                <h3 className="font-semibold text-[#1A1D24] text-sm">Original PDF</h3>
                {pdfSignedUrl ? (
                  <div className="rounded-md border overflow-hidden bg-gray-50">
                    <iframe
                      src={pdfSignedUrl}
                      className="w-full"
                      style={{ height: '480px' }}
                      title="Vendor Invoice PDF"
                    />
                    <div className="p-2 flex justify-end">
                      <a
                        href={pdfSignedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#00B050] hover:underline flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" />
                        Open in new tab
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border bg-gray-50 flex items-center justify-center h-48 text-sm text-muted-foreground">
                    {bill.ai_source_attachment_path
                      ? 'PDF preview unavailable (signed URL generation failed)'
                      : 'No PDF attachment path recorded'}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-6 pt-4 border-t flex items-center gap-4">
              <ReviewActions billId={bill.id} />
              <p className="text-xs text-muted-foreground">
                Approving sets status to &ldquo;Pending Payment&rdquo;. Rejecting cancels the bill.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Standard bill layout ─────────────────────────────────────────────── */}
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
              {bill.ai_status && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI Status</span>
                  <Badge variant="neutral" className="text-xs font-mono capitalize">
                    {bill.ai_status.replace(/_/g, ' ')}
                  </Badge>
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
