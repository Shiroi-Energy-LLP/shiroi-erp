'use client';

/**
 * run-win-loss-button.tsx — founder-only button to trigger win/loss analysis.
 * Client component: handles state + toast feedback.
 */

import { useState } from 'react';
import { Button } from '@repo/ui';
import { runWinLossAnalysisNow } from '@/lib/win-loss-actions';
import { useRouter } from 'next/navigation';

export function RunWinLossButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await runWinLossAnalysisNow();
      if (!result.success) {
        setMessage(`Error: ${result.error}`);
      } else if (result.data.skipped) {
        setMessage('Already analysed for this week. No new report created.');
      } else {
        setMessage(
          `Done — ${result.data.total_leads_won}W / ${result.data.total_leads_lost}L for ${result.data.period_start} to ${result.data.period_end}`,
        );
        router.refresh();
      }
    } catch (e) {
      setMessage(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={handleClick}
        disabled={loading}
        variant="outline"
        size="sm"
      >
        {loading ? 'Running…' : 'Run analysis now'}
      </Button>
      {message && (
        <p className="text-xs text-n-500 max-w-xs text-right">{message}</p>
      )}
    </div>
  );
}
