'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  /** Total item count */
  totalItems?: number;
  /** @deprecated Use totalItems */
  totalRecords?: number;
  pageSize: number;
  basePath: string;
  /** Filter params to preserve in URLs */
  filterParams?: Record<string, string>;
  /** @deprecated Use filterParams */
  searchParams?: Record<string, string>;
  /** Optional entity name for "Showing X of Y [entities]" */
  entityName?: string;
  className?: string;
}

function Pagination({
  currentPage,
  totalPages,
  totalItems,
  totalRecords,
  pageSize,
  basePath,
  filterParams,
  searchParams,
  entityName,
  className,
}: PaginationProps) {
  const total = totalItems ?? totalRecords ?? 0;
  const params = filterParams ?? searchParams ?? {};

  function buildHref(page: number): string {
    const urlParams = new URLSearchParams(params);
    if (page > 1) urlParams.set('page', String(page));
    const qs = urlParams.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  if (totalPages <= 1) return null;

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);

  // Generate page numbers to show (max 5)
  const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pages: number[] = [];
  for (let i = startPage; i <= Math.min(startPage + 4, totalPages); i++) {
    pages.push(i);
  }

  return (
    <div className={cn('flex items-center justify-between text-sm text-[#7C818E] py-3 px-4', className)}>
      <span>
        Showing {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}{entityName ? ` ${entityName}` : ''}
      </span>
      <div className="flex items-center gap-1">
        <a
          href={currentPage <= 1 ? undefined : buildHref(currentPage - 1)}
          className={cn(
            'inline-flex items-center justify-center h-8 px-3 rounded-md border text-sm',
            currentPage <= 1
              ? 'pointer-events-none opacity-50 border-[#DFE2E8]'
              : 'border-[#DFE2E8] hover:bg-[#F5F6F8] cursor-pointer'
          )}
        >
          Previous
        </a>
        {pages.map((p) => (
          <a
            key={p}
            href={buildHref(p)}
            className={cn(
              'inline-flex items-center justify-center h-8 w-8 rounded-md text-sm',
              p === currentPage
                ? 'bg-[#00B050] text-white font-medium'
                : 'border border-[#DFE2E8] hover:bg-[#F5F6F8]'
            )}
          >
            {p}
          </a>
        ))}
        <a
          href={currentPage >= totalPages ? undefined : buildHref(currentPage + 1)}
          className={cn(
            'inline-flex items-center justify-center h-8 px-3 rounded-md border text-sm',
            currentPage >= totalPages
              ? 'pointer-events-none opacity-50 border-[#DFE2E8]'
              : 'border-[#DFE2E8] hover:bg-[#F5F6F8] cursor-pointer'
          )}
        >
          Next
        </a>
      </div>
    </div>
  );
}

export { Pagination };
export type { PaginationProps };
