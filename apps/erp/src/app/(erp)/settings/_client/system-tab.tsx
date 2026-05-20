'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@repo/ui';
import { setProposalGateEnabled } from '@/lib/system-settings-actions';

interface SystemTabProps {
  currentlyEnabled: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** Formats an ISO timestamp into a human-readable relative date string. */
function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function SystemTab({ currentlyEnabled, updatedAt, updatedByName }: SystemTabProps) {
  const [enabled, setEnabled] = useState(currentlyEnabled);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();

  function handleToggleRequest(newValue: boolean) {
    if (!newValue) {
      // Flipping OFF — require confirmation first.
      setConfirmDisableOpen(true);
      return;
    }
    // Flipping back ON — no dialog needed.
    applyToggle(true);
  }

  function applyToggle(newValue: boolean) {
    startTransition(async () => {
      const result = await setProposalGateEnabled(newValue);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not update proposal gate',
          description: result.error,
        });
        return;
      }
      setEnabled(newValue);
      addToast({
        variant: 'success',
        title: newValue ? 'Proposal gate enabled' : 'Proposal gate disabled',
        description: newValue
          ? 'Won transitions now require a proposal again.'
          : 'Won transitions are allowed without a proposal until you re-enable.',
      });
    });
  }

  function onConfirmDisable() {
    setConfirmDisableOpen(false);
    applyToggle(false);
  }

  return (
    <section className="space-y-4 rounded-md border border-n-200 bg-white p-6">
      <div>
        <h2 className="text-base font-semibold text-n-900">System — Proposal gate</h2>
        <p className="mt-1 text-sm text-n-600 max-w-prose">
          When enabled, leads cannot be marked Won without at least one proposal (Quick Quote or
          detailed). Disable temporarily during historical data cleanup. Re-enable when done.
        </p>
      </div>

      {/* Current state + toggle */}
      <div className="flex items-center justify-between rounded-lg border border-n-200 bg-n-50 px-4 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-n-700">Proposal gate</span>
            {enabled ? (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                ENABLED
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                DISABLED
              </span>
            )}
          </div>
          {updatedAt && (
            <p className="text-xs text-n-500">
              Last changed: {formatRelativeDate(updatedAt)}
              {updatedByName ? `, by ${updatedByName}` : ''}
            </p>
          )}
        </div>

        {/* Toggle button */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={pending}
          onClick={() => handleToggleRequest(!enabled)}
          className={[
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-shiroi-green focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            enabled ? 'bg-shiroi-green' : 'bg-n-300',
          ].join(' ')}
        >
          <span className="sr-only">{enabled ? 'Disable proposal gate' : 'Enable proposal gate'}</span>
          <span
            aria-hidden="true"
            className={[
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0',
              'transition duration-200 ease-in-out',
              enabled ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
        </button>
      </div>

      {/* Confirm-disable dialog */}
      <Dialog open={confirmDisableOpen} onOpenChange={(open) => !open && setConfirmDisableOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable proposal gate?</DialogTitle>
            <DialogDescription>
              This allows Won transitions site-wide without a proposal until you re-enable. Use only
              during historical data cleanup, then turn it back on.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDisableOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirmDisable} disabled={pending}>
              Disable gate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
