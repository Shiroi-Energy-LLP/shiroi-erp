'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Card, CardContent, Button, Badge, Checkbox, Input,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';
import { formatProjectNumber } from '@repo/ui/formatters';
import {
  ChevronUp, ChevronDown, Columns3,
  ArrowUpDown, Check, X, Loader2,
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
  // Lead statuses
  new: { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  contacted: { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
  site_survey_scheduled: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  site_survey_done: { bg: '#F0FDF4', text: '#059669', border: '#A7F3D0' },
  design_confirmed: { bg: '#FAF5FF', text: '#7C3AED', border: '#DDD6FE' },
  proposal_sent: { bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
  negotiation: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  won: { bg: '#F0FDF4', text: '#00B050', border: '#86EFAC' },
  converted: { bg: '#F0FDF4', text: '#00B050', border: '#86EFAC' },
  lost: { bg: '#F5F5F5', text: '#525252', border: '#D4D4D4' },
  on_hold: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  disqualified: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  // Proposal statuses
  draft: { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' },
  sent: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  accepted: { bg: '#F0FDF4', text: '#00B050', border: '#BBF7D0' },
  rejected: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  expired: { bg: '#F5F5F5', text: '#525252', border: '#D4D4D4' },
  revised: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  // Project statuses (8-stage simplified flow)
  order_received: { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  yet_to_start: { bg: '#F5F6F8', text: '#525252', border: '#DFE2E8' },
  in_progress: { bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
  completed: { bg: '#F0FDF4', text: '#00B050', border: '#BBF7D0' },
  holding_shiroi: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  holding_client: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  waiting_net_metering: { bg: '#FAF5FF', text: '#7C3AED', border: '#DDD6FE' },
  meter_client_scope: { bg: '#F5F3FF', text: '#6D28D9', border: '#E9D5FF' },
};

// ── Inline Edit Cell ──

interface EditingCell {
  rowId: string;
  columnKey: string;
}

function InlineEditInput({
  value,
  fieldType,
  options,
  onSave,
  onCancel,
}: {
  value: string;
  fieldType: ColumnDef['fieldType'];
  options?: ColumnDef['options'];
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  const [localValue, setLocalValue] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | HTMLSelectElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current instanceof HTMLInputElement) {
      inputRef.current.select();
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  async function handleSave() {
    if (localValue === value) {
      onCancel();
      return;
    }
    setSaving(true);
    onSave(localValue);
  }

  // Select dropdown for badge/select fields
  if ((fieldType === 'select' || fieldType === 'badge') && options) {
    return (
      <div className="flex items-center gap-1">
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            onSave(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
          className="h-7 rounded border border-shiroi-green/40 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green"
          disabled={saving}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-n-400" />}
      </div>
    );
  }

  // Date input
  if (fieldType === 'date') {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="date"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => handleSave()}
          className="h-7 rounded border border-shiroi-green/40 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green"
          disabled={saving}
        />
        {saving && <Loader2 className="h-3 w-3 animate-spin text-n-400" />}
      </div>
    );
  }

  // Default text/number/phone/email input
  const inputType = fieldType === 'number' || fieldType === 'currency' ? 'number' : 'text';

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={inputType}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => handleSave()}
        className="h-7 w-full min-w-[80px] max-w-[200px] rounded border border-shiroi-green/40 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-shiroi-green"
        disabled={saving}
      />
      {saving && <Loader2 className="h-3 w-3 animate-spin text-n-400" />}
    </div>
  );
}

// ── Props ──

interface DataTableProps {
  entityType: string;
  allColumns: ColumnDef[];
  visibleColumns: string[];
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortColumn?: string;
  sortDirection?: string;
  currentFilters: Record<string, string>;
  views: any[];
  activeViewId: string | null;
  linkPrefix: string;
  linkField: string;
  idField?: string;
  bulkActions?: React.ReactNode;
  onSelectionChange?: (ids: string[]) => void;
  selectedIds?: string[];
  /** Callback for inline cell editing. If not provided, inline editing is disabled. */
  onCellEdit?: (rowId: string, field: string, value: string | number | null) => Promise<{ success: boolean; error?: string }>;
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
  onCellEdit,
}: DataTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [columns, setColumns] = React.useState<string[]>(initialColumns);
  const [showColumnPicker, setShowColumnPicker] = React.useState(false);
  const [activeView, setActiveView] = React.useState<string | null>(activeViewId);
  const [editingCell, setEditingCell] = React.useState<EditingCell | null>(null);
  const [editError, setEditError] = React.useState<string | null>(null);

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
      if (view.columns && Array.isArray(view.columns) && view.columns.length > 0) {
        setColumns(view.columns);
      }
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
      router.push(pathname);
      setColumns(initialColumns);
    }
  }

  // ── Inline editing ──

  function handleCellClick(rowId: string, col: ColumnDef) {
    if (!col.editable || !onCellEdit) return;
    // Don't edit link fields — they navigate
    if (col.key === linkField || col.fieldType === 'link') return;
    setEditingCell({ rowId, columnKey: col.key });
    setEditError(null);
  }

  async function handleCellSave(rowId: string, field: string, value: string) {
    if (!onCellEdit) return;

    // Convert value based on field type
    const col = allColumns.find((c) => c.key === field);
    let parsedValue: string | number | null = value;
    if (value === '' || value === null) {
      parsedValue = null;
    } else if (col?.fieldType === 'number' || col?.fieldType === 'currency') {
      parsedValue = parseFloat(value);
      if (isNaN(parsedValue)) parsedValue = null;
    }

    const result = await onCellEdit(rowId, field, parsedValue);
    if (!result.success) {
      setEditError(result.error ?? 'Failed to save');
      setTimeout(() => setEditError(null), 3000);
    }
    setEditingCell(null);
  }

  // ── Cell renderer ──

  function renderCell(row: Record<string, unknown>, col: ColumnDef): React.ReactNode {
    const val = row[col.key];
    const rowId = String(row[idField]);

    // Check if this cell is being edited
    if (editingCell?.rowId === rowId && editingCell?.columnKey === col.key) {
      const rawVal = val != null ? String(val) : '';
      return (
        <InlineEditInput
          value={rawVal}
          fieldType={col.fieldType}
          options={col.options}
          onSave={(newVal) => handleCellSave(rowId, col.key, newVal)}
          onCancel={() => setEditingCell(null)}
        />
      );
    }

    // Editable cell wrapper — shows subtle hover hint
    const isEditable = col.editable && onCellEdit && col.key !== linkField && col.fieldType !== 'link';
    const editableProps = isEditable
      ? {
          onDoubleClick: () => handleCellClick(rowId, col),
          className: 'cursor-text hover:bg-shiroi-green/5 rounded px-1 -mx-1 transition-colors',
          title: 'Double-click to edit',
        }
      : {};

    // Link field — always links to detail page
    if (col.key === linkField) {
      const displayVal = col.key === 'project_number'
        ? formatProjectNumber(val as string | null)
        : String(val ?? '—');
      return (
        <Link
          href={`${linkPrefix}/${row[idField]}`}
          className="font-medium text-shiroi-green hover:underline"
        >
          {displayVal}
        </Link>
      );
    }

    // Badge field (status)
    if (col.fieldType === 'badge' && val) {
      const strVal = String(val);
      const colors = STATUS_COLORS[strVal] ?? { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' };
      const label = col.options?.find((o) => o.value === strVal)?.label ?? strVal.replace(/_/g, ' ');
      return (
        <span {...editableProps}>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize border"
            style={{ backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }}
          >
            {label}
          </span>
        </span>
      );
    }

    // Select field
    if (col.fieldType === 'select' && val !== null && val !== undefined) {
      const strVal = String(val);
      const label = col.options?.find((o) => o.value === strVal)?.label ?? strVal;
      return <span {...editableProps} className={`text-sm capitalize ${editableProps.className ?? ''}`}>{label}</span>;
    }

    // Currency
    if (col.format === 'currency') return <span {...editableProps} className={`text-sm font-mono ${editableProps.className ?? ''}`}>{formatCurrency(val as number)}</span>;

    // Date
    if (col.format === 'date') return <span {...editableProps} className={`text-sm ${editableProps.className ?? ''}`}>{formatDate(val as string)}</span>;

    // Percentage
    if (col.format === 'percentage') return <span {...editableProps} className={`text-sm ${editableProps.className ?? ''}`}>{formatPercentage(val as number)}</span>;

    // Phone
    if (col.fieldType === 'phone') return <span {...editableProps} className={`text-sm font-mono ${editableProps.className ?? ''}`}>{val ? String(val) : '—'}</span>;

    // Email
    if (col.fieldType === 'email') return <span {...editableProps} className={`text-sm ${editableProps.className ?? ''}`}>{val ? String(val) : '—'}</span>;

    // Link (for proposal #, project #, customer_name on projects)
    if (col.fieldType === 'link') {
      const displayVal = col.key === 'project_number'
        ? formatProjectNumber(val as string | null)
        : String(val ?? '—');
      return (
        <Link
          href={`${linkPrefix}/${row[idField]}`}
          className="font-medium text-shiroi-green hover:underline"
        >
          {displayVal}
        </Link>
      );
    }

    // Default text
    return <span {...editableProps} className={`text-sm ${editableProps.className ?? ''}`}>{val != null ? String(val) : '—'}</span>;
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
          <span className="text-sm text-n-500">
            {total.toLocaleString('en-IN')} {entityType}
          </span>

          {/* Bulk actions slot */}
          {selectedIds.length > 0 && bulkActions}
        </div>

        <div className="flex items-center gap-2">
          {/* Inline edit error toast */}
          {editError && (
            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
              {editError}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowColumnPicker(true)}
            className="h-8 text-xs gap-1.5 text-n-500"
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
                        checked={allSelected}
                        indeterminate={someSelected}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  {visibleColumnDefs.map((col) => (
                    <TableHead
                      key={col.key}
                      className={`text-[11px] font-semibold uppercase tracking-wider text-n-500 ${col.sortable ? 'cursor-pointer select-none hover:text-n-900' : ''}`}
                      onClick={() => handleSort(col)}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {col.sortable && col.sortKey && (
                          <span className="inline-flex flex-col">
                            {sortColumn === col.sortKey ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-3 w-3 text-shiroi-green" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-shiroi-green" />
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
                      className="py-12 text-center text-n-400"
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
                        className={isSelected ? 'bg-shiroi-green/5' : 'hover:bg-[#F5F6F8]'}
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
          <div className="flex items-center justify-between text-sm text-n-500">
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
