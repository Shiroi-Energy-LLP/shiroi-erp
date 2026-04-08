import Link from 'next/link';
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
  EmptyState,
} from '@repo/ui';
import { CalendarCheck } from 'lucide-react';

function leaveStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'approved':
      return 'default';
    case 'pending':
      return 'outline';
    case 'rejected':
      return 'destructive';
    case 'cancelled':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default async function LeaveRequestsPage() {
  let leaveRequests: Array<{
    id: string;
    leave_type: string;
    from_date: string;
    to_date: string;
    days_requested: number;
    status: string;
    reason: string;
    employees: { full_name: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id, leave_type, from_date, to_date, days_requested, status, reason, employees!leave_requests_employee_id_fkey(full_name)')
      .order('from_date', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[LeaveRequestsPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    leaveRequests = (data ?? []) as typeof leaveRequests;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Leave Requests</h1>
        <Card>
          <CardContent>
            <EmptyState
              icon={<CalendarCheck className="h-12 w-12" />}
              title="Could not load leave requests"
              description="No data available. Please try again later."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to HR
          </Link>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">Leave Requests</h1>
          <p className="text-sm text-gray-500">
            {leaveRequests.length} request{leaveRequests.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Leave Type</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<CalendarCheck className="h-12 w-12" />}
                      title="No leave requests found"
                      description="Leave requests will appear here once employees submit them."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                leaveRequests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">
                      {req.employees?.full_name ?? '—'}
                    </TableCell>
                    <TableCell className="capitalize">
                      {req.leave_type?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(req.from_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(req.to_date)}
                    </TableCell>
                    <TableCell>{req.days_requested}</TableCell>
                    <TableCell>
                      <Badge variant={leaveStatusVariant(req.status)}>
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {req.reason || '—'}
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
