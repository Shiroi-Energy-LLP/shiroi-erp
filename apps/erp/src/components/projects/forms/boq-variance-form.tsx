'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { RefreshCw, Save } from 'lucide-react';
import { seedBoqFromBom, updateCostVariance, updateBoqItemStatus } from '@/lib/project-step-actions';

interface BoqActionsProps {
  projectId: string;
  hasBomLines: boolean;
  hasVariances: boolean;
}

export function BoqSeedButton({ projectId, hasBomLines, hasVariances }: BoqActionsProps) {
  const router = useRouter();
  const [seeding, setSeeding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (hasVariances || !hasBomLines) return null;

  async function handleSeed() {
    setSeeding(true);
    setError(null);
    const result = await seedBoqFromBom({ projectId });
    setSeeding(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to seed BOQ from BOM');
    }
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <Button size="sm" onClick={handleSeed} disabled={seeding}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${seeding ? 'animate-spin' : ''}`} />
        {seeding ? 'Generating...' : 'Generate BOQ from BOM'}
      </Button>
      <span className="text-xs text-n-500">
        Auto-creates cost entries from BOM categories. You only need to fill in actual costs.
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// BOQ item status dropdown — used in step-boq.tsx
const BOQ_STATUS_OPTIONS = [
  { value: 'yet_to_finalize', label: 'Yet to Finalize' },
  { value: 'yet_to_place', label: 'Yet to Place' },
  { value: 'order_placed', label: 'Order Placed' },
  { value: 'received', label: 'Received' },
  { value: 'ready_to_dispatch', label: 'Ready to Dispatch' },
  { value: 'delivered', label: 'Delivered' },
];

const STATUS_DOT_COLORS: Record<string, string> = {
  yet_to_finalize: '#7C818E',
  yet_to_place: '#B45309',
  order_placed: '#2563EB',
  received: '#059669',
  ready_to_dispatch: '#7C3AED',
  delivered: '#00B050',
};

interface BoqItemStatusSelectProps {
  projectId: string;
  itemId: string;
  currentStatus: string;
}

export function BoqItemStatusSelect({ projectId, itemId, currentStatus }: BoqItemStatusSelectProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    if (newStatus === currentStatus) return;
    setSaving(true);
    const result = await updateBoqItemStatus({ projectId, itemId, status: newStatus });
    setSaving(false);
    if (result.success) {
      router.refresh();
    }
  }

  const dotColor = STATUS_DOT_COLORS[currentStatus] ?? '#7C818E';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <select
        value={currentStatus}
        onChange={handleChange}
        disabled={saving}
        className="text-xs bg-transparent border-0 cursor-pointer focus:ring-1 focus:ring-p-300 rounded px-1 py-0.5 -ml-1 appearance-none pr-4"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237C818E' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 2px center',
        }}
      >
        {BOQ_STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {saving && <span className="text-[10px] text-n-400">…</span>}
    </div>
  );
}

// Inline actual cost editor for each row (legacy cost variance view)
interface BoqInlineEditProps {
  projectId: string;
  varianceId: string;
  currentActual: number;
  currentNotes: string | null;
}

export function BoqActualCostEdit({ projectId, varianceId, currentActual, currentNotes }: BoqInlineEditProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [actualCost, setActualCost] = React.useState(currentActual.toString());
  const [notes, setNotes] = React.useState(currentNotes ?? '');
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updateCostVariance({
      projectId,
      varianceId,
      actual_cost: parseFloat(actualCost) || 0,
      notes: notes || null,
    });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  if (!editing) {
    return (
      <span
        className="font-mono cursor-pointer hover:bg-p-50 rounded px-1 -mx-1 transition-colors"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
      >
        {formatINR(currentActual)}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={actualCost}
        onChange={(e) => setActualCost(e.target.value)}
        type="number"
        step="0.01"
        className="text-xs h-7 w-[100px] text-right font-mono"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSave} disabled={saving}>
        <Save className="h-3 w-3" />
      </Button>
    </div>
  );
}
