'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast, Input, Label } from '@repo/ui';
import { CheckCircle, XCircle, Ban } from 'lucide-react';
import { approveLeaveRequest, rejectLeaveRequest, cancelLeaveRequest } from '@/lib/hr-actions';

interface LeaveActionButtonsProps {
  requestId: string;
  /** 'manager' shows approve/reject; 'employee' shows cancel only */
  mode: 'manager' | 'employee';
}

/**
 * Approve / Reject / Cancel buttons for a leave request.
 * Manager mode: approve + reject (with reason input).
 * Employee mode: cancel only.
 */
export function LeaveActionButtons({ requestId, mode }: LeaveActionButtonsProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [loading, setLoading] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  async function handleApprove() {
    setLoading('approve');
    const result = await approveLeaveRequest(requestId);
    setLoading(null);
    if (!result.success) {
      addToast({ variant: 'destructive', title: 'Failed to approve', description: result.error });
      return;
    }
    addToast({ variant: 'success', title: 'Leave approved', description: 'Leave request has been approved and balance updated.' });
    router.refresh();
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setLoading('reject');
    const result = await rejectLeaveRequest(requestId, rejectReason);
    setLoading(null);
    if (!result.success) {
      addToast({ variant: 'destructive', title: 'Failed to reject', description: result.error });
      return;
    }
    addToast({ variant: 'success', title: 'Leave rejected', description: 'Leave request has been rejected.' });
    setShowRejectForm(false);
    setRejectReason('');
    router.refresh();
  }

  async function handleCancel() {
    setLoading('cancel');
    const result = await cancelLeaveRequest(requestId);
    setLoading(null);
    if (!result.success) {
      addToast({ variant: 'destructive', title: 'Failed to cancel', description: result.error });
      return;
    }
    addToast({ variant: 'success', title: 'Leave cancelled', description: 'Leave request has been cancelled.' });
    router.refresh();
  }

  if (mode === 'employee') {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={loading === 'cancel'}
        onClick={handleCancel}
        className="text-red-600 border-red-200 hover:bg-red-50"
      >
        <Ban className="h-3.5 w-3.5 mr-1" />
        {loading === 'cancel' ? 'Cancelling...' : 'Cancel'}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={loading !== null}
          onClick={handleApprove}
          className="bg-green-700 hover:bg-green-800 text-white"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          {loading === 'approve' ? 'Approving...' : 'Approve'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading !== null}
          onClick={() => setShowRejectForm((v) => !v)}
          className="text-red-600 border-red-200 hover:bg-red-50"
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Reject
        </Button>
      </div>

      {showRejectForm && (
        <div className="border rounded-md p-3 bg-red-50 space-y-2">
          <Label htmlFor={`reject-reason-${requestId}`} className="text-xs text-red-700">
            Rejection reason *
          </Label>
          <Input
            id={`reject-reason-${requestId}`}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!rejectReason.trim() || loading === 'reject'}
              onClick={handleReject}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {loading === 'reject' ? 'Rejecting...' : 'Confirm Reject'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowRejectForm(false); setRejectReason(''); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
