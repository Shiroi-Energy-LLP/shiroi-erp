/**
 * /procurement/requisitions — Material Requisition inbox.
 *
 * PM and purchase_officer see all pending requests across all projects.
 * Site supervisors see only their own (filtered client-side; server fetches all
 * they can see per RLS).
 *
 * Role access: founder, project_manager, purchase_officer, site_supervisor.
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Eyebrow } from '@repo/ui';
import { ClipboardList, Package } from 'lucide-react';
import { formatDate } from '@repo/ui/formatters';
import { getPendingMaterialRequisitions } from '@/lib/material-requisition-queries';
import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { RequisitionReviewActions } from '@/components/procurement/requisition-review-actions';
import { SubmitRequisitionButton } from '@/components/procurement/submit-requisition-button';

const URGENCY_CLASSES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  urgent: 'bg-amber-100 text-amber-800 border-amber-300',
  normal: 'bg-n-100 text-n-700 border-n-200',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  converted: 'bg-blue-50 text-blue-700 border-blue-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

export default async function RequisitionsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const role = profile.role;
  if (!['founder', 'project_manager', 'purchase_officer', 'site_supervisor', 'finance'].includes(role)) {
    redirect('/dashboard');
  }

  const canReview = ['founder', 'project_manager', 'purchase_officer'].includes(role);
  const canSubmit = ['founder', 'project_manager', 'purchase_officer', 'site_supervisor'].includes(role);

  const requisitions = await getPendingMaterialRequisitions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">PROCUREMENT</Eyebrow>
          <h1 className="text-2xl font-bold text-n-900">Material Requests</h1>
          <p className="text-sm text-n-500 mt-0.5">
            Pending and approved material requests from site teams.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/procurement">
            <Button variant="outline" size="sm">All POs</Button>
          </Link>
          {canSubmit && <SubmitRequisitionButton />}
        </div>
      </div>

      {requisitions.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Package className="w-10 h-10 text-n-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-n-700">No pending material requests</p>
            <p className="text-xs text-n-500 mt-1">
              Site teams can submit requests using the button above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requisitions.map((req) => {
            const items = (req.items as Array<{ description: string; quantity: number; unit: string; notes?: string }>) ?? [];
            return (
              <Card key={req.id} className={req.urgency === 'critical' ? 'border-red-300' : undefined}>
                <CardHeader className="py-3 px-4 pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-n-500 flex-shrink-0" />
                      <div>
                        {req.project ? (
                          <Link
                            href={`/procurement/project/${req.project_id}`}
                            className="text-sm font-semibold text-p-700 hover:underline"
                          >
                            {req.project.project_number} — {req.project.customer_name}
                          </Link>
                        ) : (
                          <span className="text-sm font-semibold text-n-700">Project unknown</span>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-n-500">
                            by {req.requester?.full_name ?? 'Unknown'}
                          </span>
                          <span className="text-[10px] text-n-400">
                            {formatDate(req.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 h-5 ${URGENCY_CLASSES[req.urgency] ?? ''}`}
                      >
                        {req.urgency.toUpperCase()}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 h-5 ${STATUS_CLASSES[req.status] ?? ''}`}
                      >
                        {req.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 py-3">
                  {/* Items list */}
                  <div className="space-y-1.5 mb-3">
                    {items.slice(0, 5).map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px]">
                        <span className="text-n-400 font-mono w-4 text-right flex-shrink-0">{idx + 1}.</span>
                        <span className="font-medium text-n-800">{item.description}</span>
                        <span className="text-n-500 flex-shrink-0">
                          {item.quantity} {item.unit}
                        </span>
                        {item.notes && (
                          <span className="text-n-400 italic truncate max-w-[200px]">— {item.notes}</span>
                        )}
                      </div>
                    ))}
                    {items.length > 5 && (
                      <p className="text-[10px] text-n-400 pl-6">
                        + {items.length - 5} more items
                      </p>
                    )}
                  </div>

                  {/* Notes */}
                  {req.notes && (
                    <p className="text-[11px] text-n-600 bg-n-50 rounded px-2 py-1.5 mb-3">
                      Note: {req.notes}
                    </p>
                  )}

                  {/* Review outcome (if already reviewed) */}
                  {req.review_notes && (
                    <p className="text-[11px] text-n-500 italic mb-3">
                      Review: {req.review_notes}
                    </p>
                  )}

                  {/* Converted PO link */}
                  {req.converted_po && req.converted_po_id && (
                    <div className="mb-3">
                      <Link
                        href={`/procurement/${req.converted_po_id}`}
                        className="text-[11px] text-p-600 hover:underline"
                      >
                        Converted to PO: {req.converted_po.po_number}
                      </Link>
                    </div>
                  )}

                  {/* Action buttons — only for reviewers and only for reviewable states */}
                  {canReview && (req.status === 'pending' || req.status === 'approved') && (
                    <RequisitionReviewActions
                      requisitionId={req.id}
                      currentStatus={req.status}
                      projectId={req.project_id}
                      items={items}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
