import { TableSkeleton, Eyebrow } from '@repo/ui';

export default function ProjectsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">PROJECTS</Eyebrow>
        <div className="h-8 w-36 bg-n-150 rounded animate-pulse" />
      </div>
      <div className="bg-white rounded-lg border border-n-200 shadow-xs">
        <div className="p-4 border-b border-n-150">
          <div className="flex gap-3">
            <div className="h-9 w-36 bg-n-100 rounded-md animate-pulse" />
            <div className="h-9 w-48 bg-n-100 rounded-md animate-pulse" />
          </div>
        </div>
        <TableSkeleton rows={8} columns={7} />
      </div>
    </div>
  );
}
