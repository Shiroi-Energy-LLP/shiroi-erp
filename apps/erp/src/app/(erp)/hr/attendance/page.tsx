import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  getTeamAttendanceForMonth,
  getActiveEmployeesForAttendance,
} from '@/lib/hr-queries';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  EmptyState,
} from '@repo/ui';
import { CalendarDays } from 'lucide-react';
import { AttendanceCell, BulkMarkForm } from '@/components/hr/attendance-mark-button';
import { AttendanceCsvExport } from '@/components/hr/attendance-csv-export';

type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'work_from_home';

interface AttendancePageProps {
  searchParams: Promise<{ month?: string; year?: string }>;
}

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-800',
  work_from_home: 'bg-blue-100 text-blue-800',
  half_day: 'bg-yellow-100 text-yellow-800',
  absent: 'bg-red-100 text-red-800',
  on_leave: 'bg-purple-100 text-purple-800',
  holiday: 'bg-gray-100 text-gray-600',
};

const STATUS_ABBR: Record<AttendanceStatus, string> = {
  present: 'P',
  work_from_home: 'WFH',
  half_day: '½',
  absent: 'A',
  on_leave: 'L',
  holiday: 'H',
};

function getDaysInMonth(month: number, year: number): number[] {
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) => i + 1);
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function weekdayLetter(year: number, month: number, day: number): string {
  return WEEKDAY_LETTERS[new Date(year, month - 1, day).getDay()] ?? '';
}

function isWeekend(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day).getDay();
  return d === 0 || d === 6;
}

export default async function AttendancePage({ searchParams }: AttendancePageProps) {
  await requireRole(['founder', 'hr_manager']);

  const sp = await searchParams;
  const now = new Date();
  const month = parseInt(sp.month ?? String(now.getMonth() + 1), 10);
  const year = parseInt(sp.year ?? String(now.getFullYear()), 10);

  const [attendanceRows, employees] = await Promise.all([
    getTeamAttendanceForMonth(month, year).catch(() => []),
    getActiveEmployeesForAttendance().catch(() => []),
  ]);

  // Build lookup: employeeId → { 'YYYY-MM-DD' → status }
  const lookup = new Map<string, Map<string, AttendanceStatus>>();
  for (const row of attendanceRows) {
    if (!lookup.has(row.employee_id)) lookup.set(row.employee_id, new Map());
    lookup.get(row.employee_id)!.set(row.date, row.status as AttendanceStatus);
  }

  const days = getDaysInMonth(month, year);
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const todayStr = now.toISOString().split('T')[0]!;
  const employeeIds = employees.map((e) => e.id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr" className="text-sm text-shiroi-gold-dark hover:underline">
            &larr; Back to HR
          </Link>
          <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">Attendance</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/hr/attendance?month=${prevMonth}&year=${prevYear}`}
            className="text-sm text-gray-500 hover:text-[#1A1D24] border rounded-md px-3 py-1.5"
          >
            &larr; Prev
          </Link>
          <span className="text-sm font-semibold text-[#1A1D24]">{monthLabel}</span>
          <Link
            href={`/hr/attendance?month=${nextMonth}&year=${nextYear}`}
            className="text-sm text-gray-500 hover:text-[#1A1D24] border rounded-md px-3 py-1.5"
          >
            Next &rarr;
          </Link>
        </div>
      </div>

      {/* Bulk-mark toolbar */}
      {employees.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-end gap-6">
              <BulkMarkForm employeeIds={employeeIds} date={todayStr} />
              <AttendanceCsvExport month={month} year={year} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.entries(STATUS_COLORS) as [AttendanceStatus, string][]).map(([status, colorClass]) => (
          <span key={status} className={`px-2 py-0.5 rounded font-medium ${colorClass}`}>
            {STATUS_ABBR[status]} = {status.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Attendance grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            Team Attendance — {monthLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {employees.length === 0 ? (
            <div className="py-8 px-6">
              <EmptyState
                icon={<CalendarDays className="h-12 w-12" />}
                title="No active employees"
                description="No active employees found."
              />
            </div>
          ) : (
            <table className="min-w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="sticky left-0 bg-gray-50 z-10 text-left px-3 py-2 font-semibold text-gray-700 border-r min-w-[160px]">
                    Employee
                  </th>
                  {days.map((d) => {
                    const weekend = isWeekend(year, month, d);
                    const todayIsoDate = new Date().toISOString().slice(0, 10);
                    const cellIsoDate = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const isToday = cellIsoDate === todayIsoDate;
                    return (
                      <th
                        key={d}
                        className={`px-1 py-2 text-center font-medium min-w-[32px] leading-tight ${
                          weekend ? 'text-gray-400 bg-gray-100' : 'text-gray-600'
                        } ${isToday ? 'bg-blue-50 text-blue-700' : ''}`}
                      >
                        <div className="text-[10px] uppercase tracking-wide opacity-70">
                          {weekdayLetter(year, month, d)}
                        </div>
                        <div className={isToday ? 'font-bold' : ''}>{d}</div>
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-right font-semibold text-gray-700 border-l min-w-[100px]">
                    P% (month)
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const empMap = lookup.get(emp.id) ?? new Map<string, AttendanceStatus>();
                  let presentCount = 0;
                  let markedCount = 0;

                  return (
                    <tr key={emp.id} className="border-b hover:bg-gray-50/50">
                      <td className="sticky left-0 bg-white border-r px-3 py-1.5 z-10">
                        <div className="font-medium text-[#1A1D24]">{emp.full_name}</div>
                        <div className="text-gray-400">{emp.employee_code}</div>
                      </td>
                      {days.map((d) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const status = empMap.get(dateStr) ?? null;
                        const weekend = isWeekend(year, month, d);

                        if (status) {
                          markedCount++;
                          if (status === 'present' || status === 'work_from_home') presentCount++;
                          if (status === 'half_day') presentCount += 0.5;
                        }

                        return (
                          <td
                            key={d}
                            className={`px-0.5 py-1 text-center ${weekend ? 'bg-gray-50' : ''}`}
                          >
                            <AttendanceCell
                              employeeId={emp.id}
                              date={dateStr}
                              currentStatus={status}
                              isHR={true}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right border-l font-medium">
                        {markedCount > 0 ? (
                          <span className={presentCount / markedCount >= 0.8 ? 'text-green-700' : 'text-amber-600'}>
                            {Math.round((presentCount / markedCount) * 100)}%
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
