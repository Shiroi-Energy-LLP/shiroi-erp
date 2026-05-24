import { PaymentsNav } from '@/components/payments/payments-nav';
import { PaymentsTrackerTable } from '@/components/payments/payments-tracker-table';
import {
  getPaymentTrackerRows,
  getPaymentScheduleFollowUps,
  computePaymentTrackerSummary,
  filterPaymentTrackerRows,
} from '@/lib/payments-tracker-queries';
import { getPaymentsExpectedThisWeek } from '@/lib/payments-this-week-queries';

interface Props {
  searchParams: Promise<{ filter?: string }>;
}

export default async function PaymentsTrackerPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = params.filter ?? 'outstanding';

  const [allRows, thisWeekRows, followUps] = await Promise.all([
    getPaymentTrackerRows(),
    getPaymentsExpectedThisWeek(),
    getPaymentScheduleFollowUps(),
  ]);

  const thisWeekProjectIds = new Set(thisWeekRows.map((r) => r.project_id));

  const filtered = filterPaymentTrackerRows(allRows, filter, thisWeekProjectIds);
  const summary = computePaymentTrackerSummary(allRows);

  // Build a lookup: project_id → array of follow-up milestone rows
  const followUpsByProject = new Map<string, typeof followUps>();
  for (const fu of followUps) {
    if (!fu.project_id) continue;
    const arr = followUpsByProject.get(fu.project_id) ?? [];
    arr.push(fu);
    followUpsByProject.set(fu.project_id, arr);
  }

  return (
    <div className="space-y-6">
      <PaymentsNav />
      <PaymentsTrackerTable
        rows={filtered}
        allRows={allRows}
        summary={summary}
        filter={filter}
        thisWeekCount={thisWeekRows.length}
        followUpsByProject={followUpsByProject}
      />
    </div>
  );
}
