import { formatINR } from '@repo/ui/formatters';
import type { getExpenseKPIs } from '@/lib/expenses-queries';

type KPIs = Awaited<ReturnType<typeof getExpenseKPIs>>;

export function ExpenseKPIs({ kpis }: { kpis: KPIs }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
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
