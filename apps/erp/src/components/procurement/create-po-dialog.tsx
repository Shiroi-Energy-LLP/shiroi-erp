'use client';

import { useState, useTransition } from 'react';
import {
  Button, Input, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@repo/ui';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { createPurchaseOrder } from '@/lib/procurement-actions';

interface LineItem {
  itemCategory: string;
  itemDescription: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  gstRate: string;
}

function emptyLine(): LineItem {
  return {
    itemCategory: 'other',
    itemDescription: '',
    unit: 'nos',
    quantity: '1',
    unitPrice: '',
    gstRate: '18',
  };
}

const CATEGORIES = [
  'panel', 'inverter', 'battery', 'structure', 'dc_cable', 'ac_cable',
  'conduit', 'earthing', 'acdb', 'dcdb', 'net_meter', 'civil_work',
  'installation_labour', 'transport', 'other',
];

interface CreatePODialogProps {
  projects: { id: string; project_number: string; customer_name: string }[];
  vendors: { id: string; company_name: string }[];
}

export function CreatePODialog({ projects, vendors }: CreatePODialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [projectId, setProjectId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLine()]);
  const [error, setError] = useState('');

  const addLine = () => setLineItems([...lineItems, emptyLine()]);

  const removeLine = (idx: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof LineItem, value: string) => {
    setLineItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const computeTotal = () => {
    let subtotal = 0;
    let gst = 0;
    for (const item of lineItems) {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      const rate = parseFloat(item.gstRate) || 0;
      const lineTotal = qty * price;
      subtotal += lineTotal;
      gst += lineTotal * (rate / 100);
    }
    return { subtotal, gst, total: subtotal + gst };
  };

  const { subtotal, gst, total } = computeTotal();

  const handleSubmit = () => {
    if (!projectId) { setError('Select a project'); return; }
    if (!vendorId) { setError('Select a vendor'); return; }
    const validItems = lineItems.filter(l => l.itemDescription && parseFloat(l.unitPrice) > 0);
    if (!validItems.length) { setError('Add at least one line item with description and price'); return; }
    setError('');

    startTransition(async () => {
      const result = await createPurchaseOrder({
        projectId,
        vendorId,
        expectedDeliveryDate: expectedDelivery || undefined,
        notes: notes || undefined,
        lineItems: validItems.map(l => ({
          itemCategory: l.itemCategory,
          itemDescription: l.itemDescription,
          unit: l.unit,
          quantity: parseFloat(l.quantity) || 1,
          unitPrice: parseFloat(l.unitPrice) || 0,
          gstRate: parseFloat(l.gstRate) || 18,
        })),
      });
      if (result.success) {
        setOpen(false);
        resetForm();
      } else {
        setError(result.error ?? 'Failed to create PO');
      }
    });
  };

  const resetForm = () => {
    setProjectId('');
    setVendorId('');
    setExpectedDelivery('');
    setNotes('');
    setLineItems([emptyLine()]);
    setError('');
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        New PO
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Project</Label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#00B050]"
                >
                  <option value="">Select project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Vendor</Label>
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#00B050]"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.company_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Expected Delivery</Label>
                <Input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="mt-1" />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-bold">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add Item
                </Button>
              </div>

              <div className="space-y-2">
                {lineItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-2 bg-gray-50">
                    <div className="col-span-2">
                      {idx === 0 && <label className="text-[10px] text-gray-500">Category</label>}
                      <select
                        value={item.itemCategory}
                        onChange={(e) => updateLine(idx, 'itemCategory', e.target.value)}
                        className="w-full rounded border px-2 py-1.5 text-xs"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      {idx === 0 && <label className="text-[10px] text-gray-500">Description</label>}
                      <input
                        value={item.itemDescription}
                        onChange={(e) => updateLine(idx, 'itemDescription', e.target.value)}
                        placeholder="Item description"
                        className="w-full rounded border px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      {idx === 0 && <label className="text-[10px] text-gray-500">Unit</label>}
                      <input
                        value={item.unit}
                        onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                        className="w-full rounded border px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      {idx === 0 && <label className="text-[10px] text-gray-500">Qty</label>}
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                        className="w-full rounded border px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="col-span-2">
                      {idx === 0 && <label className="text-[10px] text-gray-500">Unit Price (₹)</label>}
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)}
                        placeholder="0"
                        className="w-full rounded border px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      {idx === 0 && <label className="text-[10px] text-gray-500">GST %</label>}
                      <input
                        type="number"
                        value={item.gstRate}
                        onChange={(e) => updateLine(idx, 'gstRate', e.target.value)}
                        className="w-full rounded border px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="col-span-1">
                      {idx === 0 && <label className="text-[10px] text-gray-500">Total</label>}
                      <p className="text-xs font-mono py-1.5 text-right">
                        ₹{((parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0)).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {lineItems.length > 1 && (
                        <button onClick={() => removeLine(idx)} className="p-1 text-gray-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Subtotal:</span> <span>₹{subtotal.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>GST:</span> <span>₹{gst.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between font-bold border-t pt-1 mt-1">
                <span>Total:</span> <span>₹{total.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Create PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
