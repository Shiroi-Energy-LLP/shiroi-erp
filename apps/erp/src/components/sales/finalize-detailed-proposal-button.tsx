'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { finalizeDetailedProposal } from '@/lib/quote-actions';

/**
 * "Generate Detailed Proposal" button wired to finalizeDetailedProposal().
 *
 * Server action recomputes totals against live price book, bakes in locked
 * consultant commission, stamps sent_at, flips lead to detailed_proposal_sent.
 * One click, no wizard. Used on the Quote tab after Design Confirmed.
 */
export function FinalizeDetailedProposalButton({
  proposalId,
  disabled,
}: {
  proposalId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await finalizeDetailedProposal(proposalId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={disabled || isPending}>
        {isPending ? 'Finalizing...' : 'Generate Detailed Proposal →'}
      </Button>
      {error && <p className="text-xs text-red-600 max-w-md">{error}</p>}
    </div>
  );
}
