'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
  Button, Input, useToast,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { renameLead } from '@/lib/leads-actions';

interface LeadNameEditDialogProps {
  leadId: string;
  currentName: string;
}

/**
 * Pencil button + dialog for correcting a mis-typed lead name on the lead
 * detail page header. Mirrors ReferrerChangeDialog: calls the renameLead
 * server action (which revalidates the page) and refreshes on success.
 */
export function LeadNameEditDialog({ leadId, currentName }: LeadNameEditDialogProps) {
  const { addToast } = useToast();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(currentName);
  const [saving, setSaving] = React.useState(false);

  // Reset the field to the current name each time the dialog opens.
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) setName(currentName);
    setOpen(isOpen);
  }

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentName && !saving;

  async function handleSave() {
    const op = '[LeadNameEditDialog.handleSave]';
    if (!canSave) return;
    setSaving(true);
    try {
      const result = await renameLead(leadId, trimmed);
      if (!result.success) {
        console.error(`${op} failed`, { error: result.error, leadId });
        addToast({ variant: 'destructive', title: 'Failed to rename lead', description: result.error });
      } else {
        addToast({ variant: 'success', title: 'Lead name updated' });
        setOpen(false);
        router.refresh();
      }
    } catch (e) {
      console.error(`${op} threw`, { error: e instanceof Error ? e.message : String(e), leadId });
      addToast({ variant: 'destructive', title: 'Unexpected error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-n-400 hover:text-n-700 transition-colors"
          aria-label="Edit lead name"
          title="Edit name"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit lead name</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
            maxLength={150}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                e.preventDefault();
                void handleSave();
              }
            }}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
