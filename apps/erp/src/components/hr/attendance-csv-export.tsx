'use client';

import { useState } from 'react';
import { Button } from '@repo/ui';
import { Download } from 'lucide-react';
import { fetchAttendanceForExport } from '@/lib/hr-actions';

interface AttendanceCsvExportProps {
  month: number;
  year: number;
}

/**
 * Client component that calls a server action to fetch attendance data
 * and triggers a CSV download in the browser.
 * No direct Supabase calls — data fetched via server action.
 */
export function AttendanceCsvExport({ month, year }: AttendanceCsvExportProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    const op = '[AttendanceCsvExport]';
    setLoading(true);
    try {
      const result = await fetchAttendanceForExport(month, year);

      if (!result.success) {
        console.error(`${op} Server action failed:`, { error: result.error });
        return;
      }

      const data = result.data;
      if (data.length === 0) {
        console.warn(`${op} No data to export for ${year}-${month}`);
        return;
      }

      // Build CSV
      const headers = ['Employee Code', 'Employee Name', 'Date', 'Status', 'Check In', 'Check Out', 'Notes'];
      const rows = data.map((row) => [
        row.employee_code,
        row.full_name,
        row.date,
        row.status,
        row.check_in_time ?? '',
        row.check_out_time ?? '',
        (row.notes ?? '').replace(/,/g, ';'),
      ]);

      const csv = [headers, ...rows]
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shiroi-attendance-${year}-${String(month).padStart(2, '0')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(`[AttendanceCsvExport] Export failed:`, {
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleExport} disabled={loading} className="h-9">
      <Download className="h-4 w-4 mr-2" />
      {loading ? 'Exporting...' : 'Export CSV'}
    </Button>
  );
}
