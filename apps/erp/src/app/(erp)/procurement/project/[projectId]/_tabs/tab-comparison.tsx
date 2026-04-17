/**
 * Tab 3 — Quote comparison matrix.
 *
 * Placeholder rendered by Phase 3. Full L1 auto-highlight + override + award
 * UI lands in Phase 4 via `ComparisonMatrix` client component.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { BarChart3 } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { ComparisonMatrix as ComparisonData } from '@/lib/rfq-queries';

type AppRole = Database['public']['Enums']['app_role'];

interface TabComparisonProps {
  projectId: string;
  comparison: ComparisonData | null;
  viewerRole: AppRole;
}

export function TabComparison({ comparison }: TabComparisonProps) {
  if (!comparison) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <BarChart3 className="w-10 h-10 text-n-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-n-700">No quotes to compare yet</p>
          <p className="text-xs text-n-500 mt-1">
            Send an RFQ from the RFQ tab, then return here once vendors submit quotes.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Minimal read-only preview for Phase 3. Phase 4 replaces this with the
  // interactive matrix (L1 highlight, override-award UI, "Auto-Award All L1",
  // "Generate POs" footer action bar).
  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-semibold">
          Comparison — {comparison.rfqNumber}
          <span className="text-xs font-normal text-n-500 ml-2">
            ({comparison.items.length} items)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-n-200 bg-n-50">
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-left">Item</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Qty</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">PB Rate</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">Quotes</th>
                <th className="px-3 py-2 text-[10px] font-semibold text-n-500 uppercase text-right">L1 Rate</th>
              </tr>
            </thead>
            <tbody>
              {comparison.items.map((item) => {
                const l1 =
                  item.quotes.length > 0
                    ? item.quotes.reduce((min, q) => (q.unitPrice < min.unitPrice ? q : min), item.quotes[0]!)
                    : null;
                return (
                  <tr key={item.rfqItemId} className="border-b border-n-100 hover:bg-n-50">
                    <td className="px-3 py-2">{item.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-n-500">
                      {item.priceBookRate !== null ? formatINR(item.priceBookRate) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.quotes.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-green-700">
                      {l1 ? formatINR(l1.unitPrice) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-[11px] text-n-500 border-t border-n-100 bg-amber-50">
          ⚠ Interactive award + Generate POs workflow lands in Phase 4.
        </div>
      </CardContent>
    </Card>
  );
}
