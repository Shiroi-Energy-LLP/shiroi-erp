'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@repo/ui';
import { Truck, Plus, Minus } from 'lucide-react';
import { createDeliveryChallan, getProjectSiteAddress } from '@/lib/project-step-actions';

interface ReadyItem {
  id: string;
  item_description: string;
  item_category: string;
  quantity: number;
  dispatched_qty: number;
  unit: string;
}

interface CreateDcDialogProps {
  projectId: string;
  readyItems: ReadyItem[];
  siteAddress?: string;
}

export function CreateDcDialog({ projectId, readyItems, siteAddress }: CreateDcDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Selected items with dispatch quantities
  const [selectedItems, setSelectedItems] = React.useState<Record<string, number>>({});

  // Transport details
  const [vehicleNumber, setVehicleNumber] = React.useState('');
  const [driverName, setDriverName] = React.useState('');
  const [driverPhone, setDriverPhone] = React.useState('');
  const [dispatchFrom, setDispatchFrom] = React.useState('Shiroi Energy Warehouse');
  const [dispatchTo, setDispatchTo] = React.useState('');
  const [notes, setNotes] = React.useState('');

  // Auto-select all ready items + auto-fill site address on open
  React.useEffect(() => {
    if (open) {
      const defaults: Record<string, number> = {};
      readyItems.forEach((item) => {
        const remaining = item.quantity - (Number(item.dispatched_qty) || 0);
        if (remaining > 0) {
          defaults[item.id] = remaining;
        }
      });
      setSelectedItems(defaults);

      // Auto-fill dispatch-to from project site address
      if (siteAddress && !dispatchTo) {
        setDispatchTo(siteAddress);
      }
    }
  }, [open, readyItems, siteAddress]);

  function toggleItem(itemId: string, maxQty: number) {
    setSelectedItems((prev) => {
      if (prev[itemId] !== undefined) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: maxQty };
    });
  }

  function updateQty(itemId: string, qty: number) {
    setSelectedItems((prev) => ({ ...prev, [itemId]: Math.max(0, qty) }));
  }

  async function handleCreate() {
    const itemsToDispatch = Object.entries(selectedItems)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const item = readyItems.find((i) => i.id === id)!;
        return {
          boqItemId: id,
          quantity: qty,
          description: item.item_description,
          unit: item.unit,
        };
      });

    if (itemsToDispatch.length === 0) {
      setError('Select at least one item to dispatch');
      return;
    }

    setSaving(true);
    setError(null);
    const result = await createDeliveryChallan({
      projectId,
      items: itemsToDispatch,
      vehicleNumber: vehicleNumber || undefined,
      driverName: driverName || undefined,
      driverPhone: driverPhone || undefined,
      dispatchFrom: dispatchFrom || undefined,
      dispatchTo: dispatchTo || undefined,
      notes: notes || undefined,
    });
    setSaving(false);

    if (result.success) {
      setOpen(false);
      setSelectedItems({});
      setVehicleNumber('');
      setDriverName('');
      setDriverPhone('');
      setDispatchTo(siteAddress || '');
      setNotes('');
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create delivery challan');
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={readyItems.length === 0}>
        <Truck className="h-4 w-4 mr-1.5" />
        Create Delivery Challan
      </Button>
    );
  }

  return (
    <div className="border border-p-200 rounded-lg bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-n-900">Create Delivery Challan</h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>

      {/* Item selection */}
      <div>
        <p className="text-xs font-medium text-n-600 mb-2">Select items to dispatch ({readyItems.length} ready)</p>
        <div className="border border-n-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-n-50 border-b border-n-200">
                <th className="px-3 py-2 text-left w-8"></th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Dispatch Qty</th>
              </tr>
            </thead>
            <tbody>
              {readyItems.map((item) => {
                const remaining = item.quantity - (Number(item.dispatched_qty) || 0);
                const isSelected = selectedItems[item.id] !== undefined;
                return (
                  <tr key={item.id} className={`border-b border-n-100 ${isSelected ? 'bg-p-50' : ''}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(item.id, remaining)}
                        className="rounded border-n-300"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">{item.item_description}</td>
                    <td className="px-3 py-2 text-n-500">{item.item_category.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-right font-mono">{remaining} {item.unit}</td>
                    <td className="px-3 py-2 text-right">
                      {isSelected ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => updateQty(item.id, (selectedItems[item.id] ?? 0) - 1)}
                            className="w-5 h-5 flex items-center justify-center rounded bg-n-100 hover:bg-n-200"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <Input
                            value={selectedItems[item.id]?.toString() ?? '0'}
                            onChange={(e) => updateQty(item.id, parseFloat(e.target.value) || 0)}
                            type="number"
                            min="0"
                            max={remaining}
                            className="h-6 w-[60px] text-xs text-right font-mono"
                          />
                          <button
                            onClick={() => updateQty(item.id, Math.min((selectedItems[item.id] ?? 0) + 1, remaining))}
                            className="w-5 h-5 flex items-center justify-center rounded bg-n-100 hover:bg-n-200"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-n-400">{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transport details */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-n-600 block mb-1">Vehicle Number</label>
          <Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} className="text-xs h-8" placeholder="TN 01 AB 1234" />
        </div>
        <div>
          <label className="text-xs font-medium text-n-600 block mb-1">Driver Name</label>
          <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} className="text-xs h-8" />
        </div>
        <div>
          <label className="text-xs font-medium text-n-600 block mb-1">Dispatch From</label>
          <Input value={dispatchFrom} onChange={(e) => setDispatchFrom(e.target.value)} className="text-xs h-8" />
        </div>
        <div>
          <label className="text-xs font-medium text-n-600 block mb-1">Ship To (Site Address)</label>
          <Input value={dispatchTo} onChange={(e) => setDispatchTo(e.target.value)} className="text-xs h-8" placeholder="Auto-filled from project" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-n-600 block mb-1">Notes</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs h-8" placeholder="Any special instructions..." />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center justify-between pt-2 border-t border-n-200">
        <span className="text-xs text-n-500">
          {Object.values(selectedItems).filter((q) => q > 0).length} items selected
        </span>
        <Button size="sm" onClick={handleCreate} disabled={saving}>
          <Truck className="h-3.5 w-3.5 mr-1.5" />
          {saving ? 'Creating...' : 'Create DC'}
        </Button>
      </div>
    </div>
  );
}
