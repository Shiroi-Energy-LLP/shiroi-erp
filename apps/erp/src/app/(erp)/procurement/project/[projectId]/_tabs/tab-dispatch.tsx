/**
 * Tab 5 — Dispatch tracking.
 *
 * Per-PO row with the full lifecycle timeline. After Phase 6 each row exposes
 * the next available action (Mark dispatched → Record vendor dispatch → Mark
 * received) through the <DispatchActions> client component.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { Truck } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { POListItem } from '@/lib/procurement-queries';
import { POStatusBadge } from '@/components/procurement/po-status-badge';
import { DispatchActions } from '../_client/dispatch-actions';

type AppRole = Database['public']['Enums']['app_role'];

interface TabDispatchProps {
  projectId: string;
  purchaseOrders: POListItem[];
  viewerRole: AppRole;
}

export function TabDispatch({ purchaseOrders, viewerRole }: TabDispatchProps) {
  // A PO is "trackable" once it's been approved — we list approved drafts (so
  // engineers can mark them dispatched), dispatched rows, and acknowledged rows
  // (which act as the closed log for this project).
  const trackable = purchaseOrders.filter(
    (po) =>
      po.approval_status === 'approved' &&
      (po.status === 'draft' || po.status === 'dispatched' || po.status === 'acknowledged'),
  );

  if (trackable.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Truck className="w-10 h-10 text-n-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-n-700">No dispatched POs yet</p>
          <p className="text-xs text-n-500 mt-1">
            Approved POs appear here once they&apos;re sent to the vendor.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-semibold">
          Dispatch ({trackable.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-n-200 bg-n-50">
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">PO #</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Vendor</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Sent to vendor</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Vendor shipped</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Tracking</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Received</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Status</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {trackable.map((po) => (
                <tr key={po.id} className="border-b border-n-100 hover:bg-n-50 align-top">
                  <td className="px-3 py-2 text-[11px]">
                    <Link
                      href={`/procurement/${po.id}`}
                      className="text-p-600 hover:underline font-medium"
                    >
                      {po.po_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-n-700">
                    {po.vendors?.company_name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-600">
                    {po.dispatched_at ? formatDate(po.dispatched_at) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-600">
                    {po.vendor_dispatch_date ? formatDate(po.vendor_dispatch_date) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-700 font-mono">
                    {po.vendor_tracking_number ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-600">
                    {po.acknowledged_at
                      ? formatDate(po.acknowledged_at)
                      : po.expected_delivery_date
                        ? <span className="text-n-400">ETA {formatDate(po.expected_delivery_date)}</span>
                        : '—'}
                  </td>
                  <td className="px-3 py-2"><POStatusBadge status={po.status} /></td>
                  <td className="px-3 py-2 text-right">
                    <DispatchActions
                      po={{
                        id: po.id,
                        po_number: po.po_number,
                        approval_status: po.approval_status,
                        status: po.status,
                        dispatched_at: po.dispatched_at,
                        vendor_dispatch_date: po.vendor_dispatch_date,
                        vendor_tracking_number: po.vendor_tracking_number,
                        expected_delivery_date: po.expected_delivery_date,
                      }}
                      viewerRole={viewerRole}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
