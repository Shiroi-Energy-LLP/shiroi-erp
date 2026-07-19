'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createPriceBookItem } from '@/lib/price-book-actions';
import { addItemCategory, addItemUnit } from '@/lib/item-catalog-actions';

interface AddPriceBookItemDialogProps {
  onSuccess?: () => void;
  categories: { value: string; label: string }[];
  units: string[];
  canManageLists: boolean;
}

export function AddPriceBookItemDialog({ onSuccess, categories, units, canManageLists }: AddPriceBookItemDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Inline add category state
  const [selectedCategory, setSelectedCategory] = React.useState('');
  const [addingCategory, setAddingCategory] = React.useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = React.useState('');
  const [savingCategory, setSavingCategory] = React.useState(false);

  // Inline add unit state
  const [selectedUnit, setSelectedUnit] = React.useState('Nos');
  const [addingUnit, setAddingUnit] = React.useState(false);
  const [newUnitValue, setNewUnitValue] = React.useState('');
  const [savingUnit, setSavingUnit] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setSelectedCategory('');
      setSelectedUnit('Nos');
      setAddingCategory(false);
      setNewCategoryLabel('');
      setAddingUnit(false);
      setNewUnitValue('');
      setError(null);
    }
  }, [open]);

  async function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === '__add__' && canManageLists) {
      setAddingCategory(true);
      setSelectedCategory('');
    } else {
      setSelectedCategory(val);
      setAddingCategory(false);
    }
  }

  async function handleSaveCategory() {
    if (!newCategoryLabel.trim()) return;
    setSavingCategory(true);
    const result = await addItemCategory({ label: newCategoryLabel.trim() });
    setSavingCategory(false);
    if (result.success) {
      setSelectedCategory(result.data.value);
      setAddingCategory(false);
      setNewCategoryLabel('');
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add category');
    }
  }

  async function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === '__add__' && canManageLists) {
      setAddingUnit(true);
      setSelectedUnit('');
    } else {
      setSelectedUnit(val);
      setAddingUnit(false);
    }
  }

  async function handleSaveUnit() {
    if (!newUnitValue.trim()) return;
    setSavingUnit(true);
    const result = await addItemUnit({ value: newUnitValue.trim() });
    setSavingUnit(false);
    if (result.success) {
      setSelectedUnit(result.data.value);
      setAddingUnit(false);
      setNewUnitValue('');
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to add unit');
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const basePriceRaw = form.get('base_price') as string;
    const gstRateRaw = form.get('gst_rate') as string;
    const defaultQtyRaw = form.get('default_qty') as string;

    const result = await createPriceBookItem({
      item_category: selectedCategory,
      item_description: form.get('item_description') as string,
      brand: (form.get('brand') as string) || undefined,
      model: (form.get('model') as string) || undefined,
      unit: selectedUnit,
      base_price: parseFloat(basePriceRaw) || 0,
      gst_rate: parseFloat(gstRateRaw) || 18,
      gst_type: (form.get('gst_type') as string) || undefined,
      hsn_code: (form.get('hsn_code') as string) || undefined,
      vendor_name: (form.get('vendor_name') as string) || undefined,
      default_qty: parseFloat(defaultQtyRaw) || undefined,
      specification: (form.get('specification') as string) || undefined,
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      onSuccess?.();
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create item');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Item
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Price Book Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Category + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-category" className="text-xs">Category *</Label>
              <Select id="add-category" value={selectedCategory} onChange={handleCategoryChange} required className="h-9 text-xs">
                <option value="" disabled>— Select —</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
                {canManageLists && <option value="__add__">+ Add new category…</option>}
              </Select>
              {addingCategory && (
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    value={newCategoryLabel}
                    onChange={(e) => setNewCategoryLabel(e.target.value)}
                    placeholder="Category label"
                    className="h-7 text-xs flex-1"
                  />
                  <Button type="button" size="sm" className="h-7 text-xs px-2" onClick={handleSaveCategory} disabled={savingCategory || !newCategoryLabel.trim()}>
                    {savingCategory ? '…' : 'Save'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setAddingCategory(false); setNewCategoryLabel(''); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="add-unit" className="text-xs">Unit *</Label>
              <Select id="add-unit" value={selectedUnit} onChange={handleUnitChange} required className="h-9 text-xs">
                {units.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
                {canManageLists && <option value="__add__">+ Add new unit…</option>}
              </Select>
              {addingUnit && (
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    value={newUnitValue}
                    onChange={(e) => setNewUnitValue(e.target.value)}
                    placeholder="Unit value"
                    className="h-7 text-xs flex-1"
                  />
                  <Button type="button" size="sm" className="h-7 text-xs px-2" onClick={handleSaveUnit} disabled={savingUnit || !newUnitValue.trim()}>
                    {savingUnit ? '…' : 'Save'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setAddingUnit(false); setNewUnitValue(''); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="add-item_description" className="text-xs">Item Description *</Label>
            <Input id="add-item_description" name="item_description" required placeholder="e.g. Monocrystalline Solar Panel 540Wp" className="h-9 text-xs" />
          </div>

          {/* Brand + Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-brand" className="text-xs">Make (Brand)</Label>
              <Input id="add-brand" name="brand" placeholder="e.g. Waaree" className="h-9 text-xs" />
            </div>
            <div>
              <Label htmlFor="add-model" className="text-xs">Model</Label>
              <Input id="add-model" name="model" placeholder="e.g. WS-540M" className="h-9 text-xs" />
            </div>
          </div>

          {/* Base Price + GST + HSN */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="add-base_price" className="text-xs">Rate / Unit (₹)</Label>
              <Input id="add-base_price" name="base_price" type="number" step="0.01" min="0" defaultValue="0" placeholder="0.00" className="h-9 text-xs text-right font-mono" />
            </div>
            <div>
              <Label htmlFor="add-gst_rate" className="text-xs">GST %</Label>
              <Select id="add-gst_rate" name="gst_rate" defaultValue="18" className="h-9 text-xs">
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="add-hsn_code" className="text-xs">HSN Code</Label>
              <Input id="add-hsn_code" name="hsn_code" placeholder="e.g. 8541" className="h-9 text-xs font-mono" />
            </div>
          </div>

          {/* GST Type */}
          <div>
            <Label htmlFor="add-gst_type" className="text-xs">GST Type</Label>
            <Select id="add-gst_type" name="gst_type" defaultValue="supply" className="h-9 text-xs">
              <option value="supply">Supply (goods — 5% HSN 8541)</option>
              <option value="works_contract">Works Contract (service — 18%)</option>
            </Select>
          </div>

          {/* Vendor + Default Qty */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-vendor_name" className="text-xs">Vendor</Label>
              <Input id="add-vendor_name" name="vendor_name" placeholder="e.g. Solar World Pvt Ltd" className="h-9 text-xs" />
            </div>
            <div>
              <Label htmlFor="add-default_qty" className="text-xs">Default Qty</Label>
              <Input id="add-default_qty" name="default_qty" type="number" step="0.01" min="0" defaultValue="1" className="h-9 text-xs text-right" />
            </div>
          </div>

          {/* Specification */}
          <div>
            <Label htmlFor="add-specification" className="text-xs">Specification / Notes</Label>
            <Input id="add-specification" name="specification" placeholder="Technical spec or notes" className="h-9 text-xs" />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Adding...' : 'Add Item'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
