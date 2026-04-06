'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@repo/ui';

interface FilterBarProps {
  /** Base path for the "Clear" link (e.g. "/leads") */
  basePath: string;
  /** Param names that count as active filters */
  filterParams: string[];
  children: React.ReactNode;
}

/**
 * Wrapper that replaces <form> for auto-search filter bars.
 * Shows a "Clear" button when any filter is active.
 */
export function FilterBar({ basePath, filterParams, children }: FilterBarProps) {
  const searchParams = useSearchParams();
  const hasFilters = filterParams.some((p) => searchParams.has(p));

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {children}
      {hasFilters && (
        <Link href={basePath}>
          <Button type="button" variant="ghost" size="sm" className="h-9">
            Clear
          </Button>
        </Link>
      )}
    </div>
  );
}
