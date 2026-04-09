'use client';

import { useState, useTransition } from 'react';
import {
  Button, Input, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@repo/ui';
import { Plus, Loader2 } from 'lucide-react';
import { recordPayment } from '@/lib/finance-actions';

interface RecordPaymentDialogProps {
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function RecordPaymentDialog({ projects }: RecordPaymentDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [projectId, setProjectId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd'>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [isAdvance, setIsAdvance] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!projectId) { setError('Select a project'); return; }
    if (!amt || amt <= 0) { setError('Amount must be greater than 0'); return; }
    setError('');

    startTransition(async () => {
      const result = await recordPayment({
        projectId,
        amount: amt,
        paymentDate,
        paymentMethod,
        paymentReference: paymentReference || undefined,
        bankName: bankName || undefined,
        isAdvance,
        notes: notes || undefined,
      });
      if (result.success) {
        setOpen(false);
        resetForm();
      } else {
        setError(result.error ?? 'Failed to record payment');
      }
    });
  };

  const resetForm = () => {
    setProjectId('');
    setAmount('');
    setPaymentReference('');
    setBankName('');
    setIsAdvance(false);
    setNotes('');
    setError('');
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        Record Payment
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Customer Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

            <div>
              <Label>Project</Label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#00B050]"
              >
                <option value="">Select project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="mt-1" />
              </div>
              <div>
                <Label>Payment Date</Label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payment Method</Label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
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
                <Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="UTR / Cheque #" className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Bank Name (optional)</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" className="mt-1" />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-advance"
                checked={isAdvance}
                onChange={(e) => setIsAdvance(e.target.checked)}
                className="rounded border-gray-300"
              />
              <Label htmlFor="is-advance" className="text-sm cursor-pointer">This is an advance payment</Label>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
