import { KpiCardSkeleton, Eyebrow } from '@repo/ui';

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">DASHBOARD</Eyebrow>
        <div className="h-8 w-48 bg-n-150 rounded animate-pulse mb-1" />
        <div className="h-4 w-64 bg-n-100 rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-n-200 shadow-xs p-5 h-64 animate-pulse" />
        <div className="bg-white rounded-lg border border-n-200 shadow-xs p-5 h-64 animate-pulse" />
      </div>
    </div>
  );
}
