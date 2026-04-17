'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitQuoteFromVendor } from '@/lib/vendor-portal-actions';
import type { PublicRfqShape } from '@/lib/vendor-portal-queries';

type LineState = {
  rfqItemId: string;
  unitPrice: string; // string so empty input doesn't become 0
  gstRate: string;
};

type PaymentTerms = 'advance' | '30_days' | '60_days' | 'against_delivery';

const PAYMENT_TERMS_OPTIONS: Array<{ value: PaymentTerms; label: string }> = [
  { value: 'advance', label: 'Advance' },
  { value: '30_days', label: '30 days credit' },
  { value: '60_days', label: '60 days credit' },
  { value: 'against_delivery', label: 'Against delivery' },
];

export function QuoteSubmitForm({
  token,
  rfq,
}: {
  token: string;
  rfq: PublicRfqShape;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>(() =>
    rfq.items.map((item) => ({
      rfqItemId: item.id,
      unitPrice: '',
      gstRate: '18',
    })),
  );
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>('30_days');
  const [deliveryPeriodDays, setDeliveryPeriodDays] = useState('7');
  const [notes, setNotes] = useState('');

  function updateLine(idx: number, patch: Partial<LineState>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  const canSubmit =
    !isPending &&
    lines.every((l) => {
      const n = Number(l.unitPrice);
      return Number.isFinite(n) && n > 0;
    });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const lineItems = lines.map((l) => ({
      rfqItemId: l.rfqItemId,
      unitPrice: Number(l.unitPrice),
      gstRate: Number(l.gstRate),
    }));

    if (lineItems.some((l) => !Number.isFinite(l.unitPrice) || l.unitPrice <= 0)) {
      setError('All unit prices must be greater than 0');
      return;
    }
    if (
      lineItems.some(
        (l) => !Number.isFinite(l.gstRate) || l.gstRate < 0 || l.gstRate > 28,
      )
    ) {
      setError('GST rate must be between 0 and 28');
      return;
    }
    const days = Number(deliveryPeriodDays);
    if (!Number.isFinite(days) || days < 0) {
      setError('Delivery period must be 0 or more days');
      return;
    }

    startTransition(async () => {
      const res = await submitQuoteFromVendor({
        token,
        lineItems,
        paymentTerms,
        deliveryPeriodDays: days,
        notes: notes.trim() || undefined,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push(`/vendor-portal/rfq/${token}/thank-you`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Item</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3 text-right">Qty</th>
              <th className="py-2 pr-3">Unit</th>
              <th className="py-2 pr-3 text-right">Unit Price (₹)</th>
              <th className="py-2 pr-3 text-right">GST %</th>
              <th className="py-2 pr-3 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((item, idx) => {
              const line = lines[idx];
              if (!line) return null;
              const unitPriceNum = Number(line.unitPrice);
              const qty = Number(item.quantity);
              const lineTotal =
                Number.isFinite(unitPriceNum) && unitPriceNum > 0
                  ? unitPriceNum * qty
                  : 0;
              return (
                <tr key={item.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3 text-slate-500">{idx + 1}</td>
                  <td className="py-2 pr-3">{item.item_description}</td>
                  <td className="py-2 pr-3 text-xs text-slate-500">
                    {item.item_category}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {item.quantity}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">
                    {item.unit}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(idx, { unitPrice: e.target.value })
                      }
                      placeholder="0.00"
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      required
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="28"
                      step="0.1"
                      value={line.gstRate}
                      onChange={(e) =>
                        updateLine(idx, { gstRate: e.target.value })
                      }
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums text-slate-700">
                    {lineTotal > 0 ? formatINR(lineTotal) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Commercial terms */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            Payment Terms
          </label>
          <select
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value as PaymentTerms)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {PAYMENT_TERMS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            Delivery Period (days)
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={deliveryPeriodDays}
            onChange={(e) => setDeliveryPeriodDays(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional terms, substitutions, or clarifications…"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isPending ? 'Submitting…' : 'Submit quote'}
        </button>
      </div>
    </form>
  );
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
