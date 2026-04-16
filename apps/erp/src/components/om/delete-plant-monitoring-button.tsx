'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
  Button,
} from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { softDeletePlantMonitoringCredential } from '@/lib/plant-monitoring-actions';

interface DeletePlantMonitoringButtonProps {
  credentialId: string;
  customerName: string;
}

export function DeletePlantMonitoringButton({ credentialId, customerName }: DeletePlantMonitoringButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);

    const result = await softDeletePlantMonitoringCredential(credentialId);

    setDeleting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Delete">
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete credential?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-n-700">
          Delete monitoring credentials for <strong>{customerName}</strong>? The record will be
          soft-deleted and can be recovered by a founder from the database if needed.
        </p>
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
