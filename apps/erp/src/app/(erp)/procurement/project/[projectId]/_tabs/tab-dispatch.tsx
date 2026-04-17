/**
 * Tab 5 — Dispatch tracking.
 *
 * Placeholder rendered by Phase 3. Phase 6 adds the per-PO timeline rows with
 * "Mark Dispatched" / "Mark Acknowledged" dialogs + vendor tracking inputs.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { Truck } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { POListItem } from '@/lib/procurement-queries';
import { POStatusBadge } from '@/components/procurement/po-status-badge';

type AppRole = Database['public']['Enums']['app_role'];

interface TabDispatchProps {
  projectId: string;
  purchaseOrders: POListItem[];
  viewerRole: AppRole;
}

export function TabDispatch({ purchaseOrders }: TabDispatchProps) {
  const trackable = purchaseOrders.filter(
    (po) => po.approval_status === 'approved' ||
            po.status === 'sent_to_vendor' ||
            po.status === 'acknowledged' ||
            po.dispatched_at !== null,
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
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Sent</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Ack</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Dispatched</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Tracking</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {trackable.map((po) => (
                <tr key={po.id} className="border-b border-n-100 hover:bg-n-50">
                  <td className="px-3 py-2 text-[11px]">
                    <Link href={`/procurement/${po.id}`} className="text-p-600 hover:underline font-medium">
                      {po.po_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-n-700">{po.vendors?.company_name ?? '—'}</td>
                  <td className="px-3 py-2 text-[10px] text-n-500">
                    {po.status === 'sent_to_vendor' || po.acknowledged_at || po.dispatched_at
                      ? formatDate(po.po_date)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-500">
                    {po.acknowledged_at ? formatDate(po.acknowledged_at) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-500">
                    {po.dispatched_at ? formatDate(po.dispatched_at) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-n-700 font-mono">
                    {po.vendor_tracking_number ?? '—'}
                  </td>
                  <td className="px-3 py-2"><POStatusBadge status={po.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-[11px] text-n-500 border-t border-n-100 bg-amber-50">
          ⚠ Mark Dispatched / Mark Acknowledged / tracking number edits land in Phase 6.
        </div>
      </CardContent>
    </Card>
  );
}
