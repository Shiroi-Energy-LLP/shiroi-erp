'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/data-table';
import { PROJECT_COLUMNS } from '@/components/data-table/column-config';
import { updateCellValue, bulkUpdateField } from '@/lib/inline-edit-actions';

interface ProjectsTableWrapperProps {
  /** Filter bar JSX rendered from the server page (FilterBar + FilterSelect + SearchInput) */
  filterBar: React.ReactNode;
  /** Status-count + total-system-size dashboard, rendered above the filter bar. */
  summaryHeader?: React.ReactNode;
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

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'order_received', label: 'Order Received' },
  { value: 'yet_to_start', label: 'Yet to Start' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'holding_shiroi', label: 'Holding from Shiroi' },
  { value: 'holding_client', label: 'Holding from Client' },
  { value: 'waiting_net_metering', label: 'Waiting for Net Metering' },
  { value: 'meter_client_scope', label: 'Meter - Client Scope' },
];

export function ProjectsTableWrapper({
  filterBar,
  summaryHeader,
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
  const router = useRouter();
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);

  async function handleCellEdit(rowId: string, field: string, value: string | number | null) {
    return updateCellValue({ entityType: 'projects', rowId, field, value });
  }

  async function handleBulkStatus(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    e.target.value = ''; // reset the dropdown back to the placeholder
    if (!newStatus || selectedIds.length === 0) return;

    const label = STATUS_OPTIONS.find((s) => s.value === newStatus)?.label ?? newStatus;
    const ok = window.confirm(
      `Change status of ${selectedIds.length} project${selectedIds.length > 1 ? 's' : ''} to "${label}"?`,
    );
    if (!ok) return;

    setBulkBusy(true);
    setBulkError(null);
    const res = await bulkUpdateField({
      entityType: 'projects',
      rowIds: selectedIds,
      field: 'status',
      value: newStatus,
    });
    setBulkBusy(false);

    if (!res.success) {
      setBulkError(res.error ?? 'Failed to update');
      return;
    }
    setSelectedIds([]);
    router.refresh();
  }

  return (
    // Fill main's viewport height so the table scrolls inside its own frame
    // (filter bar + column header stay fixed) instead of the whole page scrolling.
    <div className="flex h-full min-h-0 flex-col">
      {/*
        Filter bar + (conditional) bulk action bar — the ONLY fixed band.
        `-mt-4 lg:-mt-6` pulls it flush under the "Projects" topbar (merged white
        header); `-mx-4 lg:-mx-6` spans the full content width. The KPIs, Views
        and rows all scroll below it.
      */}
      <div className="shrink-0 -mx-4 -mt-4 lg:-mx-6 lg:-mt-6 border-b border-n-200 bg-white">
        <div className="px-4 lg:px-6 py-3">{filterBar}</div>
        {selectedIds.length > 0 && (
          <div className="border-t border-n-200 px-4 lg:px-6 py-2 bg-shiroi-gold/5 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-shiroi-gold-dark font-semibold">
              {selectedIds.length} selected
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-n-600">Change status to:</label>
              <select
                disabled={bulkBusy}
                defaultValue=""
                onChange={handleBulkStatus}
                className="h-7 text-xs border border-n-300 rounded px-2 bg-white hover:border-shiroi-gold focus:outline-none focus:ring-1 focus:ring-shiroi-gold disabled:opacity-50"
              >
                <option value="" disabled>
                  {bulkBusy ? 'Updating…' : 'Pick a status'}
                </option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-xs text-n-500 hover:text-n-900 underline underline-offset-2"
            >
              Clear selection
            </button>
            {bulkError && (
              <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                {bulkError}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Scroll region: KPIs + Views + rows all scroll; the column header freezes
          at the top (just under the fixed filter band) once the KPIs/Views pass. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 pt-4">
          {summaryHeader}
          <DataTable
            containedScroll
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
            linkField="customer_project"
            onSelectionChange={setSelectedIds}
            selectedIds={selectedIds}
            onCellEdit={handleCellEdit}
            bulkActions={null}
          />
        </div>
      </div>
    </div>
  );
}
