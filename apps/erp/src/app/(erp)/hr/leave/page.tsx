import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getUserProfile } from '@/lib/auth';
import {
  getPendingLeaveRequests,
  getLeaveCalendar,
} from '@/lib/hr-queries';
import { formatDate } from '@repo/ui/formatters';
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
import { CalendarCheck, CalendarDays } from 'lucide-react';
import { LeaveActionButtons } from '@/components/hr/leave-action-buttons';

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

export default async function LeaveManagementPage() {
  await requireRole(['founder', 'hr_manager']);
  const profile = await getUserProfile();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [pendingRequests, calendarEntries] = await Promise.all([
    getPendingLeaveRequests().catch(() => []),
    getLeaveCalendar(month, year).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr" className="text-sm text-[#B45309] hover:underline">
            &larr; Back to HR
          </Link>
          <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">Leave Management</h1>
          <p className="text-sm text-gray-500">
            Approve requests, track balances, view team calendar
          </p>
        </div>
      </div>

      {/* Pending requests — manager view */}
      {['founder', 'hr_manager'].includes(profile?.role ?? '') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-amber-600" />
              Pending Approvals
              {pendingRequests.length > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300 ml-1">
                  {pendingRequests.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pendingRequests.length === 0 ? (
              <div className="py-8 px-6">
                <EmptyState
                  icon={<CalendarCheck className="h-10 w-10" />}
                  title="No pending requests"
                  description="All leave requests have been actioned."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        <div>{req.full_name}</div>
                        <div className="text-xs text-gray-400">{req.employee_code}</div>
                      </TableCell>
                      <TableCell>
                        {LEAVE_TYPE_LABELS[req.leave_type] ?? req.leave_type}
                        {req.is_half_day && (
                          <Badge variant="outline" className="ml-1 text-xs">½ day</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(req.from_date)}</TableCell>
                      <TableCell className="text-sm">{formatDate(req.to_date)}</TableCell>
                      <TableCell className="text-right font-medium">{req.days_requested}</TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-[180px] truncate">
                        {req.reason ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {req.applied_at ? formatDate(req.applied_at.split('T')[0] ?? '') : '—'}
                      </TableCell>
                      <TableCell>
                        <LeaveActionButtons requestId={req.id} mode="manager" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Team calendar — who's on leave this month */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-[#B45309]" />
            On Leave This Month
            <span className="text-sm font-normal text-gray-500 ml-1">
              {new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {calendarEntries.length === 0 ? (
            <div className="py-8 px-6">
              <EmptyState
                icon={<CalendarDays className="h-10 w-10" />}
                title="No approved leaves this month"
                description="No employees have approved leaves for the current month."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calendarEntries.map((entry) => {
                  const emp = Array.isArray(entry.employees)
                    ? entry.employees[0]
                    : entry.employees;
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        <div>{emp?.full_name ?? '—'}</div>
                        <div className="text-xs text-gray-400">{emp?.employee_code ?? ''}</div>
                      </TableCell>
                      <TableCell>
                        {LEAVE_TYPE_LABELS[entry.leave_type] ?? entry.leave_type}
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(entry.from_date)}</TableCell>
                      <TableCell className="text-sm">{formatDate(entry.to_date)}</TableCell>
                      <TableCell className="text-right">{entry.days_requested}</TableCell>
                      <TableCell>
                        <Badge variant={leaveStatusVariant(entry.status)}>
                          {entry.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All requests link */}
      <div className="text-center">
        <Link href="/hr/leave/all" className="text-sm text-[#B45309] hover:underline">
          View all leave requests &rarr;
        </Link>
      </div>
    </div>
  );
}
