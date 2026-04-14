'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updatePriceBookItem } from '@/lib/price-book-actions';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'solar_panel', label: 'Solar Panel' },
  { value: 'inverter', label: 'Inverter' },
  { value: 'battery', label: 'Battery' },
  { value: 'mounting_structure', label: 'Mounting Structure' },
  { value: 'dc_cable', label: 'DC Cable' },
  { value: 'dc_access', label: 'DC Accessories' },
  { value: 'ac_cable', label: 'AC Cable' },
  { value: 'dcdb', label: 'DCDB' },
  { value: 'acdb', label: 'ACDB' },
  { value: 'lt_panel', label: 'LT Panel' },
  { value: 'conduit', label: 'Conduit' },
  { value: 'earthing', label: 'Earthing' },
  { value: 'earth_access', label: 'Earthing Accessories' },
  { value: 'net_meter', label: 'Net Meter' },
  { value: 'civil_work', label: 'Civil Work' },
  { value: 'installation_labour', label: 'Installation Labour' },
  { value: 'transport', label: 'Transport' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
  { value: 'walkway', label: 'Walkway' },
  { value: 'gi_cable_tray', label: 'GI Cable Tray' },
  { value: 'handrail', label: 'Handrail' },
  { value: 'panel', label: 'Panel' },
  { value: 'structure', label: 'Structure' },
  { value: 'other', label: 'Other' },
];

const UNIT_OPTIONS = ['Nos', 'Mtrs', 'Kgs', 'Set', 'Lot', 'LS', 'Sq.Ft', 'Rft', 'Pair'];

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
}

export function EditPriceBookItemDialog({ item }: EditPriceBookItemDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
        item_category: form.get('item_category') as string,
        item_description: form.get('item_description') as string,
        brand: (form.get('brand') as string) || null,
        model: (form.get('model') as string) || null,
        unit: form.get('unit') as string,
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
              <Select id="edit-pb-category" name="item_category" required defaultValue={item.item_category} className="h-9 text-xs">
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-pb-unit" className="text-xs">Unit *</Label>
              <Select id="edit-pb-unit" name="unit" required defaultValue={item.unit} className="h-9 text-xs">
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
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
