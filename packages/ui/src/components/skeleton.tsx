import * as React from 'react';
import { cn } from '../lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-n-200',
        className
      )}
      {...props}
    />
  );
}

function TableSkeleton({ rows = 5, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn('w-full', className)}>
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 bg-n-900 rounded-t-md">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 bg-n-700 rounded" style={{ width: `${100 / columns}%` }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className={cn(
            'flex gap-4 px-4 py-3 border-b border-n-150',
            rowIdx % 2 === 0 ? 'bg-white' : 'bg-n-050'
          )}
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className="h-3.5 bg-n-150 rounded"
              style={{ width: `${Math.random() * 30 + 50}%`, maxWidth: `${100 / columns}%`, flexBasis: `${100 / columns}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('bg-white rounded-lg border border-n-200 p-5 shadow-xs', className)}>
      <Skeleton className="h-2.5 w-20 mb-3 bg-n-150" />
      <Skeleton className="h-7 w-28 mb-2 bg-n-200" />
      <Skeleton className="h-3 w-16 bg-n-100" />
    </div>
  );
}

export { Skeleton, TableSkeleton, KpiCardSkeleton };
