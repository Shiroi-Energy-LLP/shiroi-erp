'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@repo/ui';
import { ChevronRight } from 'lucide-react';
import { advanceProjectStatus } from '@/lib/project-step-actions';
import { getNextStatus, getStatusLabel } from '@/lib/project-status-helpers';

interface AdvanceStatusButtonProps {
  projectId: string;
  currentStatus: string;
}

export function AdvanceStatusButton({ projectId, currentStatus }: AdvanceStatusButtonProps) {
  const router = useRouter();
  const [advancing, setAdvancing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const nextStatus = getNextStatus(currentStatus);

  // Don't show if already at final status, on_hold, or cancelled
  if (!nextStatus || currentStatus === 'on_hold' || currentStatus === 'cancelled' || currentStatus === 'completed') {
    return null;
  }

  async function handleAdvance() {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setAdvancing(true);
    setError(null);

    const result = await advanceProjectStatus({ projectId, currentStatus });

    setAdvancing(false);
    setConfirming(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to advance status');
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className="capitalize">
          {getStatusLabel(currentStatus)}
        </Badge>
        <ChevronRight className="h-4 w-4 text-n-400" />
        <Badge variant="default" className="capitalize">
          {getStatusLabel(nextStatus)}
        </Badge>
      </div>

      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-n-500">Are you sure?</span>
          <Button size="sm" onClick={handleAdvance} disabled={advancing}>
            {advancing ? 'Advancing...' : 'Yes, Advance'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="default" onClick={handleAdvance}>
          Advance Status <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}

      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
