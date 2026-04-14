'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createPriceBookItem } from '@/lib/price-book-actions';

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

interface AddPriceBookItemDialogProps {
  onSuccess?: () => void;
}

export function AddPriceBookItemDialog({ onSuccess }: AddPriceBookItemDialogProps) {
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

    const result = await createPriceBookItem({
      item_category: form.get('item_category') as string,
      item_description: form.get('item_description') as string,
      brand: (form.get('brand') as string) || undefined,
      model: (form.get('model') as string) || undefined,
      unit: form.get('unit') as string,
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
          {/* Category + Item Description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-category" className="text-xs">Category *</Label>
              <Select id="add-category" name="item_category" required defaultValue="" className="h-9 text-xs">
                <option value="" disabled>— Select —</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="add-unit" className="text-xs">Unit *</Label>
              <Select id="add-unit" name="unit" required defaultValue="Nos" className="h-9 text-xs">
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
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
