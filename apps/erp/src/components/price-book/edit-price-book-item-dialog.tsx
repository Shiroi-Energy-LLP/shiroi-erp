'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updatePriceBookItem } from '@/lib/price-book-actions';
import { addItemCategory, addItemUnit } from '@/lib/item-catalog-actions';

interface PriceBookItem {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  unit: string;
  base_price: number;
  gst_rate: number;
  gst_type: string | null;
  hsn_code: string | null;
  vendor_name: string | null;
  default_qty: number | null;
  specification: string | null;
}

interface EditPriceBookItemDialogProps {
  item: PriceBookItem;
  categories: { value: string; label: string }[];
  units: string[];
  canManageLists: boolean;
}

export function EditPriceBookItemDialog({ item, categories, units, canManageLists }: EditPriceBookItemDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Controlled category/unit (to support dynamic list updates)
  const [selectedCategory, setSelectedCategory] = React.useState(item.item_category);
  const [selectedUnit, setSelectedUnit] = React.useState(item.unit);

  // Inline add category state
  const [addingCategory, setAddingCategory] = React.useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = React.useState('');
  const [savingCategory, setSavingCategory] = React.useState(false);

  // Inline add unit state
  const [addingUnit, setAddingUnit] = React.useState(false);
  const [newUnitValue, setNewUnitValue] = React.useState('');
  const [savingUnit, setSavingUnit] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setSelectedCategory(item.item_category);
      setSelectedUnit(item.unit);
      setAddingCategory(false);
      setNewCategoryLabel('');
      setAddingUnit(false);
      setNewUnitValue('');
      setError(null);
    }
  }, [open, item]);

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

    const result = await updatePriceBookItem({
      id: item.id,
      data: {
        item_category: selectedCategory,
        item_description: form.get('item_description') as string,
        brand: (form.get('brand') as string) || null,
        model: (form.get('model') as string) || null,
        unit: selectedUnit,
        base_price: parseFloat(basePriceRaw) || 0,
        gst_rate: parseFloat(gstRateRaw) || 18,
        hsn_code: (form.get('hsn_code') as string) || null,
        vendor_name: (form.get('vendor_name') as string) || null,
        default_qty: parseFloat(defaultQtyRaw) || null,
        specification: (form.get('specification') as string) || null,
      },
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to update item');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-n-400 hover:text-p-600">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Price Book Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Category + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-pb-category" className="text-xs">Category *</Label>
              <Select id="edit-pb-category" value={selectedCategory} onChange={handleCategoryChange} required className="h-9 text-xs">
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
              <Label htmlFor="edit-pb-unit" className="text-xs">Unit *</Label>
              <Select id="edit-pb-unit" value={selectedUnit} onChange={handleUnitChange} required className="h-9 text-xs">
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
            <Label htmlFor="edit-pb-desc" className="text-xs">Item Description *</Label>
            <Input id="edit-pb-desc" name="item_description" required defaultValue={item.item_description} className="h-9 text-xs" />
          </div>

          {/* Brand + Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-pb-brand" className="text-xs">Make (Brand)</Label>
              <Input id="edit-pb-brand" name="brand" defaultValue={item.brand ?? ''} placeholder="e.g. Waaree" className="h-9 text-xs" />
            </div>
            <div>
              <Label htmlFor="edit-pb-model" className="text-xs">Model</Label>
              <Input id="edit-pb-model" name="model" defaultValue={item.model ?? ''} placeholder="e.g. WS-540M" className="h-9 text-xs" />
            </div>
          </div>

          {/* Rate + GST + HSN */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="edit-pb-price" className="text-xs">Rate / Unit (₹)</Label>
              <Input id="edit-pb-price" name="base_price" type="number" step="0.01" min="0" defaultValue={item.base_price} className="h-9 text-xs text-right font-mono" />
            </div>
            <div>
              <Label htmlFor="edit-pb-gst" className="text-xs">GST %</Label>
              <Select id="edit-pb-gst" name="gst_rate" defaultValue={String(item.gst_rate)} className="h-9 text-xs">
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-pb-hsn" className="text-xs">HSN Code</Label>
              <Input id="edit-pb-hsn" name="hsn_code" defaultValue={item.hsn_code ?? ''} placeholder="e.g. 8541" className="h-9 text-xs font-mono" />
            </div>
          </div>

          {/* Vendor + Default Qty */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-pb-vendor" className="text-xs">Vendor</Label>
              <Input id="edit-pb-vendor" name="vendor_name" defaultValue={item.vendor_name ?? ''} placeholder="e.g. Solar World Pvt Ltd" className="h-9 text-xs" />
            </div>
            <div>
              <Label htmlFor="edit-pb-qty" className="text-xs">Default Qty</Label>
              <Input id="edit-pb-qty" name="default_qty" type="number" step="0.01" min="0" defaultValue={item.default_qty ?? 1} className="h-9 text-xs text-right" />
            </div>
          </div>

          {/* Specification */}
          <div>
            <Label htmlFor="edit-pb-spec" className="text-xs">Specification / Notes</Label>
            <Input id="edit-pb-spec" name="specification" defaultValue={item.specification ?? ''} placeholder="Technical spec or notes" className="h-9 text-xs" />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
