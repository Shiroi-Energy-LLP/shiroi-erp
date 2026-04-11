'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@repo/ui';
import { Check, Package, ArrowUpDown } from 'lucide-react';
import { formatINR } from '@repo/ui/formatters';
import {
  assignVendorToBoqItem,
  bulkAssignVendor,
  createPOsFromAssignedItems,
  updateProcurementPriority,
  markItemsReceived,
  markItemsReadyToDispatch,
} from '@/lib/procurement-actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BoqItem {
  id: string;
  line_number: number;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  hsn_code: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_rate: number;
  total_price: number;
  procurement_status: string;
  vendor_id: string | null;
  vendor_name: string | null;
  purchase_order_id: string | null;
}

// ---------------------------------------------------------------------------
// Vendor Assignment Table
// ---------------------------------------------------------------------------

export function VendorAssignmentTable({
  projectId,
  items,
  vendors,
}: {
  projectId: string;
  items: BoqItem[];
  vendors: { id: string; company_name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [bulkVendor, setBulkVendor] = React.useState('');
  const [creatingPOs, setCreatingPOs] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const assignableItems = items.filter((i) => i.procurement_status === 'yet_to_place');
  const assignedWithVendor = items.filter(
    (i) => i.vendor_id && i.procurement_status === 'yet_to_place',
  );
  const orderedItems = items.filter((i) => i.procurement_status === 'order_placed');
  const receivedItems = items.filter((i) =>
    ['received', 'ready_to_dispatch', 'delivered'].includes(i.procurement_status),
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === assignableItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(assignableItems.map((i) => i.id)));
    }
  }

  async function handleBulkAssign() {
    if (!bulkVendor || selected.size === 0) return;
    setSaving(true);
    setMessage(null);
    const result = await bulkAssignVendor({
      boqItemIds: Array.from(selected),
      vendorId: bulkVendor,
      projectId,
    });
    setSaving(false);
    if (result.success) {
      setMessage(`Assigned ${selected.size} items`);
      setSelected(new Set());
      setBulkVendor('');
      router.refresh();
    } else {
      setMessage(result.error ?? 'Failed');
    }
  }

  async function handleCreatePOs() {
    const itemsToProcess = assignedWithVendor.map((i) => i.id);
    if (itemsToProcess.length === 0) {
      setMessage('No items with vendor assignments to create POs from');
      return;
    }
    if (!confirm(`Create Purchase Orders for ${itemsToProcess.length} items grouped by vendor?`)) return;
    setCreatingPOs(true);
    setMessage(null);
    const result = await createPOsFromAssignedItems({ projectId, boqItemIds: itemsToProcess });
    setCreatingPOs(false);
    if (result.success) {
      setMessage(`Created ${result.poCount} Purchase Order(s)`);
      router.refresh();
    } else {
      setMessage(result.error ?? 'Failed');
    }
  }

  async function handleMarkReceived() {
    const toMark = orderedItems.map((i) => i.id);
    if (toMark.length === 0) return;
    if (!confirm(`Mark ${toMark.length} items as Received?`)) return;
    setSaving(true);
    const result = await markItemsReceived({ boqItemIds: toMark, projectId });
    setSaving(false);
    if (result.success) { setMessage('Items marked as Received'); router.refresh(); }
    else setMessage(result.error ?? 'Failed');
  }

  async function handleReadyToDispatch() {
    const toMark = items.filter((i) => i.procurement_status === 'received').map((i) => i.id);
    if (toMark.length === 0) return;
    if (!confirm(`Mark ${toMark.length} items as Ready to Dispatch?`)) return;
    setSaving(true);
    const result = await markItemsReadyToDispatch({ boqItemIds: toMark, projectId });
    setSaving(false);
    if (result.success) { setMessage('Items marked Ready to Dispatch'); router.refresh(); }
    else setMessage(result.error ?? 'Failed');
  }

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-n-200 bg-n-50">
        {/* Bulk vendor assignment */}
        {assignableItems.length > 0 && (
          <>
            <label className="text-[10px] text-n-500 font-medium">Assign Vendor:</label>
            <select
              value={bulkVendor}
              onChange={(e) => setBulkVendor(e.target.value)}
              className="h-7 text-[11px] border border-n-200 rounded px-1.5 max-w-[180px]"
            >
              <option value="">Select vendor...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.company_name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] px-2"
              disabled={!bulkVendor || selected.size === 0 || saving}
              onClick={handleBulkAssign}
            >
              {saving ? '...' : `Assign (${selected.size})`}
            </Button>
            <div className="w-px h-5 bg-n-200 mx-1" />
          </>
        )}

        {/* Create POs */}
        {assignedWithVendor.length > 0 && (
          <Button
            size="sm"
            className="h-7 text-[10px] px-2 gap-1"
            disabled={creatingPOs}
            onClick={handleCreatePOs}
          >
            <Package className="h-3 w-3" />
            {creatingPOs ? 'Creating...' : `Create POs (${assignedWithVendor.length} items)`}
          </Button>
        )}

        {/* Mark Received */}
        {orderedItems.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] px-2 gap-1"
            disabled={saving}
            onClick={handleMarkReceived}
          >
            <Check className="h-3 w-3" />
            Mark Received ({orderedItems.length})
          </Button>
        )}

        {/* Ready to Dispatch */}
        {items.filter((i) => i.procurement_status === 'received').length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] px-2 gap-1 text-purple-700 border-purple-200 hover:bg-purple-50"
            disabled={saving}
            onClick={handleReadyToDispatch}
          >
            Ready to Dispatch ({items.filter((i) => i.procurement_status === 'received').length})
          </Button>
        )}

        {message && (
          <span className="text-[10px] text-p-600 font-medium ml-auto">{message}</span>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-n-200 bg-n-50 text-left">
              {assignableItems.length > 0 && (
                <th className="px-2 py-1.5 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === assignableItems.length && assignableItems.length > 0}
                    onChange={selectAll}
                    className="h-3 w-3"
                  />
                </th>
              )}
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase w-8">#</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Category</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Description</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Brand</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">HSN</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase text-right">Qty</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase text-right">Rate</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase text-right">Total</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase w-[160px]">Vendor</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isAssignable = item.procurement_status === 'yet_to_place';
              return (
                <tr key={item.id} className="border-b border-n-100 hover:bg-n-50">
                  {assignableItems.length > 0 && (
                    <td className="px-2 py-1.5">
                      {isAssignable ? (
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="h-3 w-3"
                        />
                      ) : null}
                    </td>
                  )}
                  <td className="px-2 py-1 text-[10px] font-mono text-n-400">{item.line_number}</td>
                  <td className="px-2 py-1 text-[11px] font-medium text-n-800">
                    {(item.item_category || '').replace(/_/g, ' ')}
                  </td>
                  <td className="px-2 py-1 text-[11px] text-n-700 max-w-[200px] truncate" title={item.item_description}>
                    {item.item_description}
                  </td>
                  <td className="px-2 py-1 text-[10px] text-n-500">
                    {[item.brand, item.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-2 py-1 text-[10px] text-n-400 font-mono">{item.hsn_code || '—'}</td>
                  <td className="px-2 py-1 text-[11px] text-right font-mono">{item.quantity} {item.unit}</td>
                  <td className="px-2 py-1 text-[11px] text-right font-mono">{formatINR(Number(item.unit_price))}</td>
                  <td className="px-2 py-1 text-[11px] text-right font-mono font-medium">{formatINR(Number(item.total_price))}</td>
                  <td className="px-2 py-1">
                    {isAssignable ? (
                      <VendorInlineSelect
                        boqItemId={item.id}
                        projectId={projectId}
                        vendors={vendors}
                        currentVendorId={item.vendor_id}
                        currentVendorName={item.vendor_name}
                      />
                    ) : (
                      <span className="text-[10px] text-n-600">{item.vendor_name || '—'}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <StatusBadge status={item.procurement_status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Vendor Select per item
// ---------------------------------------------------------------------------

function VendorInlineSelect({
  boqItemId,
  projectId,
  vendors,
  currentVendorId,
  currentVendorName,
}: {
  boqItemId: string;
  projectId: string;
  vendors: { id: string; company_name: string }[];
  currentVendorId: string | null;
  currentVendorName: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const vendorId = e.target.value || null;
    setSaving(true);
    await assignVendorToBoqItem({ boqItemId, vendorId, projectId });
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={currentVendorId ?? ''}
      onChange={handleChange}
      disabled={saving}
      className="h-6 text-[10px] border border-n-200 rounded px-1 w-full max-w-[150px] bg-white"
    >
      <option value="">— Select —</option>
      {vendors.map((v) => (
        <option key={v.id} value={v.id}>{v.company_name}</option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Priority Toggle
// ---------------------------------------------------------------------------

export function PriorityToggle({
  projectId,
  currentPriority,
}: {
  projectId: string;
  currentPriority: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function toggle() {
    const newPriority = currentPriority === 'high' ? 'medium' : 'high';
    setSaving(true);
    await updateProcurementPriority({
      projectId,
      priority: newPriority as 'high' | 'medium',
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <Button
      size="sm"
      variant={currentPriority === 'high' ? 'default' : 'outline'}
      className={`h-7 text-[10px] px-2 gap-1 ${currentPriority === 'high' ? 'bg-red-600 hover:bg-red-700' : ''}`}
      onClick={toggle}
      disabled={saving}
    >
      <ArrowUpDown className="h-3 w-3" />
      Priority: {currentPriority === 'high' ? 'High' : 'Medium'}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'yet_to_place':
      return <Badge variant="warning" className="text-[9px] px-1 py-0">Yet to Place</Badge>;
    case 'order_placed':
      return <Badge variant="info" className="text-[9px] px-1 py-0">Ordered</Badge>;
    case 'received':
      return <Badge variant="success" className="text-[9px] px-1 py-0">Received</Badge>;
    case 'ready_to_dispatch':
      return <Badge variant="default" className="text-[9px] px-1 py-0 bg-purple-100 text-purple-700">Ready</Badge>;
    case 'delivered':
      return <Badge variant="success" className="text-[9px] px-1 py-0">Delivered</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px] px-1 py-0">{status}</Badge>;
  }
}
