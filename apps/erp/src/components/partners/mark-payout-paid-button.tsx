'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@repo/ui';
import { markPayoutPaid } from '@/lib/partners-actions';

/**
 * Small inline "Mark Paid" control for the /partners/[id] Pending Payouts table.
 *
 * First click: reveals a UTR/reference input. Second click on "Confirm":
 * calls markPayoutPaid() server action which flips the row to status='paid',
 * stamps paid_at + paid_by, and records the payment_reference.
 */
export function MarkPayoutPaidButton({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!expanded) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setExpanded(true)}>
        Mark Paid
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Input
        type="text"
        placeholder="UTR / Ref."
        value={reference}
        onChange={(e) => {
          setReference(e.target.value);
          setError(null);
        }}
        className="w-32 h-8 text-xs"
      />
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markPayoutPaid(payoutId, reference || undefined);
            if (!result.success) {
              setError(result.error);
              return;
            }
            setExpanded(false);
            setReference('');
            router.refresh();
          });
        }}
      >
        {isPending ? '...' : 'Confirm'}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setExpanded(false);
          setReference('');
          setError(null);
        }}
      >
        Cancel
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
