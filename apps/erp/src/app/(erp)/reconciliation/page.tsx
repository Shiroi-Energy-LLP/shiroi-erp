import { requireRole } from '@/lib/auth';
import { getReconciliationData } from '@/lib/reconciliation-queries';
import { ReconciliationClient } from '@/components/reconciliation/reconciliation-client';
import { KpiCard } from '@repo/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Reconciliation · Shiroi ERP' };

export default async function ReconciliationPage() {
  await requireRole(['founder', 'project_manager']);
  const { rows, summary } = await getReconciliationData();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Reconciliation</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Match Manivel&apos;s tracking sheet (the trusted record for 2022→now) against ERP projects,
          confirm or fix each match, set the year (older unmatched jobs default to ≤2021), and choose whether to
          trust the ERP-computed number or the sheet&apos;s figure where they diverge. Changes are saved to the
          reconciliation table only — your projects are not modified here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Projects" value={summary.total} icon="HardHat" />
        <KpiCard label="Needs review" value={summary.needsReview} icon="AlertTriangle" subNote="likely + ambiguous" />
        <KpiCard label="Confirmed" value={summary.confirmed} icon="CheckCircle" />
        <KpiCard label="ERP-only (≤2021)" value={summary.byMethod['erp_only'] ?? 0} icon="Clock" />
        <KpiCard label="Year mismatches" value={summary.yearFlags} icon="Calendar" subNote="sheet vs ERP" />
        <KpiCard label="Value mismatches" value={summary.valueFlags} icon="IndianRupee" subNote=">10% gap" />
      </div>

      <ReconciliationClient rows={rows} summary={summary} />
    </div>
  );
}
