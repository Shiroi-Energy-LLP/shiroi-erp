'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge, Button, Input,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  shortINR,
} from '@repo/ui';
import {
  confirmReconciliation, rejectReconciliation, updateResolvedYear, updatePreferredSource,
} from '@/lib/reconciliation-actions';
import type { ReconViewRow, ReconSummary } from '@/lib/reconciliation-queries';

type TabKey = 'needs_review' | 'auto' | 'erp_only' | 'confirmed' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'auto', label: 'Auto-matched' },
  { key: 'erp_only', label: 'ERP-only (≤2021)' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'all', label: 'All' },
];

function methodBadge(m: string | null): string {
  switch (m) {
    case 'auto': return 'bg-emerald-100 text-emerald-800';
    case 'likely': return 'bg-sky-100 text-sky-800';
    case 'ambiguous': return 'bg-amber-100 text-amber-900';
    case 'erp_only': return 'bg-slate-100 text-slate-700';
    case 'sheet_only': return 'bg-purple-100 text-purple-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

function filterRows(rows: ReconViewRow[], tab: TabKey): ReconViewRow[] {
  switch (tab) {
    case 'needs_review':
      return rows.filter((r) => r.status === 'proposed' && (r.matchMethod === 'ambiguous' || r.matchMethod === 'likely'));
    case 'auto':
      return rows.filter((r) => r.matchMethod === 'auto');
    case 'erp_only':
      return rows.filter((r) => r.matchMethod === 'erp_only');
    case 'confirmed':
      return rows.filter((r) => r.status === 'confirmed');
    case 'all':
    default:
      return rows;
  }
}

export function ReconciliationClient({ rows, summary }: { rows: ReconViewRow[]; summary: ReconSummary }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<TabKey>('needs_review');
  const [pending, startTransition] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const visible = React.useMemo(() => filterRows(rows, tab).slice(0, 400), [rows, tab]);

  function run(projectId: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusyId(projectId);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? 'Action failed');
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = filterRows(rows, t.key).length;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                'rounded-full px-3 py-1 text-sm font-medium transition ' +
                (active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
              }
            >
              {t.label} <span className="opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ERP project</TableHead>
              <TableHead>Sheet match</TableHead>
              <TableHead>Match</TableHead>
              <TableHead className="text-right">Sheet ₹ / ERP ₹</TableHead>
              <TableHead className="text-center">Year</TableHead>
              <TableHead className="text-center">Trust</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.projectId} className={r.valueFlag || r.yearFlag ? 'bg-amber-50/50' : undefined}>
                <TableCell>
                  <div className="font-medium">{r.erpName}</div>
                  <div className="text-xs text-slate-500">
                    {r.erpNumber ?? '—'} · {r.erpSize ?? '?'} kWp · {r.erpStatus ?? '—'}
                  </div>
                </TableCell>
                <TableCell>
                  {r.sheetName ? (
                    <>
                      <div>{r.sheetName}</div>
                      <div className="text-xs text-slate-500">{r.sheetSize ?? '?'} kWp · sheet yr {r.sheetYear ?? '—'}</div>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">— no sheet match —</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={'rounded px-2 py-0.5 text-xs font-medium ' + methodBadge(r.matchMethod)}>
                    {r.matchMethod ?? '—'}
                  </span>
                  {r.matchScore != null && <div className="mt-0.5 text-xs text-slate-400">score {r.matchScore}</div>}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <div className={r.valueFlag ? 'font-semibold text-amber-700' : ''}>
                    {r.sheetProjectCost != null ? shortINR(r.sheetProjectCost) : '—'}
                  </div>
                  <div className="text-xs text-slate-500">{r.revenueErp != null ? shortINR(r.revenueErp) : '—'}</div>
                </TableCell>
                <TableCell className="text-center">
                  <Input
                    type="number"
                    defaultValue={r.resolvedYear ?? ''}
                    className={'h-8 w-20 text-center ' + (r.yearFlag ? 'border-amber-400' : '')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value;
                        run(r.projectId, () => updateResolvedYear(r.projectId, v ? Number(v) : null));
                      }
                    }}
                    onBlur={(e) => {
                      const v = e.target.value;
                      const next = v ? Number(v) : null;
                      if (next !== r.resolvedYear) run(r.projectId, () => updateResolvedYear(r.projectId, next));
                    }}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <div className="inline-flex overflow-hidden rounded border text-xs">
                    {(['erp', 'sheet'] as const).map((src) => (
                      <button
                        key={src}
                        disabled={pending}
                        onClick={() => run(r.projectId, () => updatePreferredSource(r.projectId, src))}
                        className={
                          'px-2 py-1 ' +
                          (r.preferredSource === src ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100')
                        }
                      >
                        {src.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge
                    className={
                      r.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
                        : r.status === 'rejected' ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                    }
                  >
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      className="h-8 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700"
                      disabled={pending && busyId === r.projectId}
                      onClick={() => run(r.projectId, () => confirmReconciliation(r.projectId))}
                    >
                      Confirm
                    </Button>
                    <Button
                      className="h-8 bg-white px-2 text-xs text-red-600 ring-1 ring-red-200 hover:bg-red-50"
                      disabled={pending && busyId === r.projectId}
                      onClick={() => run(r.projectId, () => rejectReconciliation(r.projectId))}
                    >
                      Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                  Nothing in this bucket.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-slate-400">
        Showing {visible.length} of {filterRows(rows, tab).length} in this bucket · {summary.total} projects total.
        Edits save to the reconciliation table only; applying confirmed values back to projects is a later step.
      </p>
    </div>
  );
}
