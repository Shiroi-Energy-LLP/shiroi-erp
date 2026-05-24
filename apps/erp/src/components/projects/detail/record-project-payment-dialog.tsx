'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@repo/ui';
import { Loader2 } from 'lucide-react';
import { recordProjectPayment } from '@/lib/finance-actions';

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
  const [isPending, startTransition] = useTransition();

  const [amount, setAmount] = useState(
    outstandingAmount > 0 ? String(Math.round(outstandingAmount)) : '',
  );
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd'>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const handleOpen = () => {
    setAmount(outstandingAmount > 0 ? String(Math.round(outstandingAmount)) : '');
    setError('');
    setOpen(true);
  };

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Amount must be greater than 0'); return; }
    setError('');

    startTransition(async () => {
      const result = await recordProjectPayment({
        projectId,
        invoiceId,
        amount: amt,
        paymentDate,
        paymentMethod,
        paymentReference: paymentReference || undefined,
        bankName: bankName || undefined,
        notes: notes || undefined,
      });
      if (result.success) {
        setOpen(false);
        setPaymentReference('');
        setBankName('');
        setNotes('');
      } else {
        setError(result.error ?? 'Failed to record payment');
      }
    });
  };

  return (
    <>
      <span onClick={handleOpen} className="contents">
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-n-500">
              Against: <span className="font-mono text-n-900">{invoiceNumber}</span>
            </p>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount (₹)</Label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Payment Date</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payment Method</Label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#00B050]"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="dd">DD</option>
                </select>
              </div>
              <div>
                <Label>Reference #</Label>
                <Input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="UTR / Cheque #"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Bank Name (optional)</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Bank name"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#00B050]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
