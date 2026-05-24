'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast, Select, Label } from '@repo/ui';
import { markAttendance, bulkMarkAttendance } from '@/lib/hr-actions';

type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'work_from_home';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'work_from_home', label: 'Work From Home' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'absent', label: 'Absent' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'holiday', label: 'Holiday' },
];

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-800',
  work_from_home: 'bg-blue-100 text-blue-800',
  half_day: 'bg-yellow-100 text-yellow-800',
  absent: 'bg-red-100 text-red-800',
  on_leave: 'bg-purple-100 text-purple-800',
  holiday: 'bg-gray-100 text-gray-600',
};

interface AttendanceCellProps {
  employeeId: string;
  date: string;
  currentStatus: AttendanceStatus | null;
  isHR: boolean;
}

/**
 * A table cell that shows the current attendance status and lets HR/founders
 * click to change it. Employees see a read-only badge.
 */
export function AttendanceCell({ employeeId, date, currentStatus, isHR }: AttendanceCellProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AttendanceStatus | ''>(currentStatus ?? '');

  const displayStatus = currentStatus;
  const colorClass = displayStatus ? STATUS_COLORS[displayStatus] : 'bg-gray-50 text-gray-400';
  const labelText = displayStatus
    ? STATUS_OPTIONS.find((o) => o.value === displayStatus)?.label ?? displayStatus
    : '—';

  async function handleSave() {
    if (!selected) return;
    setLoading(true);
    const result = await markAttendance({ employeeId, date, status: selected as AttendanceStatus });
    setLoading(false);
    if (!result.success) {
      addToast({ variant: 'destructive', title: 'Failed to mark attendance', description: result.error });
      return;
    }
    addToast({ variant: 'success', title: 'Attendance marked' });
    setEditing(false);
    router.refresh();
  }

  if (!isHR) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
        {labelText}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass} hover:opacity-80 transition-opacity cursor-pointer`}
        title="Click to change"
      >
        {labelText}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-[160px]">
      <Select
        value={selected}
        onChange={(e) => setSelected(e.target.value as AttendanceStatus)}
        className="text-xs h-7 py-0"
      >
        <option value="">Select...</option>
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        disabled={!selected || loading}
        onClick={handleSave}
        className="h-7 px-2 text-xs"
      >
        {loading ? '...' : 'Save'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => { setEditing(false); setSelected(currentStatus ?? ''); }}
        className="h-7 px-2 text-xs"
      >
        X
      </Button>
    </div>
  );
}

interface BulkMarkFormProps {
  employeeIds: string[];
  date: string;
}

/**
 * Bulk-mark all selected employees' attendance for a specific date.
 * HR/founder only.
 */
export function BulkMarkForm({ employeeIds, date }: BulkMarkFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [status, setStatus] = useState<AttendanceStatus | ''>('');
  const [loading, setLoading] = useState(false);

  async function handleBulkMark() {
    if (!status || !employeeIds.length) return;
    setLoading(true);
    const result = await bulkMarkAttendance(date, employeeIds, status as AttendanceStatus);
    setLoading(false);
    if (!result.success) {
      addToast({ variant: 'destructive', title: 'Failed to bulk-mark', description: result.error });
      return;
    }
    addToast({
      variant: 'success',
      title: `Marked ${result.data.marked} employees as ${status}`,
      description: result.data.skipped > 0 ? `${result.data.skipped} already had a record for this date.` : undefined,
    });
    router.refresh();
  }

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs text-gray-500">Bulk-mark all ({employeeIds.length}) as:</Label>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
          className="text-sm"
        >
          <option value="">Select status...</option>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
      <Button
        disabled={!status || loading}
        onClick={handleBulkMark}
        className="h-9"
      >
        {loading ? 'Marking...' : 'Apply to All'}
      </Button>
    </div>
  );
}
