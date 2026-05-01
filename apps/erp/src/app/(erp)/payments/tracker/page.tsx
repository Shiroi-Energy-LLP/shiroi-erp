import { PaymentsNav } from '@/components/payments/payments-nav';
import { PaymentsTrackerTable } from '@/components/payments/payments-tracker-table';
import {
  getPaymentTrackerRows,
  computePaymentTrackerSummary,
  filterPaymentTrackerRows,
} from '@/lib/payments-tracker-queries';

interface Props {
  searchParams: Promise<{ filter?: string }>;
}

export default async function PaymentsTrackerPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = params.filter ?? 'outstanding';
  const allRows = await getPaymentTrackerRows();
  const filtered = filterPaymentTrackerRows(allRows, filter);
  const summary = computePaymentTrackerSummary(allRows);

  return (
    <div className="space-y-6">
      <PaymentsNav />
      <PaymentsTrackerTable
        rows={filtered}
        allRows={allRows}
        summary={summary}
        filter={filter}
      />
    </div>
  );
}
