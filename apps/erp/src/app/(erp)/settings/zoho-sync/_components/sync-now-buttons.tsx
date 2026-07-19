'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@repo/ui';
import { triggerZohoSync, type ZohoSyncMode } from '@/lib/zoho-sync-actions';

const MODE_LABELS: Record<ZohoSyncMode, string> = {
  pull: 'Pull from Zoho',
  push: 'Push vouchers',
  both: 'Sync both',
};

const MODE_DESCRIPTIONS: Record<ZohoSyncMode, string> = {
  pull: 'Pulling finance entries from Zoho Books.',
  push: 'Pushing approved vouchers to Zoho Books.',
  both: 'Pushing vouchers, then pulling from Zoho Books.',
};

export function SyncNowButtons() {
  const [pendingMode, setPendingMode] = useState<ZohoSyncMode | null>(null);
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();
  const router = useRouter();

  function trigger(mode: ZohoSyncMode) {
    setPendingMode(mode);
    startTransition(async () => {
      const result = await triggerZohoSync(mode);
      setPendingMode(null);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not trigger sync',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Sync triggered',
        description: `${MODE_DESCRIPTIONS[mode]} Runs in the background — refresh in a minute for results.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(['pull', 'push', 'both'] as const).map((mode) => (
        <Button
          key={mode}
          size="sm"
          variant={mode === 'both' ? 'default' : 'ghost'}
          disabled={isPending}
          onClick={() => trigger(mode)}
        >
          {pendingMode === mode ? 'Triggering…' : MODE_LABELS[mode]}
        </Button>
      ))}
    </div>
  );
}
