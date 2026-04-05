import { KpiCardSkeleton, TableSkeleton, Eyebrow } from '@repo/ui';

export default function HRLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">HR OVERVIEW</Eyebrow>
        <div className="h-8 w-36 bg-n-150 rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
      <div className="bg-white rounded-lg border border-n-200 shadow-xs">
        <TableSkeleton rows={6} columns={5} />
      </div>
    </div>
  );
}
