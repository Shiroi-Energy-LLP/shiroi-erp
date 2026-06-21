'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui';
import { PaymentForm } from '@/components/finance/payment-form';

interface RecordProjectPaymentDialogProps {
  projectId: string;
  invoiceId: string;
  invoiceNumber: string;
  /** Outstanding amount to pre-fill — pass 0 to leave blank */
  outstandingAmount: number;
  trigger: React.ReactNode;
}

export function RecordProjectPaymentDialog({
  projectId,
  invoiceId,
  invoiceNumber,
  outstandingAmount,
  trigger,
}: RecordProjectPaymentDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <PaymentForm
            notify={false}
            projectId={projectId}
            invoiceId={invoiceId}
            invoiceNumber={invoiceNumber}
            defaultAmount={outstandingAmount}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
