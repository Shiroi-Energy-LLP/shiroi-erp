'use client';

/**
 * ai-review-actions.tsx — S17 / D3
 *
 * Approve / Reject action buttons for the vendor bill detail page's AI review section.
 *
 * NEVER-DO compliance:
 * - #21: no server imports — only server action function calls via import
 * - #15: no inline Supabase
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@repo/ui';
import { approveAiVendorBill, rejectAiVendorBill } from '@/lib/vendor-bills-ai-actions';

interface ReviewActionsProps {
  billId: string;
}

export function ReviewActions({ billId }: ReviewActionsProps) {
  const [isPendingApprove, startApprove] = useTransition();
  const [isPendingReject, startReject] = useTransition();
  const router = useRouter();

  function handleApprove() {
    startApprove(async () => {
      const result = await approveAiVendorBill(billId);
      if (result.success) {
        router.push('/vendor-bills/review');
      } else {
        alert(`Approval failed: ${result.error}`);
      }
    });
  }

  function handleReject() {
    const reason = prompt('Enter rejection reason (required):');
    if (!reason || !reason.trim()) return;

    startReject(async () => {
      const result = await rejectAiVendorBill(billId, reason.trim());
      if (result.success) {
        router.push('/vendor-bills/review');
      } else {
        alert(`Rejection failed: ${result.error}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="default"
        className="bg-[#E08A00] hover:bg-[#C77606] text-[#1F1709] gap-2"
        disabled={isPendingApprove || isPendingReject}
        onClick={handleApprove}
      >
        <CheckCircle2 className="h-4 w-4" />
        {isPendingApprove ? 'Approving…' : 'Approve as Bill'}
      </Button>
      <Button
        variant="outline"
        className="border-[#991B1B] text-[#991B1B] hover:bg-[#991B1B] hover:text-white gap-2"
        disabled={isPendingApprove || isPendingReject}
        onClick={handleReject}
      >
        <XCircle className="h-4 w-4" />
        {isPendingReject ? 'Rejecting…' : 'Reject'}
      </Button>
    </div>
  );
}
