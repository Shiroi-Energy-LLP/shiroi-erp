'use client';

import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { CONTACT_COLUMNS } from '@/components/data-table/column-config';
import { updateCellValue } from '@/lib/inline-edit-actions';

interface ContactsTableWrapperProps {
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

export function ContactsTableWrapper({
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
}: ContactsTableWrapperProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  async function handleCellEdit(rowId: string, field: string, value: string | number | null) {
    return updateCellValue({ entityType: 'contacts', rowId, field, value });
  }

  return (
    <DataTable
      entityType="contacts"
      allColumns={CONTACT_COLUMNS}
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
      linkPrefix="/contacts"
      linkField="name"
      onSelectionChange={setSelectedIds}
      selectedIds={selectedIds}
      onCellEdit={handleCellEdit}
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
