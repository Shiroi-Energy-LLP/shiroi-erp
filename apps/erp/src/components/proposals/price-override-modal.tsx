'use client';

import { useState } from 'react';
import { Button, Input, Label, Card, CardContent } from '@repo/ui';

export interface OverrideResult {
  newPrice: number;
  reason: string;
  reasonDetail: string;
}

interface PriceOverrideModalProps {
  itemDescription: string;
  currentPrice: number;
  priceBookPrice: number;
  onConfirm: (result: OverrideResult) => void;
  onCancel: () => void;
}

const OVERRIDE_REASONS = [
  { value: 'bulk_deal', label: 'Bulk deal / volume discount' },
  { value: 'vendor_specific', label: 'Vendor-specific pricing' },
  { value: 'customer_negotiation', label: 'Customer negotiation' },
  { value: 'market_rate_change', label: 'Market rate change' },
  { value: 'other', label: 'Other' },
];

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function PriceOverrideModal({
  itemDescription,
  currentPrice,
  priceBookPrice,
  onConfirm,
  onCancel,
}: PriceOverrideModalProps) {
  const [newPrice, setNewPrice] = useState(String(currentPrice));
  const [reason, setReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    const price = Number(newPrice);
    if (!price || price <= 0) {
      setError('Enter a valid price');
      return;
    }
    if (!reason) {
      setError('Select a reason for the override');
      return;
    }
    if (!reasonDetail.trim()) {
      setError('Provide details for the override');
      return;
    }
    onConfirm({ newPrice: price, reason, reasonDetail: reasonDetail.trim() });
  };

  const priceDiff = Number(newPrice) - priceBookPrice;
  const priceDiffPct = priceBookPrice > 0
    ? ((priceDiff / priceBookPrice) * 100).toFixed(1)
    : '0';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <Card className="w-full max-w-md" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <CardContent className="p-6 space-y-4">
          <h3 className="text-base font-bold text-[#1A1D24]">Override Price</h3>
          <p className="text-sm text-muted-foreground">{itemDescription}</p>

          {error && (
            <div className="rounded-md bg-[#FEF2F2] border border-[#FCA5A5] px-3 py-2 text-sm text-[#991B1B]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Price Book Rate</Label>
              <div className="text-sm font-mono font-medium mt-1">{formatINR(priceBookPrice)}</div>
            </div>
            <div>
              <Label className="text-xs">New Price *</Label>
              <Input
                type="number"
                min={0}
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {Number(newPrice) !== priceBookPrice && (
            <div className={`text-xs font-mono px-2 py-1 rounded ${priceDiff > 0 ? 'bg-[#FEF2F2] text-[#991B1B]' : 'bg-[#ECFDF5] text-[#065F46]'}`}>
              {priceDiff > 0 ? '+' : ''}{formatINR(priceDiff)} ({priceDiff > 0 ? '+' : ''}{priceDiffPct}%)
            </div>
          )}

          <div>
            <Label className="text-xs">Reason *</Label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select reason...</option>
              {OVERRIDE_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Details *</Label>
            <textarea
              className="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              placeholder="Explain why this price differs from the price book..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={handleConfirm}>Confirm Override</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
