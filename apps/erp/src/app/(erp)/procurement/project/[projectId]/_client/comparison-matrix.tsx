'use client';

/**
 * Comparison Matrix (Tab 3).
 *
 * Interactive quote-comparison UI for an RFQ in `comparing` status. Renders:
 *   - Pricing matrix: rows = items, cols = per-vendor (unit + total) + L1
 *   - Per-vendor summary bar (grand total + variance vs Shiroi price book)
 *   - Action bar: Auto-Award All L1 + Generate POs (enabled when fully awarded)
 *
 * Award flow:
 *   - Clicking an L1 cell awards directly (was_auto_selected = true)
 *   - Clicking a non-L1 cell opens override modal requiring a reason
 *   - All awards fire `awardRfqItem` server action
 *   - "Auto-Award All L1" fires `autoAwardL1` once
 *   - "Generate POs" fires `generatePOsFromAwards` once every item is awarded
 *
 * Colour logic:
 *   - Green bg + "L1" badge on the lowest total_price cell per item
 *   - Amber text for quotes >5% above `price_book_rate`
 *   - Green ring on cells currently awarded
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Badge,
} from '@repo/ui';
import { formatINR, shortINR } from '@repo/ui/formatters';
import { Check, Zap, FileText, AlertTriangle, Award } from 'lucide-react';
import type { ComparisonMatrix as ComparisonData } from '@/lib/rfq-queries';
import {
  awardRfqItem,
  autoAwardL1,
  generatePOsFromAwards,
} from '@/lib/rfq-actions';

interface ComparisonMatrixProps {
  comparison: ComparisonData;
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Return invitation id of the quote with the lowest total_price, or null. */
function findL1InvitationId(
  quotes: ComparisonData['items'][number]['quotes'],
): string | null {
  if (quotes.length === 0) return null;
  let winner = quotes[0]!;
  for (const q of quotes) if (q.totalPrice < winner.totalPrice) winner = q;
  return winner.invitationId;
}

/** Variance vs Shiroi price book as a signed percent, or null if no PB rate. */
function variancePct(unitPrice: number, priceBookRate: number | null): number | null {
  if (priceBookRate === null || priceBookRate <= 0) return null;
  return ((unitPrice - priceBookRate) / priceBookRate) * 100;
}

// ═══════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════

export function ComparisonMatrix({ comparison }: ComparisonMatrixProps) {
  const router = useRouter();
  const { rfqId, rfqNumber, items, awards } = comparison;

  // Unique vendors across all quotes (column set).
  const vendorColumns = React.useMemo(() => {
    const m = new Map<string, { invitationId: string; vendorId: string; vendorName: string }>();
    for (const item of items) {
      for (const q of item.quotes) {
        if (!m.has(q.invitationId)) {
          m.set(q.invitationId, { invitationId: q.invitationId, vendorId: q.vendorId, vendorName: q.vendorName });
        }
      }
    }
    return Array.from(m.values());
  }, [items]);

  // Current award map: rfq_item_id → winning_invitation_id.
  const awardByItem = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of awards) m.set(a.rfq_item_id, a.winning_invitation_id);
    return m;
  }, [awards]);

  const allItemsAwarded = items.length > 0 && items.every((i) => awardByItem.has(i.rfqItemId));

  // Per-vendor totals for the summary strip.
  const vendorSummary = React.useMemo(() => {
    return vendorColumns.map((col) => {
      let grandTotal = 0;
      let pbTotal = 0;
      let quotedItems = 0;
      for (const item of items) {
        const q = item.quotes.find((x) => x.invitationId === col.invitationId);
        if (q) {
          grandTotal += q.totalPrice;
          quotedItems += 1;
        }
        if (item.priceBookRate !== null) {
          pbTotal += item.priceBookRate * item.quantity;
        }
      }
      const variance = pbTotal > 0 ? ((grandTotal - pbTotal) / pbTotal) * 100 : null;
      return { ...col, grandTotal, quotedItems, variance };
    });
  }, [vendorColumns, items]);

  // Override modal state.
  const [overrideState, setOverrideState] = React.useState<{
    rfqItemId: string;
    winningInvitationId: string;
    vendorName: string;
    itemDescription: string;
    l1VendorName: string;
    l1Total: number;
    chosenTotal: number;
  } | null>(null);
  const [overrideReason, setOverrideReason] = React.useState('');
  const [submittingAward, setSubmittingAward] = React.useState(false);
  const [actionBarBusy, setActionBarBusy] = React.useState<'auto' | 'pos' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // ─── Actions ──────────────────────────────────────────────────────────

  async function handleCellClick(
    item: ComparisonData['items'][number],
    quote: ComparisonData['items'][number]['quotes'][number],
    isL1: boolean,
  ) {
    setError(null);
    if (isL1) {
      // Direct award — no reason needed.
      setSubmittingAward(true);
      const res = await awardRfqItem({
        rfqItemId: item.rfqItemId,
        winningInvitationId: quote.invitationId,
      });
      setSubmittingAward(false);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
      return;
    }
    // Open override modal.
    const l1Id = findL1InvitationId(item.quotes);
    const l1 = item.quotes.find((q) => q.invitationId === l1Id);
    setOverrideReason('');
    setOverrideState({
      rfqItemId: item.rfqItemId,
      winningInvitationId: quote.invitationId,
      vendorName: quote.vendorName,
      itemDescription: item.description,
      l1VendorName: l1?.vendorName ?? '—',
      l1Total: l1?.totalPrice ?? 0,
      chosenTotal: quote.totalPrice,
    });
  }

  async function handleOverrideSubmit() {
    if (!overrideState) return;
    if (!overrideReason.trim()) {
      setError('Override reason is required');
      return;
    }
    setSubmittingAward(true);
    const res = await awardRfqItem({
      rfqItemId: overrideState.rfqItemId,
      winningInvitationId: overrideState.winningInvitationId,
      overrideReason: overrideReason.trim(),
    });
    setSubmittingAward(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setOverrideState(null);
    setOverrideReason('');
    router.refresh();
  }

  async function handleAutoAwardAll() {
    setError(null);
    setActionBarBusy('auto');
    const res = await autoAwardL1(rfqId);
    setActionBarBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function handleGeneratePOs() {
    setError(null);
    setActionBarBusy('pos');
    const res = await generatePOsFromAwards(rfqId);
    setActionBarBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-n-800">
            Comparison — {rfqNumber}
          </h3>
          <p className="text-[11px] text-n-500">
            {items.length} item{items.length === 1 ? '' : 's'} · {vendorColumns.length} vendor{vendorColumns.length === 1 ? '' : 's'} · {awardByItem.size}/{items.length} awarded
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[11px] gap-1"
            disabled={actionBarBusy !== null || submittingAward}
            onClick={handleAutoAwardAll}
          >
            <Zap className="h-3 w-3" />
            {actionBarBusy === 'auto' ? 'Auto-awarding…' : 'Auto-Award All L1'}
          </Button>
          <Button
            size="sm"
            className="h-8 text-[11px] gap-1"
            disabled={actionBarBusy !== null || submittingAward || !allItemsAwarded}
            onClick={handleGeneratePOs}
            title={allItemsAwarded ? 'Generate POs from the current awards' : 'Award every item first'}
          >
            <FileText className="h-3 w-3" />
            {actionBarBusy === 'pos' ? 'Generating…' : 'Generate POs'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5" />
          <p className="text-[11px] text-red-700">{error}</p>
        </div>
      )}

      {/* Per-vendor summary strip */}
      {vendorSummary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {vendorSummary.map((v) => (
            <div key={v.invitationId} className="border border-n-200 rounded px-3 py-2">
              <div className="text-[11px] font-medium text-n-800 truncate" title={v.vendorName}>
                {v.vendorName}
              </div>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className="text-[10px] text-n-500">
                  {v.quotedItems}/{items.length} items quoted
                </span>
                <span className="text-xs font-semibold tabular-nums text-n-800">
                  {shortINR(v.grandTotal)}
                </span>
              </div>
              {v.variance !== null && (
                <div className="text-[10px] mt-0.5">
                  <span
                    className={
                      v.variance > 5
                        ? 'text-amber-700 font-medium'
                        : v.variance < -5
                          ? 'text-green-700 font-medium'
                          : 'text-n-500'
                    }
                  >
                    {v.variance > 0 ? '+' : ''}
                    {v.variance.toFixed(1)}% vs price book
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pricing matrix */}
      <div className="border border-n-200 rounded overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-n-50">
            <tr>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-n-500 uppercase sticky left-0 bg-n-50 z-10 min-w-[180px]">
                Item
              </th>
              <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">
                Qty
              </th>
              <th className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase">
                PB Rate
              </th>
              {vendorColumns.map((col) => (
                <th
                  key={col.invitationId}
                  className="px-2 py-2 text-right text-[10px] font-semibold text-n-500 uppercase min-w-[110px]"
                  title={col.vendorName}
                >
                  <div className="truncate max-w-[110px]">{col.vendorName}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const l1Id = findL1InvitationId(item.quotes);
              const awardedId = awardByItem.get(item.rfqItemId) ?? null;
              return (
                <tr key={item.rfqItemId} className="border-t border-n-100">
                  <td className="px-2 py-2 align-top sticky left-0 bg-white z-10">
                    <div className="text-n-800 font-medium truncate max-w-[180px]" title={item.description}>
                      {item.description}
                    </div>
                    <div className="text-[10px] text-n-500">{item.itemCategory}</div>
                  </td>
                  <td className="px-2 py-2 text-right text-n-600 tabular-nums align-top">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-2 py-2 text-right text-n-500 tabular-nums align-top">
                    {item.priceBookRate !== null ? formatINR(item.priceBookRate) : '—'}
                  </td>
                  {vendorColumns.map((col) => {
                    const quote = item.quotes.find((q) => q.invitationId === col.invitationId);
                    if (!quote) {
                      return (
                        <td
                          key={col.invitationId}
                          className="px-2 py-2 text-right text-n-300 align-top"
                        >
                          —
                        </td>
                      );
                    }
                    const isL1 = quote.invitationId === l1Id;
                    const isAwarded = quote.invitationId === awardedId;
                    const v = variancePct(quote.unitPrice, item.priceBookRate);
                    const over5 = v !== null && v > 5;
                    return (
                      <td
                        key={col.invitationId}
                        className={[
                          'px-2 py-2 text-right align-top cursor-pointer transition-colors',
                          isL1 ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-n-50',
                          isAwarded ? 'ring-2 ring-inset ring-green-500' : '',
                        ].join(' ')}
                        onClick={() =>
                          !submittingAward && !actionBarBusy && handleCellClick(item, quote, isL1)
                        }
                        title={
                          isAwarded
                            ? 'Currently awarded — click another cell to override'
                            : isL1
                              ? 'L1 — click to award'
                              : 'Click to override-award (reason required)'
                        }
                      >
                        <div className="flex items-center justify-end gap-1">
                          {isL1 && (
                            <Badge
                              variant="secondary"
                              className="h-4 px-1 text-[9px] bg-green-100 text-green-700"
                            >
                              L1
                            </Badge>
                          )}
                          {isAwarded && <Check className="h-3 w-3 text-green-600" />}
                          <span
                            className={[
                              'tabular-nums font-medium',
                              over5 ? 'text-amber-700' : 'text-n-800',
                            ].join(' ')}
                          >
                            {formatINR(quote.unitPrice)}
                          </span>
                        </div>
                        <div className="text-[10px] text-n-500 tabular-nums">
                          Σ {shortINR(quote.totalPrice)}
                          {v !== null && (
                            <span className={over5 ? 'text-amber-600 ml-1' : 'text-n-400 ml-1'}>
                              ({v > 0 ? '+' : ''}
                              {v.toFixed(0)}%)
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-n-500">
        Green cell = lowest total per item (L1). Click any cell to award — non-L1 picks ask
        for a reason. Once every item is awarded, use <strong>Generate POs</strong> to create
        one draft PO per vendor.
      </p>

      {/* Override modal */}
      {overrideState && (
        <Dialog open onOpenChange={(o) => { if (!o) setOverrideState(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-1.5">
                <Award className="h-4 w-4 text-amber-600" />
                Override L1 — reason required
              </DialogTitle>
              <DialogDescription className="text-xs text-n-500">
                You&apos;re awarding a non-lowest quote. The reason is recorded on the
                audit log and visible to the approver.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 text-[11px]">
              <div className="rounded border border-n-200 bg-n-50 px-3 py-2">
                <div className="text-[10px] text-n-500 uppercase font-medium mb-1">Item</div>
                <div className="text-n-800">{overrideState.itemDescription}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-green-200 bg-green-50 px-3 py-2">
                  <div className="text-[10px] text-green-700 uppercase font-medium mb-1">L1 (lowest)</div>
                  <div className="text-n-800 font-medium">{overrideState.l1VendorName}</div>
                  <div className="text-n-600 tabular-nums">{formatINR(overrideState.l1Total)}</div>
                </div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="text-[10px] text-amber-700 uppercase font-medium mb-1">Your pick</div>
                  <div className="text-n-800 font-medium">{overrideState.vendorName}</div>
                  <div className="text-n-600 tabular-nums">{formatINR(overrideState.chosenTotal)}</div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                  Reason for overriding L1
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. preferred vendor, delivery timeline, past quality issues with L1…"
                  className="w-full text-[11px] border border-n-200 rounded px-2 py-1.5"
                  autoFocus
                />
              </div>
            </div>

            {error && <p className="text-[11px] text-red-600">{error}</p>}

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverrideState(null)}
                disabled={submittingAward}
                className="h-8 text-[11px]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleOverrideSubmit}
                disabled={submittingAward || !overrideReason.trim()}
                className="h-8 text-[11px]"
              >
                {submittingAward ? 'Awarding…' : 'Confirm override'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
