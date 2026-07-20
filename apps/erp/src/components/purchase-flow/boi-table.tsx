'use client';

// =============================================================================
// BOI table (spec §5) — column order EXACTLY:
// [checkbox] · Project · Category · Item · Make · Qty · Units · Status · Rate ·
// Amount · Gst% · Total Amount · Vendor · Actions
// Footer: "TOTAL (filtered view)" = Σ Total Amount of visible rows (display-
// only; KPI money of record comes from the RPC). Sticky header anchors to the
// ListPageShell scroll region — NO overflow wrapper of its own (it would trap
// position: sticky). Inline edit per spec §2: Qty/Rate/Vendor swap in inputs
// (Enter/blur commit, Escape cancels); Status + GST are always-visible badge
// selects committing immediately. All commits go through updateBoiLineField
// and patch the returned fresh row (spec §12 — no full refetch).
// =============================================================================

import * as React from 'react';
import Decimal from 'decimal.js';
import { Pencil, Trash2 } from 'lucide-react';
import { Checkbox, cn, formatINR, useToast } from '@repo/ui';
import { updateBoiLineField } from '@/lib/purchase-flow-actions';
import {
  BOI_STATUSES,
  BOI_STATUS_COLORS,
  BOI_STATUS_LABELS,
  GST_OPTIONS,
  displayBoiStatus,
  type BoiEditableField,
  type BoiLineRow,
} from '@/lib/purchase-flow-constants';

const TH = 'px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider';

function prettyCategory(raw: string, labels: Record<string, string>): string {
  return labels[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Inline-editable cell (click → input; Enter/blur commit; Escape cancels)
// ---------------------------------------------------------------------------

function InlineCell({
  display,
  rawValue,
  type,
  disabled,
  align = 'left',
  onCommit,
}: {
  display: React.ReactNode;
  rawValue: string;
  type: 'number' | 'text';
  disabled: boolean;
  align?: 'left' | 'right';
  onCommit: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function commit() {
    const next = val.trim();
    setEditing(false);
    if (next === rawValue.trim()) return; // unchanged — no round-trip
    setSaving(true);
    await onCommit(next);
    setSaving(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className={cn(
          'h-6 w-full min-w-[64px] rounded border border-shiroi-gold bg-white px-1 text-xs focus:outline-none',
          align === 'right' && 'text-right font-mono',
        )}
      />
    );
  }

  return (
    <span
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? undefined : 0}
      title={disabled ? undefined : 'Click to edit'}
      onClick={() => {
        if (disabled || saving) return;
        setVal(rawValue);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (disabled || saving) return;
        if (e.key === 'Enter') {
          setVal(rawValue);
          setEditing(true);
        }
      }}
      className={cn(
        'block rounded px-0.5',
        align === 'right' && 'text-right',
        saving && 'opacity-50',
        !disabled &&
          'cursor-pointer hover:outline hover:outline-1 hover:outline-dashed hover:outline-violet-400',
      )}
    >
      {display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Always-visible badge select (Status / GST) — commits immediately; shows the
// picked value while the round-trip is in flight, reverts if the save fails
// (the row prop never changed).
// ---------------------------------------------------------------------------

function BadgeSelect({
  value,
  options,
  disabled,
  classNameFor,
  onCommit,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  classNameFor: (value: string) => string;
  onCommit: (value: string) => Promise<void>;
}) {
  const [pending, setPending] = React.useState<string | null>(null);
  const shown = pending ?? value;

  return (
    <select
      value={shown}
      disabled={disabled || pending !== null}
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
// Table
// ---------------------------------------------------------------------------

interface BoiTableProps {
  rows: BoiLineRow[];
  categoryLabels: Record<string, string>;
  showPrices: boolean;
  canWrite: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (row: BoiLineRow) => void;
  onDelete: (row: BoiLineRow) => void;
  /** Patch the fresh recalculated row into the workspace cache (spec §12). */
  onRowUpdated: (fresh: BoiLineRow) => void;
}

export function BoiTable({
  rows,
  categoryLabels,
  showPrices,
  canWrite,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onEdit,
  onDelete,
  onRowUpdated,
}: BoiTableProps) {
  const { addToast } = useToast();

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selectedIds.has(r.id));

  // Display-only footer sum of the visible rows (KPI money of record is the
  // RPC — this mirrors the sheet's "TOTAL (filtered view)" row).
  const filteredTotal = React.useMemo(
    () =>
      rows
        .reduce((acc, r) => acc.plus(r.total_price ?? 0), new Decimal(0))
        .toNumber(),
    [rows],
  );

  async function commitField(
    row: BoiLineRow,
    field: BoiEditableField,
    value: string | number,
  ) {
    const result = await updateBoiLineField(row.id, field, value);
    if (result.success) {
      onRowUpdated(result.data);
    } else {
      addToast({ variant: 'destructive', title: 'Save failed', description: result.error });
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-sm font-heading font-bold text-n-700">No Items Found</h2>
        <p className="mt-1 max-w-[320px] text-xs text-n-500">
          No BOI lines match your current filters.
        </p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
        <tr className="border-b border-n-200 bg-n-50 text-left">
          <th className={cn(TH, 'w-8')}>
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={onToggleAll}
              aria-label="Select all visible rows"
            />
          </th>
          <th className={TH}>Project</th>
          <th className={TH}>Category</th>
          <th className={TH}>Item</th>
          <th className={TH}>Make</th>
          <th className={cn(TH, 'text-right')}>Qty</th>
          <th className={TH}>Units</th>
          <th className={TH}>Status</th>
          {showPrices && <th className={cn(TH, 'text-right')}>Rate</th>}
          {showPrices && <th className={cn(TH, 'text-right')}>Amount</th>}
          {showPrices && <th className={TH}>Gst%</th>}
          {showPrices && <th className={cn(TH, 'text-right')}>Total Amount</th>}
          <th className={TH}>Vendor</th>
          <th className={cn(TH, 'w-16 text-center')}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const amount = new Decimal(row.quantity).mul(row.unit_price).toNumber();
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-n-100 transition-colors odd:bg-white even:bg-n-50/60 hover:bg-n-100/60',
                selectedIds.has(row.id) && 'bg-amber-50/70 odd:bg-amber-50/70 even:bg-amber-50/70',
              )}
            >
              <td className="px-2 py-1.5">
                <Checkbox
                  checked={selectedIds.has(row.id)}
                  onCheckedChange={() => onToggleRow(row.id)}
                  aria-label={`Select ${row.item_description}`}
                />
              </td>
              <td className="max-w-[160px] truncate px-2 py-1.5 text-n-700" title={row.project_display_name}>
                {row.project_display_name}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-n-600">
                {prettyCategory(row.item_category, categoryLabels)}
              </td>
              <td className="max-w-[240px] px-2 py-1.5 font-medium text-n-900">
                <span className="block truncate" title={row.item_description}>
                  {row.item_description}
                </span>
                {row.po_number && (
                  <span className="block text-[10px] text-n-400">{row.po_number}</span>
                )}
              </td>
              <td className="max-w-[120px] truncate px-2 py-1.5 text-n-600">
                {[row.brand, row.model].filter(Boolean).join(' ') || '—'}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-700">
                <InlineCell
                  display={row.quantity}
                  rawValue={String(row.quantity)}
                  type="number"
                  align="right"
                  disabled={!canWrite}
                  onCommit={(v) => commitField(row, 'quantity', Number(v))}
                />
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-n-500">{row.unit}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <BadgeSelect
                  value={displayBoiStatus(row.procurement_status)}
                  options={BOI_STATUSES.map((s) => ({ value: s, label: BOI_STATUS_LABELS[s] }))}
                  disabled={!canWrite}
                  classNameFor={(v) => BOI_STATUS_COLORS[displayBoiStatus(v)]}
                  onCommit={(v) => commitField(row, 'procurement_status', v)}
                />
              </td>
              {showPrices && (
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-700">
                  <InlineCell
                    display={formatINR(row.unit_price)}
                    rawValue={String(row.unit_price)}
                    type="number"
                    align="right"
                    disabled={!canWrite}
                    onCommit={(v) => commitField(row, 'unit_price', Number(v))}
                  />
                </td>
              )}
              {showPrices && (
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-n-500">
                  {formatINR(amount)}
                </td>
              )}
              {showPrices && (
                <td className="whitespace-nowrap px-2 py-1.5">
                  <BadgeSelect
                    value={String(row.gst_rate)}
                    options={GST_OPTIONS.map((g) => ({ value: String(g), label: `${g}%` }))}
                    disabled={!canWrite}
                    classNameFor={() => 'bg-n-100 text-n-700 border-n-200'}
                    onCommit={(v) => commitField(row, 'gst_rate', Number(v))}
                  />
                </td>
              )}
              {showPrices && (
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-medium text-n-900">
                  {formatINR(row.total_price)}
                </td>
              )}
              <td className="max-w-[140px] px-2 py-1.5 text-n-600">
                <InlineCell
                  display={row.vendor_name || <span className="text-n-300">—</span>}
                  rawValue={row.vendor_name ?? ''}
                  type="text"
                  disabled={!canWrite}
                  onCommit={(v) => commitField(row, 'vendor_name', v)}
                />
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <div className="flex items-center justify-center gap-0.5">
                  <button
                    type="button"
                    title="Edit item"
                    disabled={!canWrite}
                    onClick={() => onEdit(row)}
                    className="rounded p-1 text-n-400 hover:bg-n-100 hover:text-n-700 disabled:opacity-40"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete item"
                    disabled={!canWrite}
                    onClick={() => onDelete(row)}
                    className="rounded p-1 text-n-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
      {showPrices && (
        <tfoot>
          <tr className="border-t-2 border-n-200 bg-n-50 font-semibold">
            <td colSpan={11} className="px-2 py-2 text-right text-xs uppercase tracking-wider text-n-600">
              TOTAL (filtered view)
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-n-900">
              {formatINR(filteredTotal)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
    </table>
  );
}
