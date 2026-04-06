'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { Plus } from 'lucide-react';
import { addCostVariance, updateCostVariance } from '@/lib/project-step-actions';

interface BoqVarianceFormProps {
  projectId: string;
  existingVariances: {
    id: string;
    item_category: string;
    estimated_cost: number;
    actual_cost: number;
  }[];
}

const COST_CATEGORIES = [
  'Solar Panels',
  'Inverter',
  'Mounting Structure',
  'Cables & Wiring',
  'Electrical Components',
  'Battery',
  'Civil Work',
  'Labour',
  'Transportation',
  'Liaison & Permits',
  'Monitoring System',
  'Other',
];

export function BoqVarianceForm({ projectId, existingVariances }: BoqVarianceFormProps) {
  const router = useRouter();
  const [mode, setMode] = React.useState<'idle' | 'add' | 'update'>('idle');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedVariance, setSelectedVariance] = React.useState<string | null>(null);

  async function handleAddSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const result = await addCostVariance({
      projectId,
      data: {
        item_category: (fd.get('item_category') as string) || '',
        estimated_cost: parseFloat(fd.get('estimated_cost') as string) || 0,
        actual_cost: parseFloat(fd.get('actual_cost') as string) || 0,
        notes: (fd.get('notes') as string) || null,
      },
    });

    setSaving(false);
    if (result.success) {
      setMode('idle');
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add cost entry');
    }
  }

  async function handleUpdateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVariance) return;
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const result = await updateCostVariance({
      projectId,
      varianceId: selectedVariance,
      actual_cost: parseFloat(fd.get('actual_cost') as string) || 0,
      notes: (fd.get('notes') as string) || null,
    });

    setSaving(false);
    if (result.success) {
      setMode('idle');
      setSelectedVariance(null);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to update cost entry');
    }
  }

  if (mode === 'idle') {
    return (
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" onClick={() => setMode('add')}>
          <Plus className="h-4 w-4 mr-1" /> Add Cost Entry
        </Button>
        {existingVariances.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setMode('update')}>
            Update Actual Costs
          </Button>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  if (mode === 'add') {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add Cost Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="item_category">Category *</Label>
                <Select id="item_category" name="item_category" required>
                  <option value="" disabled>Select...</option>
                  {COST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="estimated_cost">Estimated Cost (₹) *</Label>
                <Input id="estimated_cost" name="estimated_cost" type="number" step="0.01" required />
              </div>
              <div>
                <Label htmlFor="actual_cost">Actual Cost (₹) *</Label>
                <Input id="actual_cost" name="actual_cost" type="number" step="0.01" required />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" placeholder="Optional notes..." />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setMode('idle'); setError(null); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Adding...' : 'Add Entry'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  // Update mode
  const selected = existingVariances.find((v) => v.id === selectedVariance);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Update Actual Cost</CardTitle>
      </CardHeader>
      <CardContent>
        {!selectedVariance ? (
          <div className="space-y-3">
            <p className="text-sm text-n-500">Select a cost entry to update:</p>
            {existingVariances.map((v) => (
              <Button
                key={v.id}
                variant="ghost"
                className="w-full justify-between text-sm"
                onClick={() => setSelectedVariance(v.id)}
              >
                <span>{v.item_category}</span>
                <span className="font-mono text-n-500">
                  Est: {formatINR(v.estimated_cost)} → Act: {formatINR(v.actual_cost)}
                </span>
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => { setMode('idle'); setError(null); }}>Cancel</Button>
          </div>
        ) : (
          <form onSubmit={handleUpdateSubmit} className="space-y-4">
            <p className="text-sm font-medium">
              {selected?.item_category} — Estimated: {formatINR(selected?.estimated_cost ?? 0)}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="actual_cost">Actual Cost (₹) *</Label>
                <Input id="actual_cost" name="actual_cost" type="number" step="0.01" defaultValue={selected?.actual_cost ?? 0} required />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" placeholder="Reason for variance..." />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setSelectedVariance(null); setError(null); }}>Back</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Updating...' : 'Update Cost'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
