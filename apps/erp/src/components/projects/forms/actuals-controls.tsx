'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@repo/ui';
import { Lock, Unlock, Check } from 'lucide-react';
import { lockProjectActuals, unlockProjectActuals, updateBoqItemQuantity } from '@/lib/project-step-actions';

// ── Lock / Unlock Actuals Button ──

export function ActualsLockButton({
  projectId,
  isLocked,
  lockedByName,
  lockedAt,
}: {
  projectId: string;
  isLocked: boolean;
  lockedByName?: string | null;
  lockedAt?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleToggle() {
    if (isLocked) {
      if (!confirm('Unlock project actuals? This will allow editing BOQ quantities and site expenses.')) return;
      setLoading(true);
      setError(null);
      const result = await unlockProjectActuals({ projectId });
      setLoading(false);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error ?? 'Failed to unlock');
      }
    } else {
      if (!confirm(
        'Lock project actuals?\n\n' +
        'This will make BOI, BOQ, and Actuals read-only.\n' +
        'Only the Project Manager can unlock later if corrections are needed.'
      )) return;
      setLoading(true);
      setError(null);
      const result = await lockProjectActuals({ projectId });
      setLoading(false);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error ?? 'Failed to lock');
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={isLocked ? 'outline' : 'default'}
        onClick={handleToggle}
        disabled={loading}
        className={`text-xs ${isLocked ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : ''}`}
      >
        {isLocked ? (
          <>
            <Unlock className="h-3.5 w-3.5 mr-1" />
            {loading ? '...' : 'Unlock Actuals'}
          </>
        ) : (
          <>
            <Lock className="h-3.5 w-3.5 mr-1" />
            {loading ? '...' : 'Lock & Complete'}
          </>
        )}
      </Button>
      {isLocked && lockedByName && (
        <span className="text-[10px] text-n-500">
          Locked by {lockedByName}
          {lockedAt ? ` on ${new Date(lockedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
        </span>
      )}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

// ── Editable BOQ Quantity Cell ──

export function EditableQtyCell({
  projectId,
  itemId,
  quantity,
  unit,
  isLocked,
}: {
  projectId: string;
  itemId: string;
  quantity: number;
  unit: string;
  isLocked: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [value, setValue] = React.useState(quantity.toString());

  if (isLocked) {
    return <span className="font-mono">{quantity} {unit}</span>;
  }

  if (!editing) {
    return (
      <span
        className="font-mono cursor-pointer hover:bg-p-50 rounded px-1 py-0.5 -mx-1"
        onClick={() => { setValue(quantity.toString()); setEditing(true); }}
        title="Click to edit quantity"
      >
        {quantity} {unit}
      </span>
    );
  }

  async function handleSave() {
    const newQty = parseFloat(value);
    if (isNaN(newQty) || newQty < 0) return;
    if (newQty === quantity) {
      setEditing(false);
      return;
    }

    setSaving(true);
    const result = await updateBoqItemQuantity({ projectId, itemId, newQuantity: newQty });
    setSaving(false);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        min="0"
        step="any"
        autoFocus
        className="h-6 w-[70px] text-xs text-right font-mono"
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <span className="text-[10px] text-n-500">{unit}</span>
      <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-700">
        <Check className="h-3 w-3" />
      </button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-n-400">✕</button>
    </div>
  );
}
