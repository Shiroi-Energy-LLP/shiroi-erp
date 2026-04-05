'use client';

import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { PROPOSAL_COLUMNS } from '@/components/data-table/column-config';

interface ProposalsTableWrapperProps {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortColumn?: string;
  sortDirection?: string;
  currentFilters: Record<string, string>;
  views: any[];
  activeViewId: string | null;
  visibleColumns: string[];
}

export function ProposalsTableWrapper({
  data,
  total,
  page,
  pageSize,
  totalPages,
  sortColumn,
  sortDirection,
  currentFilters,
  views,
  activeViewId,
  visibleColumns,
}: ProposalsTableWrapperProps) {
  return (
    <DataTable
      entityType="proposals"
      allColumns={PROPOSAL_COLUMNS}
      visibleColumns={visibleColumns}
      data={data}
      total={total}
      page={page}
      pageSize={pageSize}
      totalPages={totalPages}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      currentFilters={currentFilters}
      views={views}
      activeViewId={activeViewId}
      linkPrefix="/proposals"
      linkField="proposal_number"
    />
  );
}
