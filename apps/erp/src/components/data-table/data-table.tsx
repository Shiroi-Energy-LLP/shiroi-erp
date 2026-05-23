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
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import type { Database } from '@repo/types/database';

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
  /**
   * Per-column runtime options for select-style inline edits whose option list
   * isn't known at column-config time (e.g. the referrer column, where the
   * choices come from the channel_partners table). When set for a column, it
   * overrides whatever the column's static `options` prop says.
   */
  dynamicOptions?: Record<string, { value: string; label: string }[]>;
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
  dynamicOptions,
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
      // Referrer cell uses the raw channel_partner_id, not the joined display
      // string. Same for any other "derived display" columns we add later —
      // they should expose the underlying foreign-key value via a parallel
      // `${col.key}_id` field on the row.
      const editKey = col.key === 'referrer' ? 'channel_partner_id' : col.key;
      const rawEditVal = row[editKey];
      const rawVal = rawEditVal != null ? String(rawEditVal) : '';
      const effectiveOptions = dynamicOptions?.[col.key] ?? col.options;
      return (
        <InlineEditInput
          value={rawVal}
          fieldType={col.fieldType}
          options={effectiveOptions}
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

    // Referrer column — shows VIP badge for internal partners, "+ Set" when
    // null. Double-click anywhere on the cell opens an inline select populated
    // with the partner list (passed in via DataTable's `dynamicOptions` prop).
    // The save handler in leads-table-wrapper translates the column key
    // 'referrer' → DB column 'channel_partner_id'.
    if (col.key === 'referrer') {
      const referrerName = row['referrer_name'] as string | null;
      const isInternal = row['referrer_is_internal'] as boolean | null;
      const canEdit = !!onCellEdit && col.editable;
      const editProps = canEdit
        ? {
            onDoubleClick: () => handleCellClick(rowId, col),
            className: 'cursor-text hover:bg-shiroi-green/[0.08] rounded px-1 -mx-1 transition-colors',
            title: 'Double-click to change referrer',
          }
        : {};
      if (!referrerName) {
        return (
          <span
            {...editProps}
            className={`${editProps.className ?? ''} inline-flex items-center text-xs text-shiroi-green/70 hover:text-shiroi-green`}
          >
            + Set referrer
          </span>
        );
      }
      if (isInternal) {
        return (
          <span {...editProps} className={`${editProps.className ?? ''} inline-flex items-center gap-1.5`}>
            <span className="inline-flex items-center rounded-full border border-transparent bg-status-success-bg px-1.5 py-0 text-[10px] font-bold text-status-success-text">VIP</span>
            <span className="text-sm font-medium text-n-900">{referrerName}</span>
          </span>
        );
      }
      return (
        <span {...editProps} className={`${editProps.className ?? ''} text-sm text-n-700`}>
          {referrerName}
        </span>
      );
    }

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

    // Badge field (status). For LEADS this delegates to LeadStatusBadge so the
    // table shares the same palette + pill shape as the lead detail page.
    // For other entities we keep the generic STATUS_COLORS pill.
    if (col.fieldType === 'badge' && val) {
      const strVal = String(val);
      if (entityType === 'leads' && col.key === 'status') {
        return (
          <span {...editableProps}>
            <LeadStatusBadge status={strVal as Database['public']['Enums']['lead_status']} />
          </span>
        );
      }
      const colors = STATUS_COLORS[strVal] ?? { bg: '#F5F6F8', text: '#7C818E', border: '#DFE2E8' };
      const label = col.options?.find((o) => o.value === strVal)?.label ?? strVal.replace(/_/g, ' ');
      return (
        <span {...editableProps}>
          <span
            className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] min-w-[88px] border"
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
              <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
                <TableRow className={entityType === 'leads' ? 'bg-gradient-to-b from-n-50 to-white border-b-2 border-n-200 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-n-600 [&_th]:h-11' : 'bg-[#F5F6F8]'}>
                  {/* Checkbox header */}
                  {onSelectionChange && (
                    <TableHead className="w-8 border-r border-n-100 px-3">
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

                    // No row-level dblclick handler — it conflicted with
                    // cell-level dblclick inline-editing (the row handler
                    // fires on event bubbling and navigates away). Per
                    // Vivek's pushback: cells stay independently editable;
                    // navigation is the customer-name link and the new
                    // referrer-cell dblclick handler below.
                    const leadsRowClass = entityType === 'leads'
                      ? (isSelected
                          ? 'h-12 bg-shiroi-green/[0.08] border-l-2 border-l-shiroi-green'
                          : 'h-12 hover:bg-shiroi-green/[0.06] border-l-2 border-l-transparent transition-colors')
                      : (isSelected ? 'bg-shiroi-green/5' : 'hover:bg-n-050');

                    return (
                      <TableRow
                        key={rowId}
                        className={leadsRowClass}
                        data-state={isSelected ? 'selected' : undefined}
                      >
                        {onSelectionChange && (
                          <TableCell className="w-8 border-r border-n-100 px-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectRow(rowId)}
                            />
                          </TableCell>
                        )}
                        {visibleColumnDefs.map((col) => {
                          // Per-column cell class hooks
                          let cellClass = entityType === 'leads' ? 'px-3 py-2' : 'py-2';
                          if (entityType === 'leads') {
                            if (col.key === 'customer_name') {
                              cellClass += ' font-medium text-n-900';
                            } else if (
                              col.fieldType === 'number' ||
                              /kwp|value|date/i.test(col.key)
                            ) {
                              cellClass += ' font-mono tabular-nums text-right';
                            }
                          } else {
                            if (col.key === 'customer_name') cellClass += ' font-medium';
                            if (col.fieldType === 'phone') cellClass += ' tabular-nums';
                            if (col.fieldType === 'number' || col.format === 'currency') cellClass += ' text-right tabular-nums';
                          }
                          return (
                            <TableCell key={col.key} className={cellClass}>
                              {renderCell(row, col)}
                            </TableCell>
                          );
                        })}
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
