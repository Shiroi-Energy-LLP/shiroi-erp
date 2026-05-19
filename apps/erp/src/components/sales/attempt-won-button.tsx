'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { attemptWon, markWonSkipMargin } from '@/lib/closure-actions';

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
 *
 * Additionally, founder + marketing_manager see a secondary "Mark Won (skip
 * margin)" button (B3) which bypasses the margin check entirely. The DB
 * trigger for the proposal gate still runs; if it fires the error is surfaced.
 */
export function AttemptWonButton({
  leadId,
  disabled,
  canSkipMargin = false,
}: {
  leadId: string;
  disabled?: boolean;
  /** Pass true when the caller is founder or marketing_manager */
  canSkipMargin?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSkipPending, startSkipTransition] = useTransition();
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

  function handleSkipMargin() {
    const confirmed = window.confirm(
      'Mark Won (skip margin check)?\n\n' +
        'This bypasses the gross-margin check entirely. Use only for data cleanup or ' +
        'closures where BOM cost data is not tracked.\n\n' +
        'The proposal-gate rule still applies — if this lead has no proposal and the ' +
        'gate bypass is not enabled, the operation will fail.\n\n' +
        'Continue?',
    );
    if (!confirmed) return;

    const reason = window.prompt('Reason for skipping margin check (optional):', '') ?? '';

    setError(null);
    setSuccess(null);
    startSkipTransition(async () => {
      const result = await markWonSkipMargin(leadId, reason || undefined);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess('Lead marked Won (margin check skipped).');
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={handleClick}
          disabled={disabled || isPending || isSkipPending}
        >
          {isPending ? 'Processing...' : 'Attempt Won'}
        </Button>
        {canSkipMargin && (
          <Button
            variant="outline"
            onClick={handleSkipMargin}
            disabled={disabled || isPending || isSkipPending}
            className="text-amber-700 border-amber-400 hover:bg-amber-50"
          >
            {isSkipPending ? 'Processing...' : 'Mark Won (skip margin)'}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 max-w-xs">{error}</p>}
      {success && <p className="text-xs text-green-700 max-w-xs">{success}</p>}
    </div>
  );
}
