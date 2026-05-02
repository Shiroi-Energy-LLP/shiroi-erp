'use client';

// apps/erp/src/app/(erp)/data-review/projects/_components/audit-log-tab.tsx
// Audit log with [Undo] button (founder + marketing_manager only).
// Client component that fetches on mount and paginates.

import { useState, useEffect, useTransition } from 'react';
import { Badge, Button, Card, CardContent, useToast } from '@repo/ui';
import { Loader2 } from 'lucide-react';
import { formatINR } from '@repo/ui/formatters';
import type { ProjectReviewAuditRow } from '@/lib/data-review-queries';
import { getProjectReviewAudit } from '@/lib/data-review-queries';
import { undoLastDecision } from '@/lib/data-review-actions';

const PAGE_SIZE = 30;

export function AuditLogTab() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<ProjectReviewAuditRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [undoing, startUndo] = useTransition();
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const result = await getProjectReviewAudit({ page: p, pageSize: PAGE_SIZE });
      setRows(result.rows);
      setTotalRows(result.totalRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(page); }, [page]);

  const handleUndo = (row: ProjectReviewAuditRow) => {
    setUndoingId(row.project_id);
    startUndo(async () => {
      const result = await undoLastDecision({ projectId: row.project_id });
      setUndoingId(null);
      if (!result.success) {
        addToast({ title: result.error ?? 'Undo failed', variant: 'destructive' });
        return;
      }
      addToast({ title: `Undo applied for ${row.project_number}`, variant: 'success' });
      load(page);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[#7C818E]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading audit log…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-[#7C818E]">
          No decisions logged yet.
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[#E5E7EB] overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1.5fr_2fr_2fr_3fr_1.5fr_1fr] gap-3 bg-[#F9FAFB] px-4 py-2 text-xs font-semibold text-[#7C818E] uppercase tracking-wide">
          <span>Date</span>
          <span>Project #</span>
          <span>Customer</span>
          <span>Decision</span>
          <span>By</span>
          <span />
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className="border-t border-[#E5E7EB] grid grid-cols-[1.5fr_2fr_2fr_3fr_1.5fr_1fr] gap-3 px-4 py-3 items-start"
          >
            {/* Date */}
            <span className="text-xs text-[#7C818E]">
              {new Date(row.made_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>

            {/* Project # */}
            <span className="font-mono text-xs text-[#1A1D24]">{row.project_number}</span>

            {/* Customer */}
            <span className="text-xs text-[#1A1D24] truncate">{row.customer_name}</span>

            {/* Decision details */}
            <div className="space-y-0.5">
              <DecisionChip decision={row.decision} />
              {row.decision === 'confirmed' && (
                <p className="text-[10px] text-[#7C818E]">
                  {row.prev_size_kwp !== row.new_size_kwp && (
                    <span>kWp: {row.prev_size_kwp} → {row.new_size_kwp} · </span>
                  )}
                  {row.prev_contracted_value !== row.new_contracted_value && row.new_contracted_value !== null && (
                    <span>₹: {formatINR(row.prev_contracted_value ?? 0)} → {formatINR(row.new_contracted_value)}</span>
                  )}
                </p>
              )}
              {row.decision === 'duplicate' && (
                <p className="text-[10px] text-[#7C818E]">
                  Score: {row.losing_score} (this) vs {row.winning_score} (kept)
                  {row.notes && ` · ${row.notes}`}
                </p>
              )}
            </div>

            {/* Made by (UUID short) */}
            <span className="font-mono text-[10px] text-[#7C818E]">
              {row.made_by.slice(0, 8)}…
            </span>

            {/* Undo */}
            <div className="flex justify-end">
              {row.decision !== 'undo' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  disabled={undoing && undoingId === row.project_id}
                  onClick={() => handleUndo(row)}
                >
                  {undoing && undoingId === row.project_id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Undo'
                  )}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-[#7C818E]">
          <span>Page {page + 1} of {totalPages} ({totalRows} total)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionChip({ decision }: { decision: 'confirmed' | 'duplicate' | 'undo' }) {
  if (decision === 'confirmed') {
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1.5 py-0">confirmed</Badge>;
  }
  if (decision === 'duplicate') {
    return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] px-1.5 py-0">duplicate</Badge>;
  }
  return <Badge className="bg-gray-100 text-gray-700 border-gray-200 text-[10px] px-1.5 py-0">undo</Badge>;
}
