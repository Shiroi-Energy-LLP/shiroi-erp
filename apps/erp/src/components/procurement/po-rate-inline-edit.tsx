'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { formatINR } from '@repo/ui/formatters';
import { updatePoLineItemRate } from '@/lib/po-actions';

interface PoRateInlineEditProps {
  poId: string;
  itemId: string;
  currentRate: number;
}

export function PoRateInlineEdit({ poId, itemId, currentRate }: PoRateInlineEditProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(currentRate.toString());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSave() {
    const num = parseFloat(value);
    if (isNaN(num) || num === currentRate) {
      setEditing(false);
      setValue(currentRate.toString());
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updatePoLineItemRate({ poId, itemId, newRate: num });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Save failed');
    }
  }

  if (!editing) {
    return (
      <span
        className="font-mono cursor-pointer hover:bg-p-50 rounded px-1 -mx-1 transition-colors"
        onDoubleClick={() => { setEditing(true); setValue(currentRate.toString()); }}
        title="Double-click to edit rate"
      >
        {formatINR(currentRate)}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="number"
        step="0.01"
        min="0"
        className="text-xs h-7 w-[90px] text-right font-mono border border-gray-300 rounded px-1 focus:outline-none focus:ring-1 focus:ring-p-400"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setEditing(false);
            setValue(currentRate.toString());
            setError(null);
          }
        }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-green-600 text-xs hover:text-green-700 disabled:opacity-50 px-1"
        title="Save"
      >
        {saving ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setEditing(false); setValue(currentRate.toString()); setError(null); }}
        className="text-gray-400 text-xs hover:text-gray-600 px-1"
        title="Cancel"
      >
        ✕
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
