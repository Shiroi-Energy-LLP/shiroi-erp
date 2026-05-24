/**
 * /vendor-bills/review — S17 / D3
 *
 * AI extraction review queue. Lists all vendor_bills with ai_status='pending_review'.
 * Role gate: founder + finance only.
 *
 * NEVER-DO compliance:
 * - #15: no inline Supabase — uses vendor-bills-ai-queries.ts
 * - #21: shared constants extracted, no server imports in client components
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { listPendingAiReview, getAiReviewKpis } from '@/lib/vendor-bills-ai-queries';
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
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { Bot, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

// ── Confidence badge helper (no server import — pure computation) ──────────────

function confidenceBadge(score: number | null) {
  if (score === null) {
    return (
      <Badge variant="neutral" className="text-xs font-mono">
        N/A
      </Badge>
    );
  }
  const pct = Math.round(score * 100);
  if (score >= 0.85) {
    return (
      <Badge variant="success" className="text-xs font-mono">
        {pct}%
      </Badge>
    );
  }
  if (score >= 0.7) {
    return (
      <Badge variant="pending" className="text-xs font-mono">
        {pct}%
      </Badge>
    );
  }
  return (
    <Badge variant="error" className="text-xs font-mono">
      {pct}%
    </Badge>
  );
}

const ALLOWED_ROLES = new Set(['founder', 'finance']);

export default async function VendorBillAiReviewPage() {
  // ── Role gate ────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !ALLOWED_ROLES.has(profile.role as string)) {
    redirect('/vendor-bills');
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [bills, kpis] = await Promise.all([
    listPendingAiReview(),
    getAiReviewKpis(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">FINANCE / AI</Eyebrow>
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-[#00B050]" />
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">
            Vendor Invoice AI Review
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Invoices extracted from vendor-bills@shiroienergy.com — review and approve or reject.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4" />
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#1A1D24]">{kpis.pending_count}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-[#065F46]" />
              Approved Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#065F46]">{kpis.approved_today}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <XCircle className="h-4 w-4 text-[#991B1B]" />
              Rejected Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#991B1B]">{kpis.rejected_today}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Avg Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-[#1A1D24]">
              {kpis.avg_confidence !== null ? `${Math.round(kpis.avg_confidence * 100)}%` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Queue table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pending Review Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill #</TableHead>
                <TableHead>Vendor (matched)</TableHead>
                <TableHead>Bill Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Confidence</TableHead>
                <TableHead>Ingested At</TableHead>
                <TableHead>Source Email ID</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<Bot className="h-12 w-12" />}
                      title="Review queue is empty"
                      description="All AI-extracted invoices have been reviewed. New invoices will appear here after the next IMAP poll."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                bills.map(bill => {
                  const isUnmatched =
                    bill.vendors?.vendor_code === 'SHIROI/VEN/AI-UNKNOWN' ||
                    !bill.vendors;
                  return (
                    <TableRow key={bill.id}>
                      <TableCell className="font-mono text-sm">
                        <Link
                          href={`/vendor-bills/${bill.id}`}
                          className="text-[#00B050] hover:underline"
                        >
                          {bill.bill_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">
                            {bill.vendors?.company_name ?? '(unknown vendor)'}
                          </span>
                          {isUnmatched && (
                            <Badge variant="error" className="text-xs">
                              Unmatched
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {bill.bill_date ? formatDate(bill.bill_date) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatINR(Number(bill.total_amount))}
                      </TableCell>
                      <TableCell className="text-center">
                        {confidenceBadge(bill.ai_confidence_score)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {bill.ai_extracted_at
                          ? new Date(bill.ai_extracted_at).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground max-w-[160px] truncate">
                        {bill.ai_source_email_id ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/vendor-bills/${bill.id}`}
                          className="text-sm font-medium text-[#00B050] hover:underline whitespace-nowrap"
                        >
                          Review
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
