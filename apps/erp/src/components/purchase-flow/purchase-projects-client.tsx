'use client';

// =============================================================================
// Purchase projects rollup client (spec §3, adapted per locked decisions):
// Project · System Size · Project Budget (contracted_value, READ-ONLY —
// deliberate delta from the sheet's editable budget) · BOI Total · Expenses ·
// Profit % (red when negative) · Procurement Status · Priority · Actions.
// Status + Priority are editable badge-selects → updateProjectProcurement.
// Client-side name search; KPI money comes pre-summed from the server page.
// Quick-links: 🧾 → /purchase?project=<id> · 💰 → /expenses (the expenses
// page has no project filter param — link lands unfiltered, noted in title).
// =============================================================================

import * as React from 'react';
import Link from 'next/link';
import { Receipt, ScrollText } from 'lucide-react';
import { Button, Input, KpiCard, cn, formatINR, useToast } from '@repo/ui';
import { ListPageShell } from '@/components/list-page-shell';
import { updateProjectProcurement } from '@/lib/purchase-flow-actions';
import {
  PROJECT_PROCUREMENT_PRIORITIES,
  PROJECT_PROCUREMENT_PRIORITY_COLORS,
  PROJECT_PROCUREMENT_PRIORITY_LABELS,
  PROJECT_PROCUREMENT_STATUSES,
  PROJECT_PROCUREMENT_STATUS_COLORS,
  PROJECT_PROCUREMENT_STATUS_LABELS,
  isProjectProcurementPriority,
  isProjectProcurementStatus,
  type ProjectProcurementPriority,
  type ProjectProcurementStatus,
} from '@/lib/purchase-flow-constants';
import type { PurchaseRollupRow } from '@/lib/purchase-flow-queries';

const TH = 'px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider';

interface PurchaseProjectsKpis {
  projectCount: number;
  totalBudget: number;
  totalBoi: number;
  totalExpenses: number;
}

interface PurchaseProjectsClientProps {
  rows: PurchaseRollupRow[];
  kpis: PurchaseProjectsKpis;
  canWrite: boolean;
}

// ---------------------------------------------------------------------------
// Always-visible badge select (same behavior as the BOI table's: shows the
// picked value while the round-trip is in flight, reverts if the save fails).
// ---------------------------------------------------------------------------

function BadgeSelect({
  value,
  options,
  disabled,
  ariaLabel,
  classNameFor,
  onCommit,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  ariaLabel: string;
  classNameFor: (value: string) => string;
  onCommit: (value: string) => Promise<void>;
}) {
  const [pending, setPending] = React.useState<string | null>(null);
  const shown = pending ?? value;

  return (
    <select
      value={shown}
      disabled={disabled || pending !== null}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = e.target.value;
        setPending(next);
        void onCommit(next).finally(() => setPending(null));
      }}
      className={cn(
        'cursor-pointer appearance-none rounded-full border px-2 py-0.5 text-[11px] font-semibold focus:outline-none disabled:cursor-not-allowed',
        pending !== null && 'opacity-60',
        classNameFor(shown),
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------

export function PurchaseProjectsClient({
  rows: initialRows,
  kpis,
  canWrite,
}: PurchaseProjectsClientProps) {
  const { addToast } = useToast();

  const [rows, setRows] = React.useState(initialRows);
  React.useEffect(() => setRows(initialRows), [initialRows]);

  const [search, setSearch] = React.useState('');
  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(
    () => (q ? rows.filter((r) => r.project_name.toLowerCase().includes(q)) : rows),
    [rows, q],
  );

  async function commitStatus(row: PurchaseRollupRow, raw: string) {
    const next: ProjectProcurementStatus | null = isProjectProcurementStatus(raw) ? raw : null;
    const result = await updateProjectProcurement(row.project_id, { status: next });
    if (result.success) {
      setRows((prev) =>
        prev.map((r) =>
          r.project_id === row.project_id ? { ...r, procurement_status: next } : r,
        ),
      );
    } else {
      addToast({ variant: 'destructive', title: 'Save failed', description: result.error });
    }
  }

  async function commitPriority(row: PurchaseRollupRow, raw: string) {
    if (!isProjectProcurementPriority(raw)) return;
    const next: ProjectProcurementPriority = raw;
    const result = await updateProjectProcurement(row.project_id, { priority: next });
    if (result.success) {
      setRows((prev) =>
        prev.map((r) =>
          r.project_id === row.project_id ? { ...r, procurement_priority: next } : r,
        ),
      );
    } else {
      addToast({ variant: 'destructive', title: 'Save failed', description: result.error });
    }
  }

  return (
    <ListPageShell
      header={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project name…"
            className="h-8 w-64 text-xs"
            aria-label="Search projects"
          />
          {search && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setSearch('')}
            >
              Clear
            </Button>
          )}
        </div>
      }
    >
      <h1 className="text-lg font-heading font-bold text-n-900">
        Purchase Projects{' '}
        <span className="text-sm font-normal text-n-500">({filtered.length} projects)</span>
      </h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Projects" value={kpis.projectCount} icon="HardHat" />
        <KpiCard label="Total Project Budget" value={formatINR(kpis.totalBudget)} icon="DollarSign" />
        <KpiCard label="Total BOI Cost" value={formatINR(kpis.totalBoi)} icon="ClipboardList" />
        <KpiCard label="Total Expenses" value={formatINR(kpis.totalExpenses)} icon="Package" />
      </div>

      <div className="rounded-lg border border-n-200 bg-white">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h2 className="text-sm font-heading font-bold text-n-700">No Projects Found</h2>
            <p className="mt-1 max-w-[340px] text-xs text-n-500">
              {q
                ? 'No projects match your search.'
                : 'Projects appear here once they have Bill of Items lines or expenses.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
              <tr className="border-b border-n-200 bg-n-50 text-left">
                <th className={TH}>Project</th>
                <th className={cn(TH, 'text-right')}>System Size</th>
                <th className={cn(TH, 'text-right')}>Project Budget</th>
                <th className={cn(TH, 'text-right')}>BOI Total</th>
                <th className={cn(TH, 'text-right')}>Expenses</th>
                <th className={cn(TH, 'text-right')}>Profit %</th>
                <th className={TH}>Procurement Status</th>
                <th className={TH}>Priority</th>
                <th className={cn(TH, 'w-16 text-center')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const negative = (r.profit_pct ?? 0) < 0;
                return (
                  <tr
                    key={r.project_id}
                    className="border-b border-n-100 transition-colors odd:bg-white even:bg-n-50/60 hover:bg-n-100/60"
                  >
                    <td className="max-w-[240px] truncate px-2 py-1.5 font-medium text-n-900" title={r.project_name}>
                      {r.project_name}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-600">
                      {r.system_size ? `${r.system_size} kWp` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-700">
                      {formatINR(r.project_budget ?? 0)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-700">
                      {formatINR(r.boi_total ?? 0)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-700">
                      {formatINR(r.expenses_total ?? 0)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap px-2 py-1.5 text-right font-mono font-medium',
                        negative ? 'text-red-600' : 'text-n-900',
                      )}
                    >
                      {(r.profit_pct ?? 0).toFixed(2)}%
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <BadgeSelect
                        value={r.procurement_status ?? ''}
                        options={[
                          { value: '', label: '—' },
                          ...PROJECT_PROCUREMENT_STATUSES.map((s) => ({
                            value: s,
                            label: PROJECT_PROCUREMENT_STATUS_LABELS[s],
                          })),
                        ]}
                        disabled={!canWrite}
                        ariaLabel={`Procurement status for ${r.project_name}`}
                        classNameFor={(v) =>
                          isProjectProcurementStatus(v)
                            ? PROJECT_PROCUREMENT_STATUS_COLORS[v]
                            : 'bg-n-100 text-n-500 border-n-200'
                        }
                        onCommit={(v) => commitStatus(r, v)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <BadgeSelect
                        value={r.procurement_priority ?? 'medium'}
                        options={PROJECT_PROCUREMENT_PRIORITIES.map((p) => ({
                          value: p,
                          label: PROJECT_PROCUREMENT_PRIORITY_LABELS[p],
                        }))}
                        disabled={!canWrite}
                        ariaLabel={`Procurement priority for ${r.project_name}`}
                        classNameFor={(v) =>
                          isProjectProcurementPriority(v)
                            ? PROJECT_PROCUREMENT_PRIORITY_COLORS[v]
                            : 'bg-n-100 text-n-500 border-n-200'
                        }
                        onCommit={(v) => commitPriority(r, v)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex items-center justify-center gap-0.5">
                        <Link
                          href={`/purchase?project=${r.project_id}`}
                          title="View Bill of Items for this project"
                          className="rounded p-1 text-n-400 hover:bg-n-100 hover:text-n-700"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                        </Link>
                        {/* /expenses has no project filter param — lands unfiltered. */}
                        <Link
                          href="/expenses"
                          title="Open Expenses (no project filter available)"
                          className="rounded p-1 text-n-400 hover:bg-n-100 hover:text-n-700"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ListPageShell>
  );
}
