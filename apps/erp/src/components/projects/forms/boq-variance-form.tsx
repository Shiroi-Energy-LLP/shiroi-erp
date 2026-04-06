'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { RefreshCw, Save } from 'lucide-react';
import { seedBoqFromBom, updateCostVariance } from '@/lib/project-step-actions';

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

// Inline actual cost editor for each row
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
