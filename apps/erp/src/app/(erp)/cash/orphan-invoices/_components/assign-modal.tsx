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
import { assignOrphanInvoice, assignOrphanPayment } from '@/lib/orphan-triage-actions';
import { formatINR } from '@repo/ui/formatters';

interface Props {
  open: boolean;
  onClose: () => void;
  entity:
    | { kind: 'invoice'; id: string; total: string; number: string }
    | { kind: 'payment'; id: string; total: string; ref: string };
  project: { id: string; number: string; customer_name: string } | null;
  onSuccess: () => void;
}

export function AssignModal({ open, onClose, entity, project, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();

  const handleConfirm = () => {
    if (!project) return;
    startTransition(async () => {
      const result =
        entity.kind === 'invoice'
          ? await assignOrphanInvoice(entity.id, project.id, notes || null)
          : await assignOrphanPayment(entity.id, project.id, notes || null);
      if (!result.success) {
        addToast({ title: 'Assign failed', description: result.error, variant: 'destructive' });
        return;
      }
      addToast({
        title: 'Assigned',
        description:
          entity.kind === 'invoice'
            ? `Cascaded ${(result.data as { cascadedPaymentCount: number }).cascadedPaymentCount} linked payment(s).`
            : 'Payment assigned.',
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
          <DialogTitle>Assign to project</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Assign{' '}
          {entity.kind === 'invoice' ? (
            <strong>{entity.number}</strong>
          ) : (
            <strong>{entity.ref}</strong>
          )}{' '}
          ({formatINR(Number(entity.total))}) to{' '}
          {project ? (
            <strong>
              {project.customer_name} ({project.number})
            </strong>
          ) : (
            <em>— select a project from the right pane —</em>
          )}
          ?
        </p>
        {entity.kind === 'invoice' && (
          <p className="text-xs text-[#7C818E]">
            Linked customer payments will cascade to the same project.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="assign-notes">Notes (optional)</Label>
          <Input
            id="assign-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !project}>
            {isPending ? 'Assigning…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
