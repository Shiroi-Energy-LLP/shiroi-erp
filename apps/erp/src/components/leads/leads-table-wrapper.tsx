'use client';

import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { LEAD_COLUMNS } from '@/components/data-table/column-config';
import { updateCellValue } from '@/lib/inline-edit-actions';
import { BulkActionBar } from '@/components/leads/bulk-action-bar';

interface Employee {
  id: string;
  full_name: string;
}

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
  employees: Employee[];
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
  employees,
}: LeadsTableWrapperProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  async function handleCellEdit(rowId: string, field: string, value: string | number | null) {
    return updateCellValue({ entityType: 'leads', rowId, field, value });
  }

  const selectedLeads = React.useMemo(
    () =>
      data
        .filter((row) => selectedIds.includes(row.id))
        .map((row) => ({
          id: row.id as string,
          customer_name: row.customer_name as string,
          phone: row.phone as string,
          status: row.status as string,
        })),
    [data, selectedIds],
  );

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
      onCellEdit={handleCellEdit}
      bulkActions={
        selectedIds.length > 0 ? (
          <BulkActionBar
            selectedIds={selectedIds}
            selectedLeads={selectedLeads}
            employees={employees}
            onClear={() => setSelectedIds([])}
            onActionComplete={() => setSelectedIds([])}
          />
        ) : null
      }
    />
  );
}
