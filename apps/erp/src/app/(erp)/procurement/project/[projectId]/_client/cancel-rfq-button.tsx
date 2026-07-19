'use client';

/**
 * CancelRfqButton — per-RFQ "Cancel" action shown in the RFQ list (tab-rfq).
 *
 * Opens a confirm dialog requiring a cancellation reason, then calls
 * cancelRfq() server action which flips rfqs.status='cancelled' and expires
 * any pending invitations. Hidden for already-cancelled / awarded RFQs.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
} from '@repo/ui';
import { Ban } from 'lucide-react';
import { cancelRfq } from '@/lib/rfq-actions';

interface CancelRfqButtonProps {
  rfqId: string;
  rfqNumber: string;
  status: string;
}

export function CancelRfqButton({ rfqId, rfqNumber, status }: CancelRfqButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Cancellation only makes sense for in-flight statuses.
  const canCancel = status === 'draft' || status === 'sent' || status === 'comparing';
  if (!canCancel) return null;

  async function handleConfirm() {
    if (!reason.trim()) {
      setError('Please provide a cancellation reason');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await cancelRfq(rfqId, reason.trim());
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? 'Failed to cancel RFQ');
      return;
    }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  return (
    <>
      <button
        title={`Cancel ${rfqNumber}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-0.5 h-5 px-1.5 text-[10px] rounded border border-n-200 text-red-700 hover:bg-red-50"
      >
        <Ban className="h-2.5 w-2.5" /> Cancel
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {rfqNumber}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-n-700">
            This will mark the RFQ as cancelled and expire any pending invitations.
            Submitted quotes will be retained for audit. This cannot be undone.
          </p>
          <div className="space-y-1">
            <Label htmlFor="cancelReason" className="text-xs">
              Reason <span className="text-red-500">*</span>
            </Label>
            <textarea
              id="cancelReason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              rows={3}
              placeholder="e.g. Customer changed scope, vendors unresponsive…"
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-p-400"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Keep RFQ
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={saving}
            >
              {saving ? 'Cancelling…' : 'Cancel RFQ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
