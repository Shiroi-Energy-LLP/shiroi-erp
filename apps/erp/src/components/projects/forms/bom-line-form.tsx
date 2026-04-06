'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus, Trash2 } from 'lucide-react';
import { addBomLine, deleteBomLine } from '@/lib/project-step-actions';

interface BomLineFormProps {
  projectId: string;
  hasProposal: boolean;
  existingLines: { id: string; item_category: string; item_description: string }[];
}

const BOM_CATEGORIES = [
  'Solar Panels',
  'Inverter',
  'Mounting Structure',
  'Cables & Wiring',
  'AC Distribution Box',
  'DC Distribution Box',
  'Earthing',
  'Lightning Arrestor',
  'Battery',
  'Monitoring System',
  'Civil Work',
  'Labour',
  'Transportation',
  'Other',
];

const UNITS = ['nos', 'set', 'meter', 'kg', 'lot', 'sqft', 'pair'];

export function BomLineForm({ projectId, hasProposal, existingLines }: BomLineFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const getStr = (k: string) => (fd.get(k) as string) || null;
    const getNum = (k: string) => parseFloat(fd.get(k) as string) || 0;

    const result = await addBomLine({
      projectId,
      data: {
        item_category: (fd.get('item_category') as string) || '',
        item_description: (fd.get('item_description') as string) || '',
        brand: getStr('brand'),
        model: getStr('model'),
        quantity: getNum('quantity'),
        unit: (fd.get('unit') as string) || 'nos',
        unit_price: getNum('unit_price'),
        gst_rate: getNum('gst_rate'),
      },
    });

    setSaving(false);
    if (result.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add BOM line');
    }
  }

  async function handleDelete(lineId: string) {
    if (!confirm('Delete this BOM line?')) return;
    setDeleting(lineId);
    const result = await deleteBomLine({ projectId, lineId });
    setDeleting(null);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to delete');
    }
  }

  if (!hasProposal) {
    return null; // Can't add BOM lines without a proposal
  }

  if (!showForm) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add BOM Line
        </Button>
        {existingLines.length > 0 && (
          <DeleteBomButtons
            lines={existingLines}
            onDelete={handleDelete}
            deleting={deleting}
          />
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Add BOM Line Item</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="item_category">Category *</Label>
              <Select id="item_category" name="item_category" required>
                <option value="" disabled>Select category...</option>
                {BOM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="item_description">Description *</Label>
              <Input id="item_description" name="item_description" required placeholder="e.g. 540W Mono PERC Half-Cut" />
            </div>
            <div>
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" name="brand" placeholder="e.g. Adani" />
            </div>
            <div>
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" placeholder="e.g. ASM-540-HC" />
            </div>
            <div>
              <Label htmlFor="quantity">Quantity *</Label>
              <Input id="quantity" name="quantity" type="number" step="0.01" required />
            </div>
            <div>
              <Label htmlFor="unit">Unit *</Label>
              <Select id="unit" name="unit" defaultValue="nos" required>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="unit_price">Unit Price (₹) *</Label>
              <Input id="unit_price" name="unit_price" type="number" step="0.01" required />
            </div>
            <div>
              <Label htmlFor="gst_rate">GST Rate (%) *</Label>
              <Select id="gst_rate" name="gst_rate" defaultValue="18" required>
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </Select>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Adding...' : 'Add Line Item'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteBomButtons({
  lines,
  onDelete,
  deleting,
}: {
  lines: { id: string; item_category: string; item_description: string }[];
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  const [showDelete, setShowDelete] = React.useState(false);

  if (!showDelete) {
    return (
      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => setShowDelete(true)}>
        <Trash2 className="h-4 w-4 mr-1" /> Remove Lines
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-n-500">Click to remove:</span>
      {lines.map((l) => (
        <Button
          key={l.id}
          size="sm"
          variant="ghost"
          className="text-red-500 hover:text-red-700 text-xs"
          onClick={() => onDelete(l.id)}
          disabled={deleting === l.id}
        >
          {deleting === l.id ? '...' : `${l.item_category}: ${l.item_description.slice(0, 20)}`}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={() => setShowDelete(false)}>Done</Button>
    </div>
  );
}
