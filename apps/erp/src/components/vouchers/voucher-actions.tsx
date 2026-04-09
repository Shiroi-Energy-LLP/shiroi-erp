'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Input } from '@repo/ui';
import { Check, X } from 'lucide-react';
import { approveSiteExpense, rejectSiteExpense } from '@/lib/site-expenses-actions';

interface VoucherActionsProps {
  expenseId: string;
}

export function VoucherActions({ expenseId }: VoucherActionsProps) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    const res = await approveSiteExpense(expenseId);
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to approve');
      return;
    }
    router.refresh();
  }

  async function handleReject() {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await rejectSiteExpense(expenseId, reason);
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to reject');
      return;
    }
    setRejectOpen(false);
    setReason('');
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center gap-1.5 justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
          disabled={busy}
          onClick={handleApprove}
        >
          <Check className="h-3.5 w-3.5 mr-1" /> Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-red-700 border-red-200 hover:bg-red-50"
          disabled={busy}
          onClick={() => setRejectOpen(true)}
        >
          <X className="h-3.5 w-3.5 mr-1" /> Reject
        </Button>
      </div>
      {error && <div className="text-[11px] text-red-600 text-right mt-1">{error}</div>}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Voucher</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm">
              <div className="text-xs text-n-500 mb-1">Reason</div>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Missing receipt / duplicate / not project-related…"
                autoFocus
              />
            </label>
            {error && (
              <div className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded border border-red-200">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-red-700 border-red-200 hover:bg-red-50"
              disabled={busy}
              onClick={handleReject}
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
