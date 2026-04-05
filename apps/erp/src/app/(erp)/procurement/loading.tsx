import { TableSkeleton, Eyebrow } from '@repo/ui';

export default function ProcurementLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">PROCUREMENT</Eyebrow>
        <div className="h-8 w-48 bg-n-150 rounded animate-pulse" />
      </div>
      <div className="bg-white rounded-lg border border-n-200 shadow-xs">
        <TableSkeleton rows={8} columns={6} />
      </div>
    </div>
  );
}
