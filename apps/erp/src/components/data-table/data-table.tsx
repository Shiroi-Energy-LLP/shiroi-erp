'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Card, CardContent, Button, Badge, Checkbox,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';
import {
  ChevronUp, ChevronDown, Columns3,
  ArrowUpDown,
} from 'lucide-react';
import { ColumnPicker } from './column-picker';
import { ViewTabs } from './view-tabs';
import type { ColumnDef } from './column-config';

// ── Formatters ──

function formatDate(val: string | null): string {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatCurrency(val: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val);
}

function formatPercentage(val: number | null): string {
  if (val == null) return '—';
  return `${val.toFixed(1)}%`;
}

// ── Badge colors ──

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  new: { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  contacted: { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
  follow_up: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  qualified: { bg: '#F0FDF4', text: '#00B050', border: '#BBF7D0' },
  site_visit_scheduled: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  site_visit_done: { bg: '#F0FDF4', text: '#059669', border: '#A7F3D0' },
  design_confirmed: { bg: '#FAF5FF', text: '#7C3AED', border: '#DDD6FE' },
  proposal_sent: { bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
  converted: { bg: '#F0FDF4', text: '#00B050', border: '#86EFAC' },
  disqualified: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  lost: { bg: '#F5F5F5', text: '#525252', border: '#D4D4D4' },
  draft: { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' },
  sent: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  accepted: { bg: '#F0FDF4', text: '#00B050', border: '#BBF7D0' },
  rejected: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  expired: { bg: '#F5F5F5', text: '#525252', border: '#D4D4D4' },
  revised: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
};

// ── Props ──

interface DataTableProps {
  entityType: string;
  /** All available column definitions */
  allColumns: ColumnDef[];
  /** Currently visible column keys */
  visibleColumns: string[];
  /** The actual data rows */
  data: Record<string, unknown>[];
  /** Pagination */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Current sort */
  sortColumn?: string;
  sortDirection?: string;
  /** Current filters (from URL params) */
  currentFilters: Record<string, string>;
  /** Saved views for this entity */
  views: any[];
  activeViewId: string | null;
  /** Link prefix for row click (e.g., '/leads') */
  linkPrefix: string;
  /** Which field is the link field (e.g., 'customer_name' for leads) */
  linkField: string;
  /** ID field */
  idField?: string;
  /** Bulk actions component */
  bulkActions?: React.ReactNode;
  /** Callback when selection changes */
  onSelectionChange?: (ids: string[]) => void;
  /** Selected IDs (controlled) */
  selectedIds?: string[];
}

export function DataTable({
  entityType,
  allColumns,
  visibleColumns: initialColumns,
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
  linkPrefix,
  linkField,
  idField = 'id',
  bulkActions,
  onSelectionChange,
  selectedIds = [],
}: DataTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [columns, setColumns] = React.useState<string[]>(initialColumns);
  const [showColumnPicker, setShowColumnPicker] = React.useState(false);
  const [activeView, setActiveView] = React.useState<string | null>(activeViewId);

  // Get column defs for visible columns
  const visibleColumnDefs = columns
    .map((key) => allColumns.find((c) => c.key === key))
    .filter(Boolean) as ColumnDef[];

  // ── URL helpers ──

  function updateUrl(params: Record<string, string | undefined>) {
    const current = new URLSearchParams(searchParams.toString());
    Object.entries(params).forEach(([key, val]) => {
      if (val) current.set(key, val);
      else current.delete(key);
    });
    // Reset to page 1 when filters change
    if (!params.page) current.delete('page');
    router.push(`${pathname}?${current.toString()}`);
  }

  function handleSort(column: ColumnDef) {
    if (!column.sortable || !column.sortKey) return;
    const newDir = sortColumn === column.sortKey && sortDirection === 'asc' ? 'desc' : 'asc';
    updateUrl({ sort: column.sortKey, dir: newDir });
  }

  // ── Selection ──

  const allSelected = data.length > 0 && selectedIds.length === data.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < data.length;

  function toggleSelectAll() {
    if (allSelected) {
      onSelectionChange?.([]);
    } else {
      onSelectionChange?.(data.map((row) => String(row[idField])));
    }
  }

  function toggleSelectRow(id: string) {
    if (selectedIds.includes(id)) {
      onSelectionChange?.(selectedIds.filter((i) => i !== id));
    } else {
      onSelectionChange?.([...selectedIds, id]);
    }
  }

  // ── View switching ──

  function handleViewChange(view: any | null) {
    setActiveView(view?.id ?? null);
    if (view) {
      // Apply view's columns
      if (view.columns && Array.isArray(view.columns) && view.columns.length > 0) {
        setColumns(view.columns);
      }
      // Apply view's filters and sort via URL
      const params: Record<string, string | undefined> = {};
      if (view.filters && typeof view.filters === 'object') {
        Object.entries(view.filters).forEach(([k, v]) => {
          params[k] = v as string;
        });
      }
      if (view.sort_column) params.sort = view.sort_column;
      if (view.sort_direction) params.dir = view.sort_direction;
      params.view = view.id;
      updateUrl(params);
    } else {
      // Reset to default
      router.push(pathname);
      setColumns(initialColumns);
    }
  }

  // ── Cell renderer ──

  function renderCell(row: Record<string, unknown>, col: ColumnDef): React.ReactNode {
    const val = row[col.key];

    // Link field — always links to detail page
    if (col.key === linkField) {
      return (
        <Link
          href={`${linkPrefix}/${row[idField]}`}
          className="font-medium text-[#00B050] hover:underline"
        >
          {String(val ?? '—')}
        </Link>
      );
    }

    // Badge field (status)
    if (col.fieldType === 'badge' && val) {
      const strVal = String(val);
      const colors = STATUS_COLORS[strVal] ?? { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' };
      const label = col.options?.find((o) => o.value === strVal)?.label ?? strVal.replace(/_/g, ' ');
      return (
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize border"
          style={{ backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }}
        >
          {label}
        </span>
      );
    }

    // Select field
    if (col.fieldType === 'select' && val !== null && val !== undefined) {
      const strVal = String(val);
      const label = col.options?.find((o) => o.value === strVal)?.label ?? strVal;
      return <span className="text-sm capitalize">{label}</span>;
    }

    // Currency
    if (col.format === 'currency') return <span className="text-sm font-mono">{formatCurrency(val as number)}</span>;

    // Date
    if (col.format === 'date') return <span className="text-sm">{formatDate(val as string)}</span>;

    // Percentage
    if (col.format === 'percentage') return <span className="text-sm">{formatPercentage(val as number)}</span>;

    // Phone
    if (col.fieldType === 'phone') return <span className="text-sm font-mono">{val ? String(val) : '—'}</span>;

    // Email
    if (col.fieldType === 'email') return <span className="text-sm">{val ? String(val) : '—'}</span>;

    // Link (for proposal #, project #)
    if (col.fieldType === 'link') {
      return (
        <Link
          href={`${linkPrefix}/${row[idField]}`}
          className="font-medium text-[#00B050] hover:underline"
        >
          {String(val ?? '—')}
        </Link>
      );
    }

    // Default text
    return <span className="text-sm">{val != null ? String(val) : '—'}</span>;
  }

  return (
    <div className="space-y-0">
      {/* View Tabs */}
      <ViewTabs
        entityType={entityType}
        views={views}
        activeViewId={activeView}
        onViewChange={handleViewChange}
        currentColumns={columns}
        currentFilters={currentFilters}
        currentSort={sortColumn ? { column: sortColumn, direction: sortDirection ?? 'desc' } : undefined}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#7C818E]">
            {total.toLocaleString('en-IN')} {entityType}
          </span>

          {/* Bulk actions slot */}
          {selectedIds.length > 0 && bulkActions}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowColumnPicker(true)}
            className="h-8 text-xs gap-1.5 text-[#7C818E]"
          >
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F5F6F8]">
                  {/* Checkbox header */}
                  {onSelectionChange && (
                    <TableHead className="w-10 px-3">
                      <Checkbox
                        checked={someSelected ? 'indeterminate' : allSelected}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  {visibleColumnDefs.map((col) => (
                    <TableHead
                      key={col.key}
                      className={`text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] ${col.sortable ? 'cursor-pointer select-none hover:text-[#1A1D24]' : ''}`}
                      onClick={() => handleSort(col)}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {col.sortable && col.sortKey && (
                          <span className="inline-flex flex-col">
                            {sortColumn === col.sortKey ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-3 w-3 text-[#00B050]" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-[#00B050]" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-30" />
                            )}
                          </span>
                        )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumnDefs.length + (onSelectionChange ? 1 : 0)}
                      className="py-12 text-center text-[#9CA0AB]"
                    >
                      No {entityType} found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row) => {
                    const rowId = String(row[idField]);
                    const isSelected = selectedIds.includes(rowId);

                    return (
                      <TableRow
                        key={rowId}
                        className={isSelected ? 'bg-[#00B050]/5' : 'hover:bg-[#F5F6F8]'}
                        data-state={isSelected ? 'selected' : undefined}
                      >
                        {onSelectionChange && (
                          <TableCell className="w-10 px-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectRow(rowId)}
                            />
                          </TableCell>
                        )}
                        {visibleColumnDefs.map((col) => (
                          <TableCell key={col.key} className="py-2.5">
                            {renderCell(row, col)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pt-3">
          <div className="flex items-center justify-between text-sm text-[#7C818E]">
            <span>
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateUrl({ page: String(page - 1) })}
                className="h-8"
              >
                Previous
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
                const pageNum = startPage + i;
                if (pageNum > totalPages) return null;
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateUrl({ page: String(pageNum) })}
                    className="h-8 w-8 p-0"
                  >
                    {pageNum}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => updateUrl({ page: String(page + 1) })}
                className="h-8"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Column Picker Panel */}
      <ColumnPicker
        allColumns={allColumns}
        visibleColumns={columns}
        onColumnsChange={setColumns}
        open={showColumnPicker}
        onOpenChange={setShowColumnPicker}
      />
    </div>
  );
}
