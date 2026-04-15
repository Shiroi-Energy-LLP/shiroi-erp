import Link from 'next/link';
import { getProjectPaymentOverview, computePaymentsSummary } from '@/lib/payments-overview-queries';
import { getProjectsList } from '@/lib/procurement-queries';
import { formatINR, shortINR } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from '@repo/ui';
import { DollarSign } from 'lucide-react';
import { RecordPaymentDialog } from '@/components/finance/record-payment-dialog';
import { PaymentFollowupsTable } from '@/components/payments/payment-followups-table';

interface PaymentsPageProps {
  searchParams: Promise<{
    filter?: string; // 'outstanding' | 'active' | 'all' | 'followups'
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  order_received: 'Order Received',
  yet_to_start: 'Yet to Start',
  in_progress: 'In Progress',
  completed: 'Completed',
  holding_shiroi: 'Holding - Shiroi',
  holding_client: 'Holding - Client',
  waiting_net_metering: 'Net Metering',
  meter_client_scope: 'Meter - Client',
};

export default async function PaymentsOverviewPage({ searchParams }: PaymentsPageProps) {
  const params = await searchParams;
  const filter = params.filter ?? 'active';

  const [allRows, projects] = await Promise.all([
    getProjectPaymentOverview(),
    getProjectsList(),
  ]);
  const summary = computePaymentsSummary(allRows);

  // Filter rows based on selected view
  let filteredRows = allRows;
  if (filter === 'outstanding') {
    filteredRows = allRows.filter(r => r.outstanding > 0);
  } else if (filter === 'active') {
    filteredRows = allRows.filter(r =>
      !['completed', 'holding_client'].includes(r.project_status) || r.outstanding > 0
    );
  }

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex justify-end">
        <RecordPaymentDialog projects={projects} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Total Contracted</div>
            <div className="text-xl font-bold font-mono text-n-900 mt-1">{shortINR(summary.total_contracted)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Total Received</div>
            <div className="text-xl font-bold font-mono text-shiroi-green mt-1">{shortINR(summary.total_received)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Outstanding</div>
            <div className="text-xl font-bold font-mono text-red-600 mt-1">{shortINR(summary.total_outstanding)}</div>
            <div className="text-xs text-n-500">{summary.projects_with_outstanding} projects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Total Invested</div>
            <div className="text-xl font-bold font-mono text-n-900 mt-1">{shortINR(summary.total_invested)}</div>
            <div className="text-xs text-n-500">POs + Site Expenses</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Net Position</div>
            <div className={`text-xl font-bold font-mono mt-1 ${summary.net_position >= 0 ? 'text-shiroi-green' : 'text-red-600'}`}>
              {summary.net_position >= 0 ? '+' : ''}{shortINR(summary.net_position)}
            </div>
            <div className="text-xs text-n-500">Received - Invested</div>
          </CardContent>
        </Card>
      </div>

      {/* Expected Payments Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Expected This Week</div>
                <div className="text-2xl font-bold font-mono text-n-900 mt-1">{shortINR(summary.expected_this_week)}</div>
                <div className="text-xs text-n-500">Next milestone payments from top active projects</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-n-500 uppercase tracking-wider">Expected This Month</div>
                <div className="text-2xl font-bold font-mono text-n-900 mt-1">{shortINR(summary.expected_this_month)}</div>
                <div className="text-xs text-n-500">All active project next milestones</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        <Link href="/payments?filter=active">
          <Badge variant={filter === 'active' ? 'default' : 'outline'} className="cursor-pointer">
            Active ({allRows.filter(r => !['completed', 'holding_client'].includes(r.project_status) || r.outstanding > 0).length})
          </Badge>
        </Link>
        <Link href="/payments?filter=outstanding">
          <Badge variant={filter === 'outstanding' ? 'default' : 'outline'} className="cursor-pointer">
            Outstanding ({allRows.filter(r => r.outstanding > 0).length})
          </Badge>
        </Link>
        <Link href="/payments?filter=all">
          <Badge variant={filter === 'all' ? 'default' : 'outline'} className="cursor-pointer">
            All ({allRows.length})
          </Badge>
        </Link>
        <Link href="/payments?filter=followups">
          <Badge variant={filter === 'followups' ? 'default' : 'outline'} className="cursor-pointer">
            Follow-ups
          </Badge>
        </Link>
      </div>

      {/* Follow-ups tab - replaces the overview table when active */}
      {filter === 'followups' && <PaymentFollowupsTable />}

      {/* Main Table - hidden on follow-ups tab */}
      {filter !== 'followups' && (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Project</TableHead>
                  <TableHead className="whitespace-nowrap">Stage</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Project Value</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Received</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Outstanding</TableHead>
                  <TableHead className="whitespace-nowrap">Payment Stage</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Next Payment</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Invested</TableHead>
                  <TableHead className="whitespace-nowrap text-right">P&L</TableHead>
                  <TableHead className="whitespace-nowrap">PM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState
                        icon={<DollarSign className="h-12 w-12" />}
                        title="No projects found"
                        description="No projects match this filter."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const pnlPositive = row.project_pnl >= 0;
                    return (
                      <TableRow key={row.project_id}>
                        <TableCell>
                          <Link href={`/projects/${row.project_id}`} className="hover:text-shiroi-green">
                            <div className="text-xs font-mono text-n-500">{row.project_number}</div>
                            <div className="text-sm font-medium text-n-900 max-w-[180px] truncate">
                              {row.customer_name}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {STATUS_LABEL[row.project_status] ?? row.project_status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatINR(row.contracted_value)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-shiroi-green font-medium">
                          {row.total_received > 0 ? formatINR(row.total_received) : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm font-medium ${row.outstanding > 0 ? 'text-red-600' : 'text-n-500'}`}>
                          {row.outstanding > 0 ? formatINR(row.outstanding) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-n-600">{row.payment_stage}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.next_milestone_amount ? (
                            <div>
                              <div className="font-mono text-sm font-medium text-n-900">
                                {formatINR(row.next_milestone_amount)}
                              </div>
                              <div className="text-xs text-n-500">
                                {row.next_milestone_name} ({row.next_milestone_pct}%)
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-n-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-n-600">
                          {row.total_po_cost + row.total_site_expenses > 0
                            ? formatINR(row.total_po_cost + row.total_site_expenses)
                            : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm font-medium ${pnlPositive ? 'text-shiroi-green' : 'text-red-600'}`}>
                          {row.total_received > 0 || row.total_po_cost > 0 ? (
                            <>
                              {pnlPositive ? '+' : ''}{formatINR(row.project_pnl)}
                            </>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-n-600">
                          {row.pm_name ?? '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
