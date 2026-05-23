'use client';

import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
  Button, useToast,
} from '@repo/ui';
import { ReferrerPicker } from '@/components/leads/referrer-picker';
import { setLeadReferrer } from '@/lib/lead-referrer-actions';
import type { PartnerPickerOption } from '@/lib/partners-queries';

interface ReferrerChangeDialogProps {
  leadId: string;
  currentPartnerId: string | null;
  partners: PartnerPickerOption[];
}

/**
 * "Change" button + dialog for updating the referrer on a lead detail page.
 * Calls setLeadReferrer server action and revalidates the page via Next.js.
 */
export function ReferrerChangeDialog({
  leadId,
  currentPartnerId,
  partners,
}: ReferrerChangeDialogProps) {
  const { addToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(currentPartnerId);
  const [saving, setSaving] = React.useState(false);

  // Reset selection when dialog opens
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) setSelected(currentPartnerId);
    setOpen(isOpen);
  }

  async function handleSave() {
    const op = '[ReferrerChangeDialog.handleSave]';
    setSaving(true);
    try {
      const result = await setLeadReferrer(leadId, selected);
      if (!result.success) {
        console.error(`${op} failed`, { error: result.error, leadId });
        addToast({ variant: 'destructive', title: 'Failed to update referrer', description: result.error });
      } else {
        addToast({ variant: 'success', title: 'Referrer updated' });
        setOpen(false);
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
        <button className="text-xs text-p-600 hover:underline ml-2">Change</button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Referrer</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <ReferrerPicker
            partners={partners}
            value={selected}
            onChange={setSelected}
            label="Select referrer"
            id="dialog_referrer_picker"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
