'use client';

/**
 * DeleteAmcButton — per-row archive control on /om/amc.
 *
 * Calls deleteAmc() which soft-closes the contract (status='cancelled') —
 * RLS restricts to founder + om_technician. The trigger button is rendered
 * conditionally on viewerRole; the server action is the source of truth.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button,
} from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { deleteAmc } from '@/lib/amc-actions';

interface DeleteAmcButtonProps {
  contractId: string;
  contractNumber: string;
}

export function DeleteAmcButton({ contractId, contractNumber }: DeleteAmcButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    const result = await deleteAmc(contractId);
    setDeleting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center h-6 w-6 rounded text-n-400 hover:text-red-600 hover:bg-red-50"
        title={`Archive ${contractNumber}`}
        aria-label="Archive AMC"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive {contractNumber}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-n-700">
            This will set the contract status to <strong>cancelled</strong>. Existing visit
            history is retained for audit.
          </p>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={deleting}
            >
              {deleting ? 'Archiving…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
