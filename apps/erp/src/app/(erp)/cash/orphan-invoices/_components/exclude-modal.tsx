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
import { excludeInvoice, excludePayment } from '@/lib/orphan-triage-actions';
import { formatINR } from '@repo/ui/formatters';

interface Props {
  open: boolean;
  onClose: () => void;
  entity:
    | { kind: 'invoice'; id: string; total: string; number: string }
    | { kind: 'payment'; id: string; total: string; ref: string };
  onSuccess: () => void;
}

export function ExcludeModal({ open, onClose, entity, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();

  const handleConfirm = () => {
    if (!notes.trim()) {
      addToast({
        title: 'Notes required',
        description: 'Explain why this is excluded from cash.',
        variant: 'destructive',
      });
      return;
    }
    startTransition(async () => {
      const result =
        entity.kind === 'invoice'
          ? await excludeInvoice(entity.id, notes)
          : await excludePayment(entity.id, notes);
      if (!result.success) {
        addToast({ title: 'Exclude failed', description: result.error, variant: 'destructive' });
        return;
      }
      addToast({
        title: 'Excluded',
        description: 'No longer affects any project cash position.',
        variant: 'success',
      });
      setNotes('');
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as no ERP match</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Mark{' '}
          <strong>{entity.kind === 'invoice' ? entity.number : entity.ref}</strong>{' '}
          ({formatINR(Number(entity.total))}) as <em>excluded from cash</em>?
        </p>
        <p className="text-xs text-[#7C818E]">
          The row stays in the DB for audit but does not move any project&apos;s cash position.
          {entity.kind === 'invoice' && ' Linked payments are excluded too.'} Undo from the
          Excluded tab.
        </p>
        <div className="space-y-2">
          <Label htmlFor="exclude-notes">Reason (required)</Label>
          <Input
            id="exclude-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Industrial deal not in ERP — written off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Excluding…' : 'Confirm exclude'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
