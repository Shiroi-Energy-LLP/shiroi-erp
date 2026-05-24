import { Skeleton } from '@repo/ui';

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
