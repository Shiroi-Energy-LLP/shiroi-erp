'use client';

/**
 * BomPicker — price-book-gated BOM editor for the Quote tab and /design/[leadId]
 *  workspace.
 *
 * Single responsibility: let the user add / remove / update quantity on
 * proposal_bom_lines. Every new line hard-requires a price_book_id — the
 * user picks from a searchable list backed by the live price_book table.
 * Legacy free-text lines (without price_book_id) render with a warning chip
 * but can still be viewed, quantity-edited, or deleted.
 *
 * All mutations go through quote-actions.ts server actions which enforce
 * RLS + business invariants. This component is purely UI + state.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import {
  addBomLineFromPriceBook,
  removeBomLine,
  updateBomLineQuantity,
} from '@/lib/quote-actions';

export interface BomLineRow {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  unit: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  price_book_id: string | null;
}

export interface PriceBookOption {
  id: string;
  item_category: string;
  item_description: string;
  brand: string | null;
  unit: string;
  base_price: number;
}

interface BomPickerProps {
  proposalId: string;
  bomLines: BomLineRow[];
  priceBookOptions: PriceBookOption[];
  /** When true, the picker is disabled (e.g. proposal already sent). */
  readOnly?: boolean;
}

function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function BomPicker({
  proposalId,
  bomLines,
  priceBookOptions,
  readOnly = false,
}: BomPickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedPriceBookId, setSelectedPriceBookId] = React.useState<string | null>(null);
  const [quantity, setQuantity] = React.useState<number>(1);
  const [error, setError] = React.useState<string | null>(null);

  // Filter price book options by search query
  const filteredOptions = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return priceBookOptions.slice(0, 50);
    return priceBookOptions
      .filter((p) => {
        const haystack = [
          p.item_description,
          p.brand ?? '',
          p.item_category,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 50);
  }, [priceBookOptions, searchQuery]);

  async function handleAdd() {
    if (!selectedPriceBookId || quantity <= 0) {
      setError('Select an item and enter a positive quantity.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addBomLineFromPriceBook(proposalId, selectedPriceBookId, quantity);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSelectedPriceBookId(null);
      setQuantity(1);
      setSearchQuery('');
      setPickerOpen(false);
      router.refresh();
    });
  }

  async function handleRemove(lineId: string) {
    if (!confirm('Remove this line from the BOM?')) return;
    startTransition(async () => {
      const result = await removeBomLine(lineId);
      if (!result.success) {
        alert(`Remove failed: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  async function handleQtyChange(lineId: string, newQty: number) {
    if (newQty <= 0) return;
    startTransition(async () => {
      const result = await updateBomLineQuantity(lineId, newQty);
      if (!result.success) {
        alert(`Quantity update failed: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  const totalPrice = bomLines.reduce((sum, l) => sum + Number(l.total_price), 0);
  const unmatchedCount = bomLines.filter((l) => !l.price_book_id).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">
          BOM
          <span className="ml-2 text-xs text-n-500 font-normal">
            {bomLines.length} line{bomLines.length !== 1 ? 's' : ''}
            {unmatchedCount > 0 && (
              <span className="ml-2 text-amber-700">
                • {unmatchedCount} need{unmatchedCount === 1 ? 's' : ''} price book entry
              </span>
            )}
          </span>
        </CardTitle>
        {!readOnly && (
          <Button size="sm" onClick={() => setPickerOpen((v) => !v)}>
            <Plus className="w-4 h-4 mr-1" />
            {pickerOpen ? 'Cancel' : 'Add Line'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price book picker (collapsible) */}
        {pickerOpen && !readOnly && (
          <div className="rounded-lg border border-dashed border-n-300 bg-n-50/40 p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-n-400" />
              <Input
                type="text"
                placeholder="Search price book by description, brand, or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto border rounded">
              {filteredOptions.length === 0 ? (
                <div className="p-6 text-center text-xs text-n-500">
                  No price book items match your search. Add new items via the Price Book page
                  before composing the BOM.
                </div>
              ) : (
                <ul className="divide-y divide-n-200">
                  {filteredOptions.map((p) => (
                    <li
                      key={p.id}
                      onClick={() => setSelectedPriceBookId(p.id)}
                      className={`cursor-pointer px-3 py-2 text-xs hover:bg-n-100 ${
                        selectedPriceBookId === p.id ? 'bg-shiroi-green/10 ring-1 ring-shiroi-green/30' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{p.item_description}</div>
                          <div className="text-n-500 mt-0.5">
                            <Badge variant="neutral" className="text-[10px] mr-1">
                              {p.item_category}
                            </Badge>
                            {p.brand && <span className="mr-2">{p.brand}</span>}
                            <span>per {p.unit}</span>
                          </div>
                        </div>
                        <div className="font-mono text-right tabular-nums">
                          {formatINR(p.base_price)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-n-600 font-medium">Qty:</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                className="w-24 h-8 text-sm"
              />
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!selectedPriceBookId || isPending}
              >
                {isPending ? 'Adding...' : 'Add to BOM'}
              </Button>
              {error && <span className="text-xs text-red-600">{error}</span>}
            </div>
          </div>
        )}

        {/* BOM line table */}
        {bomLines.length === 0 ? (
          <div className="text-center py-8 text-sm text-n-500">
            No BOM lines yet. {readOnly ? '' : 'Click "Add Line" to pick items from the Price Book.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-200 text-xs text-n-500 uppercase">
                  <th className="text-left py-2 pr-3">Item</th>
                  <th className="text-left py-2 px-2">Category</th>
                  <th className="text-right py-2 px-2">Qty</th>
                  <th className="text-right py-2 px-2">Unit Price</th>
                  <th className="text-right py-2 px-2">Total</th>
                  {!readOnly && <th className="text-right py-2 pl-2 w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {bomLines.map((line) => (
                  <tr key={line.id} className="border-b border-n-100">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{line.item_description}</div>
                      <div className="text-xs text-n-500 flex items-center gap-2 mt-0.5">
                        {line.brand && <span>{line.brand}</span>}
                        {!line.price_book_id && (
                          <Badge variant="warning" className="text-[10px]">
                            <AlertTriangle className="w-3 h-3 mr-0.5 inline" />
                            Not in Price Book
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-xs text-n-500">{line.item_category}</td>
                    <td className="py-2 px-2 text-right">
                      {readOnly ? (
                        <span className="tabular-nums">{line.quantity}</span>
                      ) : (
                        <Input
                          type="number"
                          defaultValue={line.quantity}
                          step="0.01"
                          min="0.01"
                          onBlur={(e) => {
                            const newQty = parseFloat(e.target.value);
                            if (newQty > 0 && newQty !== line.quantity) {
                              handleQtyChange(line.id, newQty);
                            }
                          }}
                          className="w-20 h-8 text-right text-xs tabular-nums"
                        />
                      )}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs">
                      {formatINR(Number(line.unit_price))}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-medium text-xs">
                      {formatINR(Number(line.total_price))}
                    </td>
                    {!readOnly && (
                      <td className="py-2 pl-2 text-right">
                        <button
                          onClick={() => handleRemove(line.id)}
                          className="text-n-400 hover:text-red-600 transition-colors"
                          disabled={isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-n-200 font-semibold">
                  <td colSpan={4} className="py-2 text-right text-xs text-n-600 uppercase">
                    Total
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatINR(totalPrice)}</td>
                  {!readOnly && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
