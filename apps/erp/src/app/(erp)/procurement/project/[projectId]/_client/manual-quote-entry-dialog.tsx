'use client';

/**
 * Manual Quote Entry Dialog.
 *
 * Opened from `/procurement/rfq/[id]` (Phase 4 detail page) when the Purchase
 * Engineer enters a vendor's quote on their behalf (vendor sent it over
 * WhatsApp / in person and doesn't want to use the portal).
 *
 * Per-item rate entry + payment terms + delivery period. Submits via
 * `submitQuoteManually` server action.
 *
 * Currently reached only from a button on the (not-yet-built) RFQ detail page.
 * Self-contained so Phase 4 wiring is a single import.
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { submitQuoteManually } from '@/lib/rfq-actions';

export interface ManualQuoteRfqItem {
  rfqItemId: string;
  description: string;
  quantity: number;
  unit: string;
}

interface ManualQuoteEntryDialogProps {
  invitationId: string;
  vendorName: string;
  items: ManualQuoteRfqItem[];
  onClose: () => void;
  onSubmitted: () => void;
}

interface LineState {
  unitPrice: string; // held as string so we can blank the input
  gstRate: string;
}

export function ManualQuoteEntryDialog({
  invitationId,
  vendorName,
  items,
  onClose,
  onSubmitted,
}: ManualQuoteEntryDialogProps) {
  const [lines, setLines] = React.useState<Record<string, LineState>>(() => {
    const init: Record<string, LineState> = {};
    for (const it of items) init[it.rfqItemId] = { unitPrice: '', gstRate: '18' };
    return init;
  });
  const [paymentTerms, setPaymentTerms] = React.useState('100% advance');
  const [deliveryPeriodDays, setDeliveryPeriodDays] = React.useState('14');
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function updateLine(rfqItemId: string, field: keyof LineState, value: string) {
    setLines((prev) => ({
      ...prev,
      [rfqItemId]: { ...(prev[rfqItemId] ?? { unitPrice: '', gstRate: '18' }), [field]: value },
    }));
  }

  const totalBase = items.reduce((sum, it) => {
    const line = lines[it.rfqItemId];
    const price = line ? Number(line.unitPrice) || 0 : 0;
    return sum + price * it.quantity;
  }, 0);

  async function handleSubmit() {
    setError(null);

    // Validation — every item needs a positive unit price.
    const lineItems: {
      rfqItemId: string;
      unitPrice: number;
      gstRate: number;
      paymentTerms: string;
      deliveryPeriodDays: number;
      notes?: string;
    }[] = [];
    for (const it of items) {
      const line = lines[it.rfqItemId];
      const price = line ? Number(line.unitPrice) : NaN;
      const gst = line ? Number(line.gstRate) : NaN;
      if (!Number.isFinite(price) || price <= 0) {
        setError(`Enter a valid unit price for: ${it.description}`);
        return;
      }
      if (!Number.isFinite(gst) || gst < 0) {
        setError(`Enter a valid GST rate for: ${it.description}`);
        return;
      }
      lineItems.push({
        rfqItemId: it.rfqItemId,
        unitPrice: price,
        gstRate: gst,
        paymentTerms,
        deliveryPeriodDays: Number(deliveryPeriodDays) || 0,
      });
    }
    const delDays = Number(deliveryPeriodDays);
    if (!Number.isFinite(delDays) || delDays <= 0) {
      setError('Delivery period must be a positive number of days');
      return;
    }

    setSubmitting(true);
    const res = await submitQuoteManually({
      invitationId,
      lineItems,
      paymentTerms,
      deliveryPeriodDays: delDays,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!res.success) {
      setError(res.error);
      return;
    }
    onSubmitted();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Enter quote for {vendorName}
          </DialogTitle>
          <DialogDescription className="text-xs text-n-500">
            Record a quote the vendor sent you outside the portal. GST defaults to 18%.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-n-200 rounded max-h-[50vh] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-n-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left text-[10px] font-semibold text-n-500 uppercase">Item</th>
                <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">Qty</th>
                <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">Unit Price</th>
                <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">GST %</th>
                <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const line = lines[it.rfqItemId] ?? { unitPrice: '', gstRate: '18' };
                const price = Number(line.unitPrice) || 0;
                const amt = price * it.quantity;
                return (
                  <tr key={it.rfqItemId} className="border-t border-n-100">
                    <td className="px-2 py-1.5">{it.description}</td>
                    <td className="px-2 py-1.5 text-right text-n-600">
                      {it.quantity} {it.unit}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(it.rfqItemId, 'unitPrice', e.target.value)}
                        className="w-24 h-6 text-[11px] border border-n-200 rounded px-1.5 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.gstRate}
                        onChange={(e) => updateLine(it.rfqItemId, 'gstRate', e.target.value)}
                        className="w-16 h-6 text-[11px] border border-n-200 rounded px-1.5 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {amt > 0 ? formatINR(amt) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-n-50 border-t border-n-200">
                <td colSpan={4} className="px-2 py-1.5 text-right font-medium">Subtotal (excl. GST)</td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                  {formatINR(totalBase)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
              Payment terms
            </label>
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="100% advance / 50-50 / Net 30"
              className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
              Delivery period (days)
            </label>
            <input
              type="number"
              min="1"
              value={deliveryPeriodDays}
              onChange={(e) => setDeliveryPeriodDays(e.target.value)}
              className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
            Notes (optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
            placeholder="Validity, transport terms, etc."
          />
        </div>

        {error && <p className="text-[11px] text-red-600">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
            className="h-8 text-[11px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            className="h-8 text-[11px]"
          >
            {submitting ? 'Saving…' : 'Save quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
