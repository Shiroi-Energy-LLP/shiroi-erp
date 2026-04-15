'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { attemptWon } from '@/lib/closure-actions';

/**
 * "Attempt Won" button for the Closure Soon stage.
 *
 * Branches by discount band (classified server-side from live BOM margin):
 *   green  → immediate flip to Won
 *   amber  → creates a pending lead_closure_approvals row, notifies founder
 *   red    → rejects with an error toast
 *
 * The server action is the single source of truth for band classification —
 * this component just surfaces the outcome to the marketing_manager.
 */
export function AttemptWonButton({
  leadId,
  disabled,
}: {
  leadId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setSuccess(null);
    const reason = window.prompt(
      'Reason for closure (shown to founder if approval needed, optional):',
      '',
    );
    // User hit Cancel
    if (reason === null) return;

    startTransition(async () => {
      const result = await attemptWon(leadId, reason || undefined);
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (result.data.outcome === 'won') {
        setSuccess('Lead flipped to Won!');
        router.refresh();
      } else {
        setSuccess(
          'Amber band — founder approval requested. The lead will flip to Won once approved.',
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={disabled || isPending}
      >
        {isPending ? 'Processing...' : 'Attempt Won'}
      </Button>
      {error && <p className="text-xs text-red-600 max-w-xs">{error}</p>}
      {success && <p className="text-xs text-green-700 max-w-xs">{success}</p>}
    </div>
  );
}
