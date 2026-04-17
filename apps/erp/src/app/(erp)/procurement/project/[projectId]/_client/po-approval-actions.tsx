'use client';

/**
 * PO Approval Actions (Phase 5).
 *
 * Compact button cluster rendered per PO row in Tab 4. Shows only the
 * transitions available to the current viewer:
 *
 *   approval_status=draft       → [Send for approval]   (any non-founder preparer)
 *   approval_status=pending_app → [Approve] [Reject]    (founder only)
 *   approval_status=rejected    → [Re-submit]           (preparer only)
 *   approval_status=approved    → (nothing — status badge covers it)
 *
 * Mutation actions fire fire-and-forget with a transient busy state; on
 * success we call `router.refresh()` so the parent server component re-queries.
 *
 * The reject modal is inline here so we don't need a separate file just for
 * a textarea.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui';
import { Send, Check, X, RefreshCw } from 'lucide-react';
import type { Database } from '@repo/types/database';
import { sendPOForApproval, approvePO, rejectPO } from '@/lib/po-actions';

type AppRole = Database['public']['Enums']['app_role'];

interface POApprovalActionsProps {
  po: {
    id: string;
    po_number: string;
    approval_status: string;
    total_amount: number;
    prepared_by: string;
  };
  viewerRole: AppRole;
  viewerEmployeeId: string | null;
  /** Compact rendering (icon-only buttons for tight table cells). */
  compact?: boolean;
}

export function POApprovalActions({
  po,
  viewerRole,
  viewerEmployeeId,
  compact = false,
}: POApprovalActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'send' | 'approve' | 'reject' | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const isFounder = viewerRole === 'founder';
  const isPreparer = viewerEmployeeId !== null && viewerEmployeeId === po.prepared_by;

  async function handleSend() {
    setError(null);
    setBusy('send');
    const res = await sendPOForApproval(po.id);
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function handleApprove() {
    setError(null);
    setBusy('approve');
    const res = await approvePO(po.id);
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setError('Rejection reason is required');
      return;
    }
    setError(null);
    setBusy('reject');
    const res = await rejectPO(po.id, rejectReason.trim());
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setRejectOpen(false);
    setRejectReason('');
    router.refresh();
  }

  // ── draft / rejected: preparer can (re-)submit for approval ─────────────
  if (po.approval_status === 'draft' || po.approval_status === 'rejected') {
    if (!isPreparer && !isFounder) return null;
    return (
      <div className="inline-flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] px-1.5 gap-1"
          disabled={busy !== null}
          onClick={handleSend}
          title={po.approval_status === 'rejected' ? 'Re-submit for approval' : 'Send for approval'}
        >
          {po.approval_status === 'rejected' ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          {!compact && (busy === 'send' ? 'Sending…' : po.approval_status === 'rejected' ? 'Re-submit' : 'Send for approval')}
        </Button>
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>
    );
  }

  // ── pending_approval: founder approves or rejects ────────────────────────
  if (po.approval_status === 'pending_approval') {
    if (!isFounder) {
      return (
        <span className="text-[10px] text-amber-700 italic">Awaiting founder approval</span>
      );
    }
    return (
      <>
        <div className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-1.5 gap-1 border-green-300 text-green-700 hover:bg-green-50"
            disabled={busy !== null}
            onClick={handleApprove}
            title="Approve this PO"
          >
            <Check className="h-3 w-3" />
            {!compact && (busy === 'approve' ? 'Approving…' : 'Approve')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-1.5 gap-1 border-red-300 text-red-700 hover:bg-red-50"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setRejectReason('');
              setRejectOpen(true);
            }}
            title="Reject this PO"
          >
            <X className="h-3 w-3" />
            {!compact && 'Reject'}
          </Button>
          {error && <span className="text-[10px] text-red-600">{error}</span>}
        </div>

        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">
                Reject PO {po.po_number}
              </DialogTitle>
              <DialogDescription className="text-xs text-n-500">
                The Purchase Engineer who prepared this PO will be notified with
                your reason. They can revise and re-submit.
              </DialogDescription>
            </DialogHeader>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                Reason for rejection
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                placeholder="e.g. rate too high — re-quote with vendor, missing delivery timeline, etc."
                className="w-full text-[11px] border border-n-200 rounded px-2 py-1.5"
                autoFocus
              />
            </div>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[11px]"
                disabled={busy === 'reject'}
                onClick={() => setRejectOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 text-[11px]"
                disabled={busy === 'reject' || !rejectReason.trim()}
                onClick={handleReject}
              >
                {busy === 'reject' ? 'Rejecting…' : 'Reject PO'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return null;
}
