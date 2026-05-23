'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { markSiteDesignComplete } from '@/lib/projects-design-request-actions';

interface MarkSiteDesignCompleteButtonProps {
  projectId: string;
}

/**
 * Inline "Mark complete" button for the /design page Section 2 table rows.
 * Role-gating is handled server-side (parent only renders this for allowed roles).
 */
export function MarkSiteDesignCompleteButton({ projectId }: MarkSiteDesignCompleteButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handle() {
    setBusy(true);
    setError(null);
    const result = await markSiteDesignComplete(projectId);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={handle}
        disabled={busy}
        className="text-xs text-n-500 hover:text-n-800 h-6 px-2"
      >
        {busy ? 'Saving…' : 'Mark complete'}
      </Button>
      {error && <span className="text-xs text-red-600 whitespace-nowrap">{error}</span>}
    </div>
  );
}
