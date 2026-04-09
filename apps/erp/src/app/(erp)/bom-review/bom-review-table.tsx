'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@repo/ui';
import { updateCellValue } from '@/lib/inline-edit-actions';
import { DataFlagButton } from '@/components/data-flag-button';

const CATEGORY_LABELS: Record<string, string> = {
  panel: 'Panel', inverter: 'Inverter', battery: 'Battery', structure: 'Structure',
  dc_cable: 'DC Cable', ac_cable: 'AC Cable', conduit: 'Conduit', earthing: 'Earthing',
  acdb: 'ACDB', dcdb: 'DCDB', net_meter: 'Net Meter', civil_work: 'Civil Work',
  installation_labour: 'I&C Labour', transport: 'Transport', other: 'Other',
  solar_panels: 'Solar Panels', mms: 'MMS', dc_accessories: 'DC Acc.',
  ac_accessories: 'AC Acc.', conduits: 'Conduits', miscellaneous: 'Misc',
  safety: 'Safety', generation_meter: 'Gen Meter',
  installation_and_commissioning: 'I&C', statutory: 'Statutory',
  transport_and_civil: 'Transport & Civil', others: 'Others',
};

interface BomLine {
  id: string;
  item_description: string;
  item_category: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  gst_rate: number;
  brand: string | null;
  proposals?: { proposal_number: string } | null;
}

export function BomReviewTable({ data }: { data: BomLine[] }) {
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
    const numericFields = ['quantity', 'unit_price', 'gst_rate'];
    const value = numericFields.includes(field) ? parseFloat(editValue) || 0 : editValue;

    startTransition(async () => {
      await updateCellValue({ entityType: 'bom_items', rowId, field, value });
      setEditingCell(null);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const renderCell = (row: BomLine, field: string, displayValue: string | number | null) => {
    const isEditing = editingCell?.rowId === row.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="w-full rounded border border-[#00B050] px-2 py-1 text-sm focus:outline-none"
          disabled={isPending}
        />
      );
    }

    return (
      <span
        onDoubleClick={() => handleDoubleClick(row.id, field, displayValue)}
        className="cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded inline-block"
        title="Double-click to edit"
      >
        {displayValue ?? '—'}
      </span>
    );
  };

  const formatINR = (amount: number) =>
    amount > 0 ? `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs font-medium text-[#7C818E]">
            <th className="px-3 py-2 w-8">#</th>
            <th className="px-3 py-2 min-w-[200px]">Item Description</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2">Rate</th>
            <th className="px-3 py-2">GST %</th>
            <th className="px-3 py-2">Total</th>
            <th className="px-3 py-2">Brand</th>
            <th className="px-3 py-2">Proposal</th>
            <th className="px-3 py-2 w-10">Flag</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50/50">
              <td className="px-3 py-2 text-xs text-gray-400">{idx + 1}</td>
              <td className="px-3 py-2">
                {renderCell(row, 'item_description', row.item_description)}
              </td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-xs">
                  {CATEGORY_LABELS[row.item_category] ?? row.item_category}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {renderCell(row, 'quantity', row.quantity)}
              </td>
              <td className="px-3 py-2">
                {renderCell(row, 'unit', row.unit)}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {renderCell(row, 'unit_price', row.unit_price > 0 ? formatINR(row.unit_price) : '—')}
              </td>
              <td className="px-3 py-2">
                {renderCell(row, 'gst_rate', row.gst_rate)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-gray-600">
                {formatINR(row.total_price)}
              </td>
              <td className="px-3 py-2 text-xs text-gray-500">
                {renderCell(row, 'brand', row.brand)}
              </td>
              <td className="px-3 py-2 text-xs text-gray-500">
                {(row.proposals as any)?.proposal_number ?? '—'}
              </td>
              <td className="px-3 py-2">
                <DataFlagButton
                  entityType="bom_item"
                  entityId={row.id}
                  compact
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
