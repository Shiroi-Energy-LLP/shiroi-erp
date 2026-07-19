'use client';

import { useState, useTransition } from 'react';
import { Button, Input, Label, DialogFooter } from '@repo/ui';
import { Plus, Loader2 } from 'lucide-react';
import { recordCustomerPayment } from '@/lib/finance-actions';

type ProjectOption = { id: string; project_number: string; customer_name: string };
type PaymentMethod = 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'dd';

interface PaymentFormProps {
  /**
   * REQUIRED (no default): true = the /payments flow, which emits the n8n
   * `customer_payment.received` event (salesperson commission + customer ping);
   * false = the project-detail per-invoice flow, which must NOT emit it. Making
   * this required prevents the merge from re-introducing the historical
   * notify-divergence bug (master-ref §4.19).
   */
  notify: boolean;
  /** Picker mode — selectable projects (the /payments "Record Payment" flow). */
  projects?: ProjectOption[];
  /** Fixed mode — pre-scoped project (project-detail flow). */
  projectId?: string;
  /** Per-invoice settlement (project-detail flow). */
  invoiceId?: string;
  /** Shows an "Against: {invoiceNumber}" header. */
  invoiceNumber?: string;
  /** Pre-fill the amount (rounded) — the outstanding on the invoice. */
  defaultAmount?: number;
  /** Show the "advance payment" checkbox (the standalone /payments flow). */
  showAdvance?: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Shared customer-payment entry form behind RecordPaymentDialog (project picker,
 * advance flag, notify=true) and RecordProjectPaymentDialog (fixed project +
 * invoice, amount pre-filled, notify=false). Both duplicated the same field set;
 * this is the single source. Calls the canonical recordCustomerPayment with the
 * explicit notify flag (2026-06-18 redundancy sweep §5).
 */
export function PaymentForm({
  notify,
  projects,
  projectId: fixedProjectId,
  invoiceId,
  invoiceNumber,
  defaultAmount,
  showAdvance = false,
  onSuccess,
  onCancel,
  submitLabel = 'Record Payment',
}: PaymentFormProps) {
  const [isPending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState(fixedProjectId ?? '');
  const [amount, setAmount] = useState(
    defaultAmount && defaultAmount > 0 ? String(Math.round(defaultAmount)) : '',
  );
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [isAdvance, setIsAdvance] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const pid = fixedProjectId ?? projectId;
    const amt = parseFloat(amount);
    if (!pid) { setError('Select a project'); return; }
    if (!amt || amt <= 0) { setError('Amount must be greater than 0'); return; }
    setError('');

    startTransition(async () => {
      const result = await recordCustomerPayment(
        {
          projectId: pid,
          invoiceId: invoiceId || undefined,
          amount: amt,
          paymentDate,
          paymentMethod,
          paymentReference: paymentReference || undefined,
          bankName: bankName || undefined,
          isAdvance: showAdvance ? isAdvance : undefined,
          notes: notes || undefined,
        },
        { notify },
      );
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? 'Failed to record payment');
      }
    });
  };

  return (
    <>
      <div className="space-y-4 py-2">
        {invoiceNumber && (
          <p className="text-sm text-n-500">
            Against: <span className="font-mono text-n-900">{invoiceNumber}</span>
          </p>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

        {projects && (
          <div>
            <Label>Project</Label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-shiroi-gold"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </select>
          </div>
        )}

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
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-shiroi-gold"
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

        {showAdvance && (
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
        )}

        <div>
          <Label>Notes (optional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-shiroi-gold"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
