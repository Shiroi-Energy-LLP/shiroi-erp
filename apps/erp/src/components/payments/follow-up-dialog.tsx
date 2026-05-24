'use client';

import { useState, useTransition } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@repo/ui';
import { updatePaymentFollowUp } from '@/lib/payment-followup-actions';
import { useRouter } from 'next/navigation';

interface Milestone {
  id: string;
  milestone_name: string;
  amount: number;
  follow_up_count: number;
  expected_payment_date: string | null;
  follow_up_note: string | null;
}

interface FollowUpDialogProps {
  milestone: Milestone;
  projectCustomerName: string;
}

export function FollowUpDialog({ milestone, projectCustomerName }: FollowUpDialogProps) {
  const [open, setOpen] = useState(false);
  const [expectedDate, setExpectedDate] = useState(milestone.expected_payment_date ?? '');
  const [note, setNote] = useState('');
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  function handleOpen() {
    setExpectedDate(milestone.expected_payment_date ?? '');
    setNote('');
    setErrorMsg(null);
    setOpen(true);
  }

  function handleSubmit() {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updatePaymentFollowUp(milestone.id, {
        expectedPaymentDate: expectedDate || null,
        note: note.trim() || null,
      });
      if (!result.success) {
        setErrorMsg(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleOpen}
      >
        Follow Up
        {milestone.follow_up_count > 0 && (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold w-4 h-4">
            {milestone.follow_up_count}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Mark Follow-Up</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="text-sm text-n-700">
              <span className="font-medium">{projectCustomerName}</span>
              <span className="text-n-500 ml-1">— {milestone.milestone_name}</span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-n-700" htmlFor="expected-date">
                Expected Payment Date
              </label>
              <input
                id="expected-date"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full rounded-md border border-n-300 px-3 py-1.5 text-sm text-n-900 focus:outline-none focus:ring-2 focus:ring-shiroi-green"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-n-700" htmlFor="follow-up-note">
                Note <span className="text-n-400">(optional)</span>
              </label>
              <textarea
                id="follow-up-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="e.g. Customer said payment will come after Diwali..."
                className="w-full rounded-md border border-n-300 px-3 py-1.5 text-sm text-n-900 placeholder:text-n-400 focus:outline-none focus:ring-2 focus:ring-shiroi-green resize-none"
              />
            </div>

            {errorMsg && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {errorMsg}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Saving…' : 'Mark Followed Up'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
