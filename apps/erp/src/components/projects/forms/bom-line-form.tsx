'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@repo/ui';
import { Plus, Trash2, Save, X, Pencil, History } from 'lucide-react';
import { addBomLine, deleteBomLine, lockBoi, unlockBoi, addBoqItem, deleteBoqItem, submitBoiVersion, approveBoiVersion, lockBoiVersion, unlockBoiVersion, createBoiVersion, updateBoiItem, getBoiItemHistory } from '@/lib/project-step-actions';
import { Lock, Unlock, Send, CheckCircle, PlusCircle } from 'lucide-react';
import { BOI_CATEGORIES } from '@/lib/boi-constants';
import { ItemCombobox, type ItemSuggestion } from '@/components/forms/item-combobox';
import type { ItemCategory } from '@/lib/boi-constants';

interface BomLineFormProps {
  projectId: string;
  hasProposal: boolean;
}

const UNITS = ['Nos', 'No', 'Meter', 'Set', 'Lot', 'Pair', 'kWp', 'kW', 'Lumpsum', 'nos', 'set', 'meter', 'kg', 'sqft'];
const GST_RATES = ['0', '5', '12', '18', '28'];

interface NewRow {
  item_category: string;
  item_description: string;
  brand: string;
  model: string;
  quantity: string;
  unit: string;
  unit_price: string;
  gst_rate: string;
}

const EMPTY_ROW: NewRow = {
  item_category: '', item_description: '', brand: '', model: '',
  quantity: '', unit: 'nos', unit_price: '', gst_rate: '18',
};

export function BomInlineAddRow({
  projectId,
  hasProposal,
  suggestions,
}: BomLineFormProps & { suggestions: ItemSuggestion[] }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [row, setRow] = React.useState<NewRow>({ ...EMPTY_ROW });

  if (!hasProposal) return null;

  async function handleSave() {
    if (!row.item_category || !row.item_description || !row.quantity || !row.unit_price) {
      setError('Category, Description, Qty, and Unit Price are required');
      return;
    }
    setSaving(true);
    setError(null);

    const result = await addBomLine({
      projectId,
      data: {
        item_category: row.item_category,
        item_description: row.item_description,
        brand: row.brand || null,
        model: row.model || null,
        quantity: parseFloat(row.quantity),
        unit: row.unit,
        unit_price: parseFloat(row.unit_price),
        gst_rate: parseFloat(row.gst_rate),
      },
    });

    setSaving(false);
    if (result.success) {
      setRow({ ...EMPTY_ROW });
      setAdding(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add line');
    }
  }

  if (!adding) {
    return (
      <tr>
        <td colSpan={9} className="px-4 py-2">
          <Button size="sm" variant="ghost" className="text-p-600 hover:text-p-700" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
          </Button>
          {error && <span className="text-xs text-red-600 ml-2">{error}</span>}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-p-50 border-t border-p-200">
        <td className="px-3 py-1.5">
          <Select
            value={row.item_category}
            onChange={(e) => setRow({ ...row, item_category: e.target.value })}
            className="text-xs h-8 w-[160px]"
          >
            <option value="">Category...</option>
            {BOI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </td>
        <td className="px-3 py-1.5">
          <ItemCombobox
            value={row.item_description}
            onChange={(description, picked) => {
              if (picked) {
                setRow({
                  ...row,
                  item_description: description,
                  item_category: picked.category,
                  unit: picked.unit,
                  unit_price: picked.base_price > 0 ? String(picked.base_price) : row.unit_price,
                });
              } else {
                setRow({ ...row, item_description: description });
              }
            }}
            suggestions={suggestions}
            placeholder="Description"
            className="text-xs h-8"
          />
        </td>
        <td className="px-3 py-1.5">
          <Input
            value={row.brand}
            onChange={(e) => setRow({ ...row, brand: e.target.value })}
            placeholder="Brand"
            className="text-xs h-8 w-[80px]"
          />
        </td>
        <td className="px-3 py-1.5 text-right">
          <Input
            value={row.quantity}
            onChange={(e) => setRow({ ...row, quantity: e.target.value })}
            type="number"
            step="0.01"
            placeholder="Qty"
            className="text-xs h-8 w-[70px] text-right"
          />
        </td>
        <td className="px-3 py-1.5">
          <Select
            value={row.unit}
            onChange={(e) => setRow({ ...row, unit: e.target.value })}
            className="text-xs h-8 w-[70px]"
          >
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </td>
        <td className="px-3 py-1.5 text-right">
          <Input
            value={row.unit_price}
            onChange={(e) => setRow({ ...row, unit_price: e.target.value })}
            type="number"
            step="0.01"
            placeholder="Rate"
            className="text-xs h-8 w-[90px] text-right"
          />
        </td>
        <td className="px-3 py-1.5 text-right">
          <Select
            value={row.gst_rate}
            onChange={(e) => setRow({ ...row, gst_rate: e.target.value })}
            className="text-xs h-8 w-[65px]"
          >
            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </Select>
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-xs text-n-500">
          {row.quantity && row.unit_price
            ? `₹${(parseFloat(row.quantity) * parseFloat(row.unit_price) * (1 + parseFloat(row.gst_rate) / 100)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
            : '—'}
        </td>
        <td className="px-3 py-1.5">
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSave} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-400" onClick={() => { setAdding(false); setRow({ ...EMPTY_ROW }); setError(null); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={9} className="px-4 py-1">
            <span className="text-xs text-red-600">{error}</span>
          </td>
        </tr>
      )}
    </>
  );
}

export function BomDeleteButton({ projectId, lineId, label }: { projectId: string; lineId: string; label: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${label}"?`)) return;
    setDeleting(true);
    const result = await deleteBomLine({ projectId, lineId });
    setDeleting(false);
    if (result.success) {
      router.refresh();
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 w-7 p-0 text-n-300 hover:text-red-500"
      onClick={handleDelete}
      disabled={deleting}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

// ── BOI Submit/Lock Button ──

export function BoiLockButton({ projectId, isLocked }: { projectId: string; isLocked: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleToggle() {
    if (isLocked) {
      if (!confirm('Unlock BOI for editing? This will allow changes to the item list.')) return;
      setLoading(true);
      setError(null);
      const result = await unlockBoi({ projectId });
      setLoading(false);
      if (result.success) router.refresh();
      else setError(result.error ?? 'Failed to unlock');
    } else {
      if (!confirm('Submit and lock BOI? Items will not be editable after submission.')) return;
      setLoading(true);
      setError(null);
      const result = await lockBoi({ projectId });
      setLoading(false);
      if (result.success) router.refresh();
      else setError(result.error ?? 'Failed to submit');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={isLocked ? 'outline' : 'default'}
        onClick={handleToggle}
        disabled={loading}
      >
        {isLocked ? <Unlock className="h-3.5 w-3.5 mr-1.5" /> : <Lock className="h-3.5 w-3.5 mr-1.5" />}
        {loading ? 'Processing...' : isLocked ? 'Unlock BOI' : 'Submit BOI'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// ── BOI Inline Add Row (using Manivel's 14 categories, writes to project_boq_items) ──

export function BoiInlineAddRow({
  projectId,
  boiId,
  disabled,
  suggestions,
}: {
  projectId: string;
  boiId?: string;
  disabled?: boolean;
  suggestions: ItemSuggestion[];
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [row, setRow] = React.useState({
    item_category: '', item_description: '', brand: '', model: '',
    quantity: '', unit: 'nos', unit_price: '0', gst_rate: '18',
  });

  if (disabled) return null;

  async function handleSave() {
    if (!row.item_category || !row.item_description || !row.quantity) {
      setError('Category, Item Name, and Qty are required');
      return;
    }
    setSaving(true);
    setError(null);

    const result = await addBoqItem({
      projectId,
      boiId,
      data: {
        item_category: row.item_category,
        item_description: row.item_description,
        brand: row.brand || null,
        model: row.model || null,
        quantity: parseFloat(row.quantity),
        unit: row.unit,
        unit_price: parseFloat(row.unit_price) || 0,
        gst_rate: parseFloat(row.gst_rate),
      },
    });

    setSaving(false);
    if (result.success) {
      setRow({ item_category: '', item_description: '', brand: '', model: '', quantity: '', unit: 'nos', unit_price: '0', gst_rate: '18' });
      setAdding(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add item');
    }
  }

  if (!adding) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-2">
          <Button size="sm" variant="ghost" className="text-p-600 hover:text-p-700" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-p-50 border-t border-p-200">
        <td className="px-3 py-1.5">
          <Select
            value={row.item_category}
            onChange={(e) => setRow({ ...row, item_category: e.target.value })}
            className="text-xs h-8 w-[160px]"
          >
            <option value="">Category...</option>
            {BOI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </td>
        <td className="px-3 py-1.5">
          <ItemCombobox
            value={row.item_description}
            onChange={(description, picked) => {
              if (picked) {
                setRow({
                  ...row,
                  item_description: description,
                  item_category: picked.category,
                  unit: picked.unit,
                  unit_price: picked.base_price > 0 ? String(picked.base_price) : row.unit_price,
                });
              } else {
                setRow({ ...row, item_description: description });
              }
            }}
            suggestions={suggestions}
            placeholder="Type to search items…"
            className="text-xs h-8"
          />
        </td>
        <td className="px-3 py-1.5">
          <Input
            value={row.brand}
            onChange={(e) => setRow({ ...row, brand: e.target.value })}
            placeholder="Make/Brand"
            className="text-xs h-8 w-[90px]"
          />
        </td>
        <td className="px-3 py-1.5 text-right">
          <Input
            value={row.quantity}
            onChange={(e) => setRow({ ...row, quantity: e.target.value })}
            type="number"
            step="0.01"
            placeholder="Qty"
            className="text-xs h-8 w-[70px] text-right"
          />
        </td>
        <td className="px-3 py-1.5">
          <Select
            value={row.unit}
            onChange={(e) => setRow({ ...row, unit: e.target.value })}
            className="text-xs h-8 w-[70px]"
          >
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </td>
        <td></td>
        <td className="px-3 py-1.5">
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600" onClick={handleSave} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-400" onClick={() => { setAdding(false); setError(null); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-4 py-1">
            <span className="text-xs text-red-600">{error}</span>
          </td>
        </tr>
      )}
    </>
  );
}

// ── BOI Delete Button (for project_boq_items) ──

export function BoiDeleteButton({ projectId, itemId, label }: { projectId: string; itemId: string; label: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${label}"?`)) return;
    setDeleting(true);
    const result = await deleteBoqItem({ projectId, itemId });
    setDeleting(false);
    if (result.success) router.refresh();
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 w-7 p-0 text-n-300 hover:text-red-500"
      onClick={handleDelete}
      disabled={deleting}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

// ── BOI Version Workflow Buttons ──

export function BoiSubmitButton({ projectId, boiId }: { projectId: string; boiId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit() {
    if (!confirm('Submit this BOI for PM review? Items will not be editable until approved.')) return;
    setLoading(true);
    setError(null);
    const result = await submitBoiVersion({ projectId, boiId });
    setLoading(false);
    if (result.success) router.refresh();
    else setError(result.error ?? 'Failed to submit');
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={handleSubmit} disabled={loading}>
        <Send className="h-3.5 w-3.5 mr-1.5" />
        {loading ? 'Submitting...' : 'Submit BOI'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function BoiApproveButton({ projectId, boiId }: { projectId: string; boiId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleApprove() {
    if (!confirm('Approve this BOI? It will become available in the BOQ module.')) return;
    setLoading(true);
    setError(null);
    const result = await approveBoiVersion({ projectId, boiId });
    setLoading(false);
    if (result.success) router.refresh();
    else setError(result.error ?? 'Failed to approve');
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="default" onClick={handleApprove} disabled={loading} className="bg-green-600 hover:bg-green-700">
        <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
        {loading ? 'Approving...' : 'Approve BOI'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function BoiLockVersionButton({ projectId, boiId, isLocked }: { projectId: string; boiId: string; isLocked: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleToggle() {
    if (isLocked) {
      if (!confirm('Unlock this BOI for corrections? It will revert to approved status.')) return;
      setLoading(true);
      setError(null);
      const result = await unlockBoiVersion({ projectId, boiId });
      setLoading(false);
      if (result.success) router.refresh();
      else setError(result.error ?? 'Failed to unlock');
    } else {
      if (!confirm('Lock this BOI? No further edits will be allowed.')) return;
      setLoading(true);
      setError(null);
      const result = await lockBoiVersion({ projectId, boiId });
      setLoading(false);
      if (result.success) router.refresh();
      else setError(result.error ?? 'Failed to lock');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant={isLocked ? 'outline' : 'default'} onClick={handleToggle} disabled={loading}>
        {isLocked ? <Unlock className="h-3.5 w-3.5 mr-1.5" /> : <Lock className="h-3.5 w-3.5 mr-1.5" />}
        {loading ? 'Processing...' : isLocked ? 'Unlock BOI' : 'Lock BOI'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function CreateNewBoiButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    const result = await createBoiVersion({ projectId });
    setLoading(false);
    if (result.success) router.refresh();
    else setError(result.error ?? 'Failed to create BOI');
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleCreate} disabled={loading}>
        <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
        {loading ? 'Creating...' : 'Create New BOI'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// ── BOI Edit (any state, audited — mig 175) ──

interface BoiEditableItem {
  id: string;
  item_description: string | null;
  brand: string | null;
  model: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  gst_rate: number | null;
}

export function BoiEditButton({ projectId, item }: { projectId: string; item: BoiEditableItem }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    item_description: item.item_description ?? '',
    brand: item.brand ?? '',
    model: item.model ?? '',
    quantity: String(item.quantity ?? ''),
    unit: item.unit ?? 'nos',
    unit_price: String(item.unit_price ?? ''),
    gst_rate: String(item.gst_rate ?? '18'),
  });

  async function handleSave() {
    if (!form.item_description.trim() || !form.quantity) {
      setError('Description and Qty are required');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateBoiItem({
      projectId,
      itemId: item.id,
      data: {
        item_description: form.item_description,
        brand: form.brand || null,
        model: form.model || null,
        quantity: parseFloat(form.quantity),
        unit: form.unit,
        unit_price: parseFloat(form.unit_price) || 0,
        gst_rate: parseFloat(form.gst_rate) || 0,
      },
    });
    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to save');
    }
  }

  if (!open) {
    return (
      <Button
        size="sm" variant="ghost"
        className="h-7 w-7 p-0 text-n-400 hover:text-n-700"
        title="Edit item (audited)"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-lg shadow-lg p-4 w-[440px] space-y-3" onClick={(e) => e.stopPropagation()}>
        <h4 className="text-sm font-semibold text-n-900">Edit BOI item</h4>
        <p className="text-[11px] text-n-500">
          Edits are allowed in any BOI state and recorded in the item&apos;s change history.
        </p>
        <div>
          <label className="block text-[10px] text-n-500 mb-0.5">Description *</label>
          <Input value={form.item_description}
            onChange={(e) => setForm({ ...form, item_description: e.target.value })} className="text-xs h-8" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Brand</label>
            <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="text-xs h-8" />
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Model</label>
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="text-xs h-8" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Qty *</label>
            <Input type="number" step="0.01" value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="text-xs h-8" />
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Unit</label>
            <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="text-xs h-8">
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">Rate</label>
            <Input type="number" step="0.01" value={form.unit_price}
              onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className="text-xs h-8" />
          </div>
          <div>
            <label className="block text-[10px] text-n-500 mb-0.5">GST %</label>
            <Select value={form.gst_rate} onChange={(e) => setForm({ ...form, gst_rate: e.target.value })} className="text-xs h-8">
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </div>
  );
}

// ── BOI item change history (lazy-loaded popover) ──

export function BoiItemHistoryButton({ itemId }: { itemId: string }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [entries, setEntries] = React.useState<
    { id: string; changed_at: string; changed_by_name: string | null;
      changes: Record<string, { old: string | number | null; new: string | number | null }> }[] | null
  >(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (entries === null) {
      setLoading(true);
      const result = await getBoiItemHistory({ itemId });
      setLoading(false);
      setEntries(result.success ? (result.entries ?? []) : []);
    }
  }

  return (
    <span className="relative inline-block">
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-300 hover:text-n-600"
        title="Change history" onClick={toggle}>
        <History className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[340px] rounded-md border border-n-200 bg-white shadow-md p-2 max-h-60 overflow-y-auto text-left">
          {loading && <p className="text-[11px] text-n-400 px-1 py-2">Loading…</p>}
          {!loading && entries !== null && entries.length === 0 && (
            <p className="text-[11px] text-n-400 px-1 py-2">No edits recorded for this item.</p>
          )}
          {!loading && (entries ?? []).map((e) => (
            <div key={e.id} className="border-b border-n-100 last:border-0 px-1 py-1.5">
              <div className="text-[10px] text-n-500">
                {new Date(e.changed_at).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
                {e.changed_by_name ? ` · ${e.changed_by_name}` : ''}
              </div>
              {Object.entries(e.changes).map(([field, c]) => (
                <div key={field} className="text-[11px] text-n-700">
                  <span className="font-medium">{field.replace(/_/g, ' ')}</span>:{' '}
                  <span className="line-through text-n-400">{c.old ?? '—'}</span>{' → '}
                  <span>{c.new ?? '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
