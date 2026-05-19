'use client';

import { useState, useTransition } from 'react';
import { toggleProposalGateBypass } from '@/lib/leads-actions';

/**
 * Small toggle that lets a founder or marketing_manager bypass the
 * "must have a proposal to mark Won" gate (mig 107 + mig 109).
 *
 * Visible only when the parent (layout.tsx) has determined the caller has
 * the right role — the server action enforces it server-side regardless.
 *
 * When ON: amber banner reads "Cleanup mode — Won is allowed without a proposal."
 * When OFF: standard "No proposal yet" text.
 */
export function ProposalGateBypassToggle({
  leadId,
  currentlyBypassed,
}: {
  leadId: string;
  currentlyBypassed: boolean;
}) {
  const [bypassed, setBypassed] = useState(currentlyBypassed);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !bypassed;
    setError(null);
    startTransition(async () => {
      const result = await toggleProposalGateBypass(leadId, next);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setBypassed(next);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={[
          'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
          bypassed
            ? 'border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200'
            : 'border-n-200 bg-white text-n-700 hover:bg-n-50',
          isPending ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
        aria-pressed={bypassed}
      >
        <span
          className={[
            'h-3.5 w-7 rounded-full transition-colors',
            bypassed ? 'bg-amber-500' : 'bg-n-300',
          ].join(' ')}
        >
          <span
            className={[
              'block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
              bypassed ? 'translate-x-3.5' : 'translate-x-0',
            ].join(' ')}
          />
        </span>
        {isPending ? 'Saving...' : bypassed ? 'Gate bypassed (cleanup mode)' : 'Skip proposal gate'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
