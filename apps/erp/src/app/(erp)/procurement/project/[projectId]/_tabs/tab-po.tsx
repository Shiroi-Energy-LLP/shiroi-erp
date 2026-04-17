/**
 * Tab 4 — POs: list + approval workflow.
 *
 * Phase 5 wired up:
 *   - Pending approvals banner shows inline Approve / Reject for founders
 *   - Per-row approval-actions column routes draft/rejected POs back to the
 *     Purchase Engineer for re-submission
 *   - Approval status column stays for read-only visibility
 *
 * Send-to-vendor (markPODispatched) + Gmail/WhatsApp send modal for the PO
 * itself land in Phase 6 alongside the dispatch tab.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { FileCheck, AlertTriangle } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { POListItem } from '@/lib/procurement-queries';
import { POStatusBadge } from '@/components/procurement/po-status-badge';
import { POApprovalActions } from '../_client/po-approval-actions';

type AppRole = Database['public']['Enums']['app_role'];
type PurchaseOrder = Database['public']['Tables']['purchase_orders']['Row'];

interface TabPoProps {
  projectId: string;
  purchaseOrders: POListItem[];
  pendingApprovals: PurchaseOrder[];
  viewerRole: AppRole;
  viewerId: string | null;
  viewerEmployeeId: string | null;
}

export function TabPo({
  projectId,
  purchaseOrders,
  pendingApprovals,
  viewerRole,
  viewerEmployeeId,
}: TabPoProps) {
  const pendingForThisProject = pendingApprovals.filter((po) => po.project_id === projectId);
  const isFounder = viewerRole === 'founder';

  // Build a quick lookup from the project-scoped POs so we can show vendor name
  // in the pending-approvals banner without a second query.
  const vendorNameByPOId = new Map<string, string>();
  for (const po of purchaseOrders) {
    vendorNameByPOId.set(po.id, po.vendors?.company_name ?? '—');
  }

  return (
    <div className="space-y-4">
      {/* ── Pending approvals banner (founder only) ──────────────────────── */}
      {isFounder && pendingForThisProject.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              {pendingForThisProject.length} PO{pendingForThisProject.length === 1 ? '' : 's'} awaiting your approval
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="divide-y divide-amber-200">
              {pendingForThisProject.map((po) => (
                <div
                  key={po.id}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/procurement/${po.id}`}
                      className="text-[11px] font-medium text-p-700 hover:underline"
                    >
                      {po.po_number}
                    </Link>
                    <span className="text-[11px] text-n-700 ml-2">
                      {vendorNameByPOId.get(po.id) ?? '—'}
                    </span>
                    <span className="text-[11px] text-n-500 ml-2 font-mono">
                      {formatINR(po.total_amount)}
                    </span>
                  </div>
                  <POApprovalActions
                    po={{
                      id: po.id,
                      po_number: po.po_number,
                      approval_status: po.approval_status,
                      total_amount: po.total_amount,
                      prepared_by: po.prepared_by,
                    }}
                    viewerRole={viewerRole}
                    viewerEmployeeId={viewerEmployeeId}
                  />
                </div>
              ))}
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
                    <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Actions</th>
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
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] bg-red-100 text-red-700 w-fit">
                              Rejected
                            </Badge>
                            {po.approval_rejection_reason && (
                              <span className="text-[10px] text-n-500 max-w-[220px] truncate" title={po.approval_rejection_reason}>
                                {po.approval_rejection_reason}
                              </span>
                            )}
                          </div>
                        )}
                        {po.approval_status === 'draft' && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] bg-n-100 text-n-600">
                            Draft
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <POApprovalActions
                          po={{
                            id: po.id,
                            po_number: po.po_number,
                            approval_status: po.approval_status,
                            total_amount: po.total_amount,
                            prepared_by: po.prepared_by,
                          }}
                          viewerRole={viewerRole}
                          viewerEmployeeId={viewerEmployeeId}
                          compact
                        />
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
