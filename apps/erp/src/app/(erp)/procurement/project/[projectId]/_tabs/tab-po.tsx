/**
 * Tab 4 — POs: list, approval workflow, send to vendor.
 *
 * Placeholder rendered by Phase 3. Phase 5 adds the full approval workflow
 * (`sendPOForApproval` / `approvePO` / `rejectPO`) + Gmail/WhatsApp send modal.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { FileCheck, AlertTriangle } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { POListItem } from '@/lib/procurement-queries';
import { POStatusBadge } from '@/components/procurement/po-status-badge';

type AppRole = Database['public']['Enums']['app_role'];
type PurchaseOrder = Database['public']['Tables']['purchase_orders']['Row'];

interface TabPoProps {
  projectId: string;
  purchaseOrders: POListItem[];
  pendingApprovals: PurchaseOrder[];
  viewerRole: AppRole;
  viewerId: string | null;
}

export function TabPo({ projectId, purchaseOrders, pendingApprovals, viewerRole }: TabPoProps) {
  const pendingForThisProject = pendingApprovals.filter((po) => po.project_id === projectId);
  const isFounder = viewerRole === 'founder';

  return (
    <div className="space-y-4">
      {/* ── Pending approvals banner (founder only) ──────────────────────── */}
      {isFounder && pendingForThisProject.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {pendingForThisProject.length} PO{pendingForThisProject.length === 1 ? '' : 's'} awaiting your approval
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Approval controls land in Phase 5.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PO list ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">
            Purchase Orders ({purchaseOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {purchaseOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileCheck className="w-10 h-10 text-n-300 mb-2" />
              <p className="text-sm font-medium text-n-700">No POs yet</p>
              <p className="text-xs text-n-500 mt-1">
                Award quotes in the Compare tab (or use Quick PO from the BOQ tab) to generate POs here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">PO #</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Vendor</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Date</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Amount</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Status</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.map((po) => (
                    <tr key={po.id} className="border-b border-n-100 hover:bg-n-50">
                      <td className="px-3 py-2 text-[11px]">
                        <Link href={`/procurement/${po.id}`} className="text-p-600 hover:underline font-medium">
                          {po.po_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-n-700">{po.vendors?.company_name ?? '—'}</td>
                      <td className="px-3 py-2 text-[10px] text-n-500">{formatDate(po.po_date)}</td>
                      <td className="px-3 py-2 text-[11px] text-right font-mono">{formatINR(po.total_amount)}</td>
                      <td className="px-3 py-2"><POStatusBadge status={po.status} /></td>
                      <td className="px-3 py-2">
                        {po.approval_status === 'pending_approval' && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] bg-amber-100 text-amber-700">
                            Pending
                          </Badge>
                        )}
                        {po.approval_status === 'approved' && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] bg-green-100 text-green-700">
                            Approved
                          </Badge>
                        )}
                        {po.approval_status === 'rejected' && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] bg-red-100 text-red-700">
                            Rejected
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
