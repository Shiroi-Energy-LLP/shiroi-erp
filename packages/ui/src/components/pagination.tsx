import * as React from 'react';
import { cn } from '../lib/utils';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  pageSize: number;
  basePath: string;
  searchParams?: Record<string, string>;
  entityName?: string;
}

function buildHref(basePath: string, searchParams: Record<string, string>, page: number): string {
  const params = new URLSearchParams(searchParams);
  if (page > 1) {
    params.set('page', String(page));
  } else {
    params.delete('page');
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({
  currentPage,
  totalPages,
  totalRecords,
  pageSize,
  basePath,
  searchParams = {},
  entityName = 'records',
}: PaginationProps) {
  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between border-t border-[#EBEDF2] px-4 py-3">
        <span className="text-[13px] text-[#7C818E]">
          {totalRecords} {entityName}
        </span>
      </div>
    );
  }

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalRecords);

  const windowSize = 5;
  let startPage = Math.max(1, currentPage - Math.floor(windowSize / 2));
  const endPage = Math.min(totalPages, startPage + windowSize - 1);
  if (endPage - startPage + 1 < windowSize) {
    startPage = Math.max(1, endPage - windowSize + 1);
  }

  const pages: number[] = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  const cleanParams = { ...searchParams };
  delete cleanParams.page;

  return (
    <div className="flex items-center justify-between border-t border-[#EBEDF2] px-4 py-3">
      <span className="text-[13px] text-[#7C818E]">
        Showing {from}–{to} of {totalRecords} {entityName}
      </span>

      <div className="flex items-center gap-1">
        <PaginationLink
          href={buildHref(basePath, cleanParams, 1)}
          disabled={currentPage === 1}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </PaginationLink>

        <PaginationLink
          href={buildHref(basePath, cleanParams, currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </PaginationLink>

        {pages.map((page) => (
          <PaginationLink
            key={page}
            href={buildHref(basePath, cleanParams, page)}
            active={page === currentPage}
          >
            {page}
          </PaginationLink>
        ))}

        <PaginationLink
          href={buildHref(basePath, cleanParams, currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </PaginationLink>

        <PaginationLink
          href={buildHref(basePath, cleanParams, totalPages)}
          disabled={currentPage === totalPages}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </PaginationLink>
      </div>
    </div>
  );
}

interface PaginationLinkProps {
  href: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
  'aria-label'?: string;
}

function PaginationLink({ href, disabled, active, children, ...props }: PaginationLinkProps) {
  if (disabled) {
    return (
      <span
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] text-[#BFC3CC] cursor-not-allowed"
        {...props}
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] font-medium transition-colors duration-150',
        active
          ? 'bg-[#00B050] text-white'
          : 'text-[#3F424D] hover:bg-[#F8F9FB]'
      )}
      {...props}
    >
      {children}
    </a>
  );
}
