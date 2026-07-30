'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@repo/ui';
import { updateCellValue } from '@/lib/inline-edit-actions';
import { DataFlagButton } from '@/components/data-flag-button';
import { formatINR as formatINRBase } from '@repo/ui/formatters';
import { bomCategoryLabel } from '@/lib/bom-review-constants';
import type { BomReviewLine } from '@/lib/bom-review-queries';

const NUMERIC_FIELDS = ['quantity', 'unit_price', 'gst_rate'];

interface BomReviewTableProps {
  data: BomReviewLine[];
  /** Row numbering continues across pages. */
  startIndex?: number;
}

/**
 * Every column wraps — the table deliberately has NO overflow wrapper, both so
 * long item descriptions stay fully visible without horizontal scrolling and so
 * the sticky <thead> can anchor to ListPageShell's scroll container (an
 * intermediate overflow box would trap `position: sticky`).
 */
export function BomReviewTable({ data, startIndex = 0 }: BomReviewTableProps) {
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleDoubleClick = (rowId: string, field: string, currentValue: string | number | null) => {
    setEditingCell({ rowId, field });
    setEditValue(String(currentValue ?? ''));
  };

  const handleSave = () => {
    if (!editingCell) return;
    const { rowId, field } = editingCell;
    const value = NUMERIC_FIELDS.includes(field) ? parseFloat(editValue) || 0 : editValue;

    startTransition(async () => {
      await updateCellValue({ entityType: 'bom_items', rowId, field, value });
      setEditingCell(null);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const renderCell = (row: BomReviewLine, field: string, displayValue: string | number | null) => {
    const isEditing = editingCell?.rowId === row.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="w-full rounded border border-shiroi-gold px-2 py-1 text-sm focus:outline-none"
          disabled={isPending}
        />
      );
    }

    return (
      <span
        onDoubleClick={() => handleDoubleClick(row.id, field, displayValue)}
        className="-mx-1 block cursor-pointer rounded px-1 py-0.5 hover:bg-shiroi-gold/10"
        title="Double-click to edit"
      >
        {displayValue === null || displayValue === '' ? '—' : displayValue}
      </span>
    );
  };

  const formatINR = (amount: number) => (amount > 0 ? formatINRBase(amount) : '—');

  const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-n-500';

  return (
    <table className="w-full table-fixed text-sm [&_td]:align-top">
      <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
        <tr className="border-b border-n-200 bg-n-50">
          <th className={`${th} w-12`}>#</th>
          <th className={`${th} w-[26%]`}>Item Description</th>
          <th className={`${th} w-[10%]`}>Category</th>
          <th className={`${th} w-[7%]`}>Qty</th>
          <th className={`${th} w-[7%]`}>Unit</th>
          <th className={`${th} w-[10%]`}>Rate</th>
          <th className={`${th} w-[6%]`}>GST %</th>
          <th className={`${th} w-[10%]`}>Total</th>
          <th className={`${th} w-[10%]`}>Brand</th>
          <th className={`${th} w-[10%]`}>Proposal</th>
          <th className={`${th} w-12`}>Flag</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row, idx) => (
          <tr
            key={row.id}
            className="border-b border-n-100 last:border-0 odd:bg-white even:bg-n-50/40 hover:bg-shiroi-gold/5"
          >
            <td className="px-3 py-2.5 text-xs text-n-400 tabular-nums">{startIndex + idx + 1}</td>
            <td className="whitespace-normal break-words px-3 py-2.5 text-n-800">
              {renderCell(row, 'item_description', row.item_description)}
            </td>
            <td className="px-3 py-2.5">
              <Badge variant="outline" className="whitespace-normal text-left text-[11px]">
                {bomCategoryLabel(row.item_category)}
              </Badge>
            </td>
            <td className="px-3 py-2.5 tabular-nums">
              {renderCell(row, 'quantity', row.quantity)}
            </td>
            <td className="whitespace-normal break-words px-3 py-2.5">
              {renderCell(row, 'unit', row.unit)}
            </td>
            <td className="px-3 py-2.5 tabular-nums">
              {renderCell(row, 'unit_price', row.unit_price > 0 ? formatINR(row.unit_price) : '—')}
            </td>
            <td className="px-3 py-2.5 tabular-nums">
              {renderCell(row, 'gst_rate', row.gst_rate)}
            </td>
            <td className="px-3 py-2.5 text-n-600 tabular-nums">
              {formatINR(row.total_price)}
            </td>
            <td className="whitespace-normal break-words px-3 py-2.5 text-n-600">
              {renderCell(row, 'brand', row.brand)}
            </td>
            <td className="whitespace-normal break-words px-3 py-2.5 text-xs text-n-500">
              {row.proposals?.proposal_number ?? '—'}
            </td>
            <td className="px-3 py-2.5">
              <DataFlagButton entityType="bom_item" entityId={row.id} compact />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
