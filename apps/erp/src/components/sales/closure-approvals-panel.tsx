import Link from 'next/link';
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
} from '@repo/ui';
import { listPendingClosureApprovals } from '@/lib/closure-queries';
import { ClosureApprovalActions } from './closure-approval-actions';

function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Founder-only panel showing pending amber-band closure approval requests.
 *
 * Mount on the founder dashboard — one row per pending request, with inline
 * Approve / Reject buttons. Empty state hides the whole card to avoid clutter.
 */
export async function ClosureApprovalsPanel() {
  const approvals = await listPendingClosureApprovals();

  if (approvals.length === 0) {
    return null;
  }

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-amber-900">
            Closure Approvals Requested
          </CardTitle>
          <Badge variant="warning">{approvals.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Requested By</TableHead>
              <TableHead className="text-right">Gross Margin</TableHead>
              <TableHead className="text-right">Base Price</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approvals.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link
                    href={`/sales/${a.lead_id}`}
                    className="text-shiroi-green hover:underline font-medium"
                  >
                    {a.lead_customer_name}
                  </Link>
                  {a.lead_city && (
                    <div className="text-xs text-n-500">{a.lead_city}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-n-600">
                  {a.requested_by_name ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="warning" className="text-xs">
                    {Number(a.gross_margin_at_request).toFixed(1)}%
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatINR(Number(a.final_base_price))}
                </TableCell>
                <TableCell className="text-xs text-n-600 max-w-xs truncate">
                  {a.reason ?? '—'}
                </TableCell>
                <TableCell>
                  <ClosureApprovalActions approvalId={a.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
