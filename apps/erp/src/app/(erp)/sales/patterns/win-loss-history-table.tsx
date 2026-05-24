'use client';

/**
 * win-loss-history-table.tsx — historical win/loss reports table with
 * "view full" dialog for each row.
 */

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@repo/ui';
import { shortINR } from '@repo/ui';
import type { Database } from '@repo/types/database';

type WinLossPatternRow = Database['public']['Tables']['lead_win_loss_patterns']['Row'];

interface LossReasonEntry {
  reason: string;
  count: number;
}

interface WinLossHistoryTableProps {
  reports: WinLossPatternRow[];
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00+05:30');
  const e = new Date(end + 'T00:00:00+05:30');
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function parseLossReasons(raw: WinLossPatternRow['top_loss_reasons']): LossReasonEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (r): r is LossReasonEntry =>
      typeof r === 'object' && r !== null && 'reason' in r && 'count' in r,
  );
}

function WinLossDetailDialog({
  report,
  open,
  onClose,
}: {
  report: WinLossPatternRow;
  open: boolean;
  onClose: () => void;
}) {
  const lossReasons = parseLossReasons(report.top_loss_reasons);
  const total = report.total_leads_won + report.total_leads_lost;
  const winRate = total > 0 ? Math.round((report.total_leads_won / total) * 100) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Win/Loss Report — {formatPeriod(report.period_start, report.period_end)}
            {report.segment ? ` (${report.segment})` : ' (all segments)'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Stats row */}
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="text-shiroi-green font-semibold">
              Won: {report.total_leads_won} ({shortINR(Number(report.total_value_won))})
            </span>
            <span className="text-red-600 font-semibold">
              Lost: {report.total_leads_lost} ({shortINR(Number(report.total_value_lost))})
            </span>
            {winRate !== null && (
              <span className="text-n-600">Win rate: {winRate}%</span>
            )}
            <span className="text-n-400">Model: {report.ai_model}</span>
          </div>

          {/* AI narrative */}
          <div className="space-y-3 text-n-800 leading-relaxed">
            {report.ai_narrative.split('\n\n').map((para, i) => (
              <p key={i}>{para.trim()}</p>
            ))}
          </div>

          {/* Pricing insight */}
          {report.ai_pricing_insight && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">
                Pricing Insight
              </p>
              <p className="text-sm text-amber-900 leading-relaxed">
                {report.ai_pricing_insight}
              </p>
            </div>
          )}

          {/* Top loss reasons */}
          {lossReasons.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-n-700 uppercase tracking-wide mb-2">
                Top Loss Reasons
              </p>
              <ul className="space-y-1">
                {lossReasons.map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 text-xs font-bold">
                      {r.count}
                    </span>
                    <span className="text-n-700">{r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WinLossHistoryTable({ reports }: WinLossHistoryTableProps) {
  const [selectedReport, setSelectedReport] = React.useState<WinLossPatternRow | null>(null);

  return (
    <>
      <div className="rounded-lg border border-n-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-n-50 border-b border-n-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-n-600 text-xs uppercase tracking-wide">Period</th>
              <th className="text-left px-4 py-2.5 font-medium text-n-600 text-xs uppercase tracking-wide">Segment</th>
              <th className="text-right px-4 py-2.5 font-medium text-n-600 text-xs uppercase tracking-wide">Won/Lost</th>
              <th className="text-right px-4 py-2.5 font-medium text-n-600 text-xs uppercase tracking-wide">Win rate</th>
              <th className="text-left px-4 py-2.5 font-medium text-n-600 text-xs uppercase tracking-wide">Narrative excerpt</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n-100">
            {reports.map((report) => {
              const total = report.total_leads_won + report.total_leads_lost;
              const winRate = total > 0
                ? Math.round((report.total_leads_won / total) * 100)
                : null;
              const excerpt = report.ai_narrative.split('\n\n')[0]?.slice(0, 100) ?? '';

              return (
                <tr key={report.id} className="hover:bg-n-50 transition-colors">
                  <td className="px-4 py-3 text-n-800 whitespace-nowrap">
                    {formatPeriod(report.period_start, report.period_end)}
                  </td>
                  <td className="px-4 py-3 text-n-600">
                    {report.segment ?? 'All'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className="text-shiroi-green font-medium">{report.total_leads_won}W</span>
                    <span className="text-n-400 mx-1">/</span>
                    <span className="text-red-600 font-medium">{report.total_leads_lost}L</span>
                  </td>
                  <td className="px-4 py-3 text-right text-n-700">
                    {winRate !== null ? `${winRate}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-n-500 max-w-xs truncate">
                    {excerpt}…
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedReport(report)}
                    >
                      View full
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedReport && (
        <WinLossDetailDialog
          report={selectedReport}
          open={true}
          onClose={() => setSelectedReport(null)}
        />
      )}
    </>
  );
}
