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
  EmptyState,
} from '@repo/ui';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  getPaymentFollowups,
  getPaymentFollowupsSummary,
} from '@/lib/payment-followups-queries';
import { MarkFollowupCompleteButton } from './mark-followup-complete-button';

/**
 * Drop-in "Follow-ups" tab for the /payments page.
 *
 * Surfaces all open payment_followup and payment_escalation tasks grouped by
 * severity. Marketing manager works this view daily; founder sees it when a
 * follow-up escalates.
 */
export async function PaymentFollowupsTable() {
  const [rows, summary] = await Promise.all([
    getPaymentFollowups(),
    getPaymentFollowupsSummary(),
  ]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Open Follow-ups
            </div>
            <div className="text-2xl font-bold font-mono text-n-900 mt-1">
              {summary.total_open}
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Overdue
            </div>
            <div className="text-2xl font-bold font-mono text-amber-700 mt-1">
              {summary.total_overdue}
            </div>
            <div className="text-xs text-n-500">Past due date</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">
              Escalated to Founder
            </div>
            <div className="text-2xl font-bold font-mono text-red-700 mt-1">
              {summary.total_escalated}
            </div>
            <div className="text-xs text-n-500">SLA exceeded</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Follow-ups</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-12 w-12" />}
              title="All clear"
              description="No open payment follow-ups. Great work!"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isEscalation = r.category === 'payment_escalation';
                  const isOverdue =
                    r.due_date !== null && r.due_date < new Date().toISOString().split('T')[0]!;

                  return (
                    <TableRow key={r.id} className="hover:bg-n-50">
                      <TableCell>
                        {r.project_id ? (
                          <Link
                            href={`/projects/${r.project_id}`}
                            className="text-shiroi-green hover:underline font-medium text-sm"
                          >
                            {r.project_number ?? '—'}
                          </Link>
                        ) : (
                          <span className="text-sm text-n-500">—</span>
                        )}
                        <div className="text-xs text-n-500">{r.project_customer_name}</div>
                      </TableCell>
                      <TableCell className="text-sm max-w-xs">
                        <div className="truncate">{r.title}</div>
                      </TableCell>
                      <TableCell>
                        {isEscalation ? (
                          <Badge variant="error" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1 inline" />
                            Escalation
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-xs">
                            Follow-up
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-n-600">
                        {r.assigned_to_name ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.due_date ? (
                          <span className={isOverdue ? 'text-red-700 font-medium' : ''}>
                            {new Date(r.due_date).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </span>
                        ) : (
                          <span className="text-n-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        <span
                          className={
                            r.days_old > 14
                              ? 'text-red-700 font-medium'
                              : r.days_old > 7
                                ? 'text-amber-700'
                                : 'text-n-600'
                          }
                        >
                          {r.days_old}d
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <MarkFollowupCompleteButton taskId={r.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
