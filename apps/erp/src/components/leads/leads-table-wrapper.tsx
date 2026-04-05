'use client';

import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { LEAD_COLUMNS } from '@/components/data-table/column-config';

interface LeadsTableWrapperProps {
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

export function LeadsTableWrapper({
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
}: LeadsTableWrapperProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  return (
    <DataTable
      entityType="leads"
      allColumns={LEAD_COLUMNS}
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
      linkPrefix="/leads"
      linkField="customer_name"
      onSelectionChange={setSelectedIds}
      selectedIds={selectedIds}
      bulkActions={
        selectedIds.length > 0 ? (
          <span className="text-xs text-shiroi-green font-medium ml-2">
            {selectedIds.length} selected
          </span>
        ) : null
      }
    />
  );
}
