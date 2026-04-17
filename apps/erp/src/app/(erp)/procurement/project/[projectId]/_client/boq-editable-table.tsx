'use client';

/**
 * BOQ editable table (Tab 1).
 *
 * Competitive mode: select rows → "Send RFQ" → creates RFQ + routes to Tab 2.
 * Quick PO mode: select rows + single vendor → "Quick PO" → creates PO directly.
 *
 * Re-uses server actions from `procurement-actions.ts` (assignVendorToBoqItem,
 * bulkAssignVendor, createPOsFromAssignedItems). New "Send RFQ" flow routes
 * to Tab 2 with selected-items param.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Send, Zap, Package } from 'lucide-react';
import { formatINR } from '@repo/ui/formatters';
import type { Database } from '@repo/types/database';
import type { PurchaseDetailItem } from '@/lib/procurement-queries';
import {
  bulkAssignVendor,
  createPOsFromAssignedItems,
} from '@/lib/procurement-actions';

type AppRole = Database['public']['Enums']['app_role'];

interface BoqEditableTableProps {
  projectId: string;
  items: PurchaseDetailItem[];
  vendors: Array<{ id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>;
  viewerRole: AppRole;
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    yet_to_place: { label: 'Yet to Place', className: 'bg-amber-100 text-amber-700' },
    order_placed: { label: 'Ordered', className: 'bg-blue-100 text-blue-700' },
    received: { label: 'Received', className: 'bg-green-100 text-green-700' },
    ready_to_dispatch: { label: 'Ready', className: 'bg-purple-100 text-purple-700' },
    delivered: { label: 'Delivered', className: 'bg-n-200 text-n-700' },
  };
  const c = config[status] ?? { label: status, className: 'bg-n-100 text-n-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${c.className}`}>
      {c.label}
    </span>
  );
}

export function BoqEditableTable({
  projectId,
  items,
  vendors,
}: BoqEditableTableProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [quickPoVendor, setQuickPoVendor] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);

  const assignable = items.filter((i) => i.procurement_status === 'yet_to_place');

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === assignable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(assignable.map((i) => i.id)));
    }
  }

  function handleSendRfq() {
    if (selected.size === 0) {
      setMessage('Select at least one BOQ item first');
      return;
    }
    // Stash selection in sessionStorage so Tab 2 can pre-populate the panel
    try {
      sessionStorage.setItem(
        `rfq-preselect-${projectId}`,
        JSON.stringify(Array.from(selected)),
      );
    } catch {
      // sessionStorage may be disabled; Tab 2 will just start empty
    }
    router.push(`/procurement/project/${projectId}?tab=rfq`);
  }

  async function handleQuickPo() {
    if (!quickPoVendor) {
      setMessage('Select a vendor for Quick PO');
      return;
    }
    if (selected.size === 0) {
      setMessage('Select at least one BOQ item first');
      return;
    }
    if (!confirm(`Skip RFQ and create a Purchase Order for ${selected.size} items directly?`)) {
      return;
    }
    setSaving(true);
    setMessage(null);
    // Step 1: assign all selected items to the chosen vendor
    const assignRes = await bulkAssignVendor({
      boqItemIds: Array.from(selected),
      vendorId: quickPoVendor,
      projectId,
    });
    if (!assignRes.success) {
      setSaving(false);
      setMessage(assignRes.error ?? 'Vendor assignment failed');
      return;
    }
    // Step 2: create PO from those assignments
    const poRes = await createPOsFromAssignedItems({
      projectId,
      boqItemIds: Array.from(selected),
    });
    setSaving(false);
    if (poRes.success) {
      setMessage(`Created ${poRes.poCount} PO(s)`);
      setSelected(new Set());
      setQuickPoVendor('');
      router.refresh();
    } else {
      setMessage(poRes.error ?? 'PO creation failed');
    }
  }

  const selectedTotal = items
    .filter((i) => selected.has(i.id))
    .reduce((sum, i) => sum + Number(i.total_price || 0), 0);

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-n-200 bg-n-50">
        <span className="text-[11px] text-n-700 font-medium">
          {selected.size > 0
            ? `${selected.size} selected · ${formatINR(selectedTotal)}`
            : `${assignable.length} items ready for purchase`}
        </span>

        <div className="w-px h-5 bg-n-200 mx-1" />

        {/* Competitive flow — Send RFQ */}
        <Button
          size="sm"
          className="h-7 text-[10px] px-2 gap-1"
          disabled={selected.size === 0 || saving}
          onClick={handleSendRfq}
        >
          <Send className="h-3 w-3" />
          Send RFQ ({selected.size})
        </Button>

        <div className="w-px h-5 bg-n-200 mx-1" />

        {/* Quick PO path — skip RFQ */}
        <label className="text-[10px] text-n-500 font-medium">Or Quick PO to:</label>
        <select
          value={quickPoVendor}
          onChange={(e) => setQuickPoVendor(e.target.value)}
          className="h-7 text-[11px] border border-n-200 rounded px-1.5 max-w-[180px]"
          disabled={saving}
        >
          <option value="">Select vendor...</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.company_name}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] px-2 gap-1"
          disabled={!quickPoVendor || selected.size === 0 || saving}
          onClick={handleQuickPo}
        >
          <Zap className="h-3 w-3" />
          {saving ? '...' : `Quick PO (${selected.size})`}
        </Button>

        {message && (
          <span className="text-[10px] text-p-600 font-medium ml-auto">{message}</span>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-n-200 bg-n-50 text-left">
              <th className="px-2 py-1.5 w-8">
                {assignable.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selected.size === assignable.length && assignable.length > 0}
                    onChange={selectAll}
                    className="h-3 w-3"
                  />
                )}
              </th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase w-8">#</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Category</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Description</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">HSN</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase text-right">Qty</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase text-right">Rate</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase text-right">Total</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Status</th>
              <th className="px-2 py-1.5 text-[10px] font-semibold text-n-500 uppercase">Vendor</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center">
                  <Package className="w-8 h-8 text-n-300 mx-auto mb-2" />
                  <p className="text-xs text-n-500">No BOQ items yet. Send BOQ to purchase from the project page.</p>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isAssignable = item.procurement_status === 'yet_to_place';
                return (
                  <tr key={item.id} className="border-b border-n-100 hover:bg-n-50">
                    <td className="px-2 py-1.5">
                      {isAssignable && (
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="h-3 w-3"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1 text-[10px] font-mono text-n-400">{item.line_number}</td>
                    <td className="px-2 py-1 text-[11px] font-medium text-n-800">
                      {(item.item_category || '').replace(/_/g, ' ')}
                    </td>
                    <td className="px-2 py-1 text-[11px] text-n-700 max-w-[240px] truncate" title={item.item_description}>
                      {item.item_description}
                    </td>
                    <td className="px-2 py-1 text-[10px] text-n-400 font-mono">{item.hsn_code ?? '—'}</td>
                    <td className="px-2 py-1 text-[11px] text-right font-mono">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-2 py-1 text-[11px] text-right font-mono">
                      {formatINR(Number(item.unit_price))}
                    </td>
                    <td className="px-2 py-1 text-[11px] text-right font-mono font-medium">
                      {formatINR(Number(item.total_price))}
                    </td>
                    <td className="px-2 py-1"><StatusPill status={item.procurement_status} /></td>
                    <td className="px-2 py-1 text-[10px] text-n-600">{item.vendor_name ?? '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
