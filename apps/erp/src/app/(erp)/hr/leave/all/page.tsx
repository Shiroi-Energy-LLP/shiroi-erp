import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getAllLeaveRequests } from '@/lib/hr-queries';
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
  EmptyState,
} from '@repo/ui';
import { CalendarCheck } from 'lucide-react';

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual',
  sick: 'Sick',
  earned: 'Earned',
  maternity: 'Maternity',
  paternity: 'Paternity',
  compensatory: 'Comp Off',
  loss_of_pay: 'LOP',
  other: 'Other',
};

function leaveStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved': return 'default';
    case 'pending': return 'outline';
    case 'rejected': return 'destructive';
    case 'cancelled': return 'secondary';
    default: return 'outline';
  }
}

export default async function AllLeaveRequestsPage() {
  await requireRole(['founder', 'hr_manager']);

  const leaveRequests = await getAllLeaveRequests().catch(() => []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr/leave" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to Leave Management
          </Link>
          <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">All Leave Requests</h1>
          <p className="text-sm text-gray-500">
            {leaveRequests.length} request{leaveRequests.length !== 1 ? 's' : ''} (last 200)
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Reason / Rejection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={<CalendarCheck className="h-12 w-12" />}
                      title="No leave requests"
                      description="Leave requests will appear here once employees submit them."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                leaveRequests.map((req) => {
                  const emp = Array.isArray(req.employees)
                    ? req.employees[0]
                    : req.employees;
                  return (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        <div>{emp?.full_name ?? '—'}</div>
                        <div className="text-xs text-gray-400">{emp?.employee_code ?? ''}</div>
                      </TableCell>
                      <TableCell>
                        {LEAVE_TYPE_LABELS[req.leave_type] ?? req.leave_type}
                        {req.is_half_day && (
                          <Badge variant="outline" className="ml-1 text-xs">½ day</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(req.from_date)}</TableCell>
                      <TableCell className="text-sm">{formatDate(req.to_date)}</TableCell>
                      <TableCell className="text-right">{req.days_requested}</TableCell>
                      <TableCell>
                        <Badge variant={leaveStatusVariant(req.status)}>{req.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {req.applied_at ? formatDate(req.applied_at.split('T')[0] ?? '') : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-[200px]">
                        {req.status === 'rejected' && req.rejected_reason
                          ? <span className="text-red-600">{req.rejected_reason}</span>
                          : req.reason ?? '—'}
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
