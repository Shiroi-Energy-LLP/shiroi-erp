import { formatINR } from '@repo/ui/formatters';
import type { getExpenseKPIs } from '@/lib/expenses-queries';

type KPIs = Awaited<ReturnType<typeof getExpenseKPIs>>;

/**
 * The four role-scoped cards are static (whole visible book). The leading card
 * is filter-aware: count + SUM(amount) for exactly the rows the current
 * search/filter combination returns, so selecting a project answers "how many
 * vouchers and how much on this project" without leaving the page.
 */
export function ExpenseKPIs({
  kpis,
  filtered,
  hasFilters,
}: {
  kpis: KPIs;
  filtered: { count: number; total: number };
  hasFilters: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
      <div className="p-3 rounded border border-shiroi-gold/60 bg-shiroi-gold/5">
        <div className="text-xs text-gray-600 font-medium">
          {hasFilters ? 'Filtered results' : 'All expenses'}
        </div>
        <div className="text-lg font-semibold mt-1 font-mono">{formatINR(filtered.total)}</div>
        <div className="text-xs text-gray-500">
          {filtered.count === 1 ? '1 expense' : `${filtered.count} expenses`}
        </div>
      </div>
      <Card label="Total Vouchers" value={kpis.total_count.toString()} />
      <Card label="Submitted" value={kpis.submitted_count.toString()} />
      <Card label="Pending Action" value={formatINR(kpis.pending_action_amt)} />
      <Card label="Approved This Month" value={formatINR(kpis.approved_month_amt)} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded border bg-white">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold mt-1 font-mono">{value}</div>
    </div>
  );
}
