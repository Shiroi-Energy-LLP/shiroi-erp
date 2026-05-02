'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  useToast,
} from '@repo/ui';
import { deferInvoice, deferPayment } from '@/lib/orphan-triage-actions';

interface Props {
  open: boolean;
  onClose: () => void;
  entity:
    | { kind: 'invoice'; id: string; number: string }
    | { kind: 'payment'; id: string; ref: string };
  onSuccess: () => void;
}

export function DeferModal({ open, onClose, entity, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();

  const handleConfirm = () => {
    startTransition(async () => {
      const result =
        entity.kind === 'invoice'
          ? await deferInvoice(entity.id, notes || null)
          : await deferPayment(entity.id, notes || null);
      if (!result.success) {
        addToast({ title: 'Defer failed', description: result.error, variant: 'destructive' });
        return;
      }
      addToast({ title: 'Deferred', description: 'Moved to the Deferred tab.', variant: 'success' });
      setNotes('');
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Defer for later</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Move <strong>{entity.kind === 'invoice' ? entity.number : entity.ref}</strong> to the
          Deferred tab? It won&apos;t affect cash until you come back to it.
        </p>
        <div className="space-y-2">
          <Label htmlFor="defer-notes">Note (optional)</Label>
          <Input
            id="defer-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What to research"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Deferring…' : 'Confirm defer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
