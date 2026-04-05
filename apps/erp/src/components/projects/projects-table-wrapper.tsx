'use client';

import * as React from 'react';
import { DataTable } from '@/components/data-table';
import { PROJECT_COLUMNS } from '@/components/data-table/column-config';
import { updateCellValue } from '@/lib/inline-edit-actions';

interface ProjectsTableWrapperProps {
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

export function ProjectsTableWrapper({
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
}: ProjectsTableWrapperProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  async function handleCellEdit(rowId: string, field: string, value: string | number | null) {
    return updateCellValue({ entityType: 'projects', rowId, field, value });
  }

  return (
    <DataTable
      entityType="projects"
      allColumns={PROJECT_COLUMNS}
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
      linkPrefix="/projects"
      linkField="project_number"
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
