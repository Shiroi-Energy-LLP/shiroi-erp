'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { toggleTaskStatus } from '@/lib/tasks-actions';

/**
 * "Mark Paid" button for a payment_followup / payment_escalation task row.
 *
 * Reuses the existing toggleTaskStatus action from tasks-actions.ts - the
 * task category is not affected, just the is_completed flag. When marking
 * a payment_followup complete, the related payment_escalation (if any)
 * stays open until manually closed or its own SLA clears.
 */
export function MarkFollowupCompleteButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await toggleTaskStatus(taskId, true);
      if (!result.success) {
        alert(`Failed to mark complete: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="secondary" onClick={handleClick} disabled={isPending}>
      {isPending ? '...' : 'Mark Paid'}
    </Button>
  );
}
