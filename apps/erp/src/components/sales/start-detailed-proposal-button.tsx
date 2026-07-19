'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { createDraftDetailedProposal } from '@/lib/quote-actions';

/**
 * "Start Detailed Proposal" button wired to createDraftDetailedProposal().
 *
 * Replaces the old write-during-render auto-create on /design/[leadId] and the
 * /sales/[id]/proposal Quote tab (NEVER-DO #24 — a GET must not INSERT;
 * prefetch / concurrent renders double-fired the draft AND the
 * `proposal.requested` n8n event that WhatsApps the design head). Creation now
 * happens only on an explicit click. The action is idempotent, so a double
 * click just returns the existing draft. On success we refresh the route so the
 * server component re-reads the freshly-set draft_proposal_id and reveals the
 * BOM editor.
 */
export function StartDetailedProposalButton({
  leadId,
  label = 'Start Detailed Proposal',
}: {
  leadId: string;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createDraftDetailedProposal(leadId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={isPending}>
        {isPending ? 'Starting…' : label}
      </Button>
      {error && <p className="text-xs text-red-600 max-w-md">{error}</p>}
    </div>
  );
}
