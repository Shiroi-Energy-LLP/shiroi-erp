'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { approveClosure, rejectClosure } from '@/lib/closure-actions';

/**
 * Founder-only Approve / Reject controls for a pending lead_closure_approvals row.
 *
 * Approve → flips the lead to Won via server action.
 * Reject  → prompts for a reason, marks the approval rejected, lead stays in closure_soon.
 */
export function ClosureApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveClosure(approvalId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    const reason = window.prompt('Rejection reason (required):', '');
    if (!reason || reason.trim() === '') return;

    startTransition(async () => {
      const result = await rejectClosure(approvalId, reason);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Button
        size="sm"
        variant="secondary"
        onClick={handleReject}
        disabled={isPending}
      >
        Reject
      </Button>
      <Button size="sm" onClick={handleApprove} disabled={isPending}>
        {isPending ? '...' : 'Approve'}
      </Button>
      {error && <span className="text-xs text-red-600 ml-2">{error}</span>}
    </div>
  );
}
