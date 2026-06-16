import * as React from 'react';
import type { ProjectStatusSummaryRow } from '@/lib/projects-queries';

// Status order + palette mirror the list's status badges (data-table STATUS_COLORS).
const STATUS_META: { value: string; label: string; bg: string; text: string; border: string }[] = [
  { value: 'order_received', label: 'Order Received', bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  { value: 'yet_to_start', label: 'Yet to Start', bg: '#F5F6F8', text: '#525252', border: '#DFE2E8' },
  { value: 'in_progress', label: 'In Progress', bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
  { value: 'completed', label: 'Completed', bg: '#F0FDF4', text: '#00B050', border: '#BBF7D0' },
  { value: 'holding_shiroi', label: 'Holding — Shiroi', bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  { value: 'holding_client', label: 'Holding — Client', bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  { value: 'waiting_net_metering', label: 'Waiting Net Metering', bg: '#FAF5FF', text: '#7C3AED', border: '#DDD6FE' },
  { value: 'meter_client_scope', label: 'Meter — Client Scope', bg: '#F5F3FF', text: '#6D28D9', border: '#E9D5FF' },
];

function formatKwp(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * Projects-list header dashboard: total system size + a count chip per status.
 * Fed by get_project_status_summary (SQL-aggregated). Re-rendered by the server
 * page on every FY-filter change, so the numbers track the active year.
 */
export function ProjectsSummaryHeader({ rows }: { rows: ProjectStatusSummaryRow[] }) {
  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const total = byStatus.get('TOTAL');
  const totalCount = total?.project_count ?? 0;
  const totalKwp = total?.total_kwp ?? 0;

  return (
    <div className="flex flex-wrap items-stretch gap-2 pb-3">
      {/* Total system size + project count */}
      <div className="rounded-lg border border-shiroi-green/30 bg-shiroi-green/5 px-4 py-2.5 min-w-[170px]">
        <div className="text-[10px] uppercase tracking-wider text-n-500">Total System Size</div>
        <div className="text-lg font-bold text-n-900 tabular-nums">
          {formatKwp(totalKwp)} <span className="text-xs font-normal text-n-500">kWp</span>
        </div>
        <div className="text-[10px] text-n-500">
          {totalCount.toLocaleString('en-IN')} project{totalCount === 1 ? '' : 's'}
        </div>
      </div>

      {/* One count chip per status (all statuses shown, including zeros) */}
      {STATUS_META.map((s) => {
        const count = byStatus.get(s.value)?.project_count ?? 0;
        return (
          <div
            key={s.value}
            className="rounded-lg border px-3 py-2.5 min-w-[108px]"
            style={{ backgroundColor: s.bg, borderColor: s.border }}
          >
            <div className="text-[10px] font-medium leading-tight" style={{ color: s.text }}>{s.label}</div>
            <div className="text-lg font-bold tabular-nums" style={{ color: s.text }}>{count}</div>
          </div>
        );
      })}
    </div>
  );
}
