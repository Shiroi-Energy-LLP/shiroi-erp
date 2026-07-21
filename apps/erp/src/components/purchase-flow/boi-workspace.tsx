'use client';

// =============================================================================
// BOI workspace client root (spec §5 + §12) — owns:
// - filter state (project · status · category · vendor · free-text search)
//   with CLIENT-SIDE filtering over the fully loaded line set (no pagination)
// - KPI row: "Total Amount (filtered)" + one card per status; the status
//   cards apply every filter EXCEPT status (money of record = RPC, refreshed
//   via getBoiStatusTotalsAction when a non-status filter changes)
// - multi-select state (header checkbox = visible rows; filter changes prune
//   hidden rows silently — spec §5.5)
// - the add / edit / bulk-add modals and the bulk action bar
//
// FOCUS RULE: the filter bar lives in the stable ListPageShell header and is
// never remounted — the search input keeps focus while typing; filtering is
// debounced into `search`. EVERY filter mirrors into the URL via
// history.replaceState (no navigation, no server refetch) so it survives
// navigating away and back (spec §12): ?project= · ?category= · ?vendor= ·
// ?search= · ?fstatus= (the free status dropdown — deliberately a DIFFERENT
// param from ?status=, which is the sidebar's locked-status-view marker and
// is left untouched here).
//
// PROP SYNC RULE: single-row mutations patch `lines`/`totals` locally from the
// action's returned row — the actions no longer revalidate /purchase, and the
// initialLines/initialTotals sync effect is guarded by a deliberate-refresh
// flag so incidental RSC prop churn (e.g. another action's revalidate) can
// never clobber locally-patched state. Only handleBulkAdded (count-only
// result) raises the flag and router.refresh()es.
// =============================================================================

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PackagePlus, Plus } from 'lucide-react';
import { Button, Input, Select, cn, formatINR, useToast } from '@repo/ui';
import type { Database } from '@repo/types/database';
import { ListPageShell } from '@/components/list-page-shell';
import {
  bulkUpdateBoiStatus,
  deleteBoiLines,
  getBoiStatusTotalsAction,
} from '@/lib/purchase-flow-actions';
import {
  BOI_STATUSES,
  BOI_STATUS_COLORS,
  BOI_STATUS_LABELS,
  PURCHASE_WRITE_ROLES,
  PRICE_VISIBLE_ROLES,
  displayBoiStatus,
  isBoiStatus,
  type BoiLineRow,
  type BoiStatus,
  type BoiStatusTotalsResult,
  type CreateBoiPoResult,
  type ProjectOption,
} from '@/lib/purchase-flow-constants';
import { BoiTable } from './boi-table';
import { BoiExportButtons } from './boi-export';
import { BoiBulkBar } from './boi-bulk-bar';
import { BoiAddItemModal } from './boi-add-item-modal';
import { BoiBulkAddModal } from './boi-bulk-add-modal';
import { CreatePoModal } from './create-po-modal';
import { ProjectCombobox } from './project-combobox';

type AppRole = Database['public']['Enums']['app_role'];

interface BoiWorkspaceProps {
  viewerRole: AppRole;
  initialLines: BoiLineRow[];
  initialTotals: BoiStatusTotalsResult;
  initialProjects: ProjectOption[];
  categories: { value: string; label: string }[];
  /** Set when the page was opened as a locked status view (?status=…). */
  lockedStatus: BoiStatus | null;
  initialProjectId: string | null;
  /** Free status-dropdown filter restored from ?fstatus= (never set when the
   *  view is status-locked). */
  initialStatusFilter: BoiStatus | null;
  initialCategory: string;
  initialVendor: string;
  initialSearch: string;
}

export function BoiWorkspace({
  viewerRole,
  initialLines,
  initialTotals,
  initialProjects,
  categories,
  lockedStatus,
  initialProjectId,
  initialStatusFilter,
  initialCategory,
  initialVendor,
  initialSearch,
}: BoiWorkspaceProps) {
  const router = useRouter();
  const { addToast } = useToast();

  const showPrices = (PRICE_VISIBLE_ROLES as readonly AppRole[]).includes(viewerRole);
  const canWrite = (PURCHASE_WRITE_ROLES as readonly AppRole[]).includes(viewerRole);

  // --- data ---------------------------------------------------------------
  const [lines, setLines] = React.useState(initialLines);
  const [totals, setTotals] = React.useState(initialTotals);
  const [projects, setProjects] = React.useState(initialProjects);
  React.useEffect(() => setProjects(initialProjects), [initialProjects]);
  // initialLines/initialTotals sync is deliberate-refresh-guarded — see the
  // effect below refreshTotals (PROP SYNC RULE in the header comment).
  const pendingServerSync = React.useRef(false);
  const lastServerProps = React.useRef({ lines: initialLines, totals: initialTotals });

  // --- filters ------------------------------------------------------------
  const [projectId, setProjectId] = React.useState<string | null>(initialProjectId);
  const [statusFilter, setStatusFilter] = React.useState<BoiStatus | null>(initialStatusFilter);
  const [category, setCategory] = React.useState(initialCategory);
  const [vendor, setVendor] = React.useState(initialVendor);
  const [searchInput, setSearchInput] = React.useState(initialSearch);
  const [search, setSearch] = React.useState(initialSearch);
  const effectiveStatus = lockedStatus ?? statusFilter;

  // Debounce the free-text search — the input itself never remounts, so the
  // focus survives typing; only the applied filter lags by 300ms.
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Persist EVERY filter into the URL without navigating (spec §12 — filters
  // survive leaving and returning). ?status= stays sidebar-owned (locked
  // views); the free status dropdown persists as ?fstatus= so returning to
  // the page restores the dropdown instead of locking the view. `search` is
  // the debounced value, so the URL updates at most every 300ms.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };
    setOrDelete('project', projectId);
    if (!lockedStatus) setOrDelete('fstatus', statusFilter);
    setOrDelete('category', category || null);
    setOrDelete('vendor', vendor || null);
    setOrDelete('search', search || null);
    window.history.replaceState(null, '', url.toString());
  }, [projectId, statusFilter, category, vendor, search, lockedStatus]);

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    return lines.filter((l) => {
      if (projectId && l.project_id !== projectId) return false;
      if (effectiveStatus && displayBoiStatus(l.procurement_status) !== effectiveStatus) return false;
      if (category && l.item_category !== category) return false;
      if (vendor && (l.vendor_name ?? '') !== vendor) return false;
      if (q) {
        const hay = `${l.item_description} ${l.item_category} ${l.brand ?? ''} ${l.vendor_name ?? ''} ${l.project_display_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lines, projectId, effectiveStatus, category, vendor, search]);

  const vendors = React.useMemo(
    () =>
      [...new Set(lines.map((l) => l.vendor_name).filter((v): v is string => !!v))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [lines],
  );

  const categoryLabels = React.useMemo(
    () => Object.fromEntries(categories.map((c) => [c.value, c.label])),
    [categories],
  );

  const hasFilters = !!(projectId || statusFilter || category || vendor || searchInput);

  // --- KPI refresh (status cards ignore the status filter — spec §5.2) -----
  const refreshSeq = React.useRef(0);
  const refreshTotals = React.useCallback(async () => {
    const seq = ++refreshSeq.current;
    const result = await getBoiStatusTotalsAction({
      projectId: projectId ?? undefined,
      category: category || undefined,
      vendor: vendor || undefined,
      search: search || undefined,
    });
    if (result.success && seq === refreshSeq.current) setTotals(result.data);
  }, [projectId, category, vendor, search]);

  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return; // initial totals came from the server render (all filters applied)
    }
    void refreshTotals();
  }, [refreshTotals]);

  // Deliberate-refresh-guarded prop sync (PROP SYNC RULE): server props are
  // adopted ONLY when a handler raised pendingServerSync before calling
  // router.refresh() (bulk add — the one flow with a count-only result).
  // Incidental prop churn (another action's revalidatePath, unrelated RSC
  // re-renders) is tracked but ignored, so locally-patched rows/totals from
  // inline edits are never clobbered. After adopting, totals are re-derived
  // via the RPC when a filter is active — the refreshed server render computes
  // them from the URL params, which can lag the live state (debounce window).
  React.useEffect(() => {
    const changed =
      initialLines !== lastServerProps.current.lines ||
      initialTotals !== lastServerProps.current.totals;
    if (!changed) return;
    lastServerProps.current = { lines: initialLines, totals: initialTotals };
    if (!pendingServerSync.current) return;
    pendingServerSync.current = false;
    setLines(initialLines);
    setTotals(initialTotals);
    if (projectId || category || vendor || search) void refreshTotals();
  }, [initialLines, initialTotals, projectId, category, vendor, search, refreshTotals]);

  // --- selection (visible rows only; filters silently prune — spec §5.5) ---
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const visibleIds = React.useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);

  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      filtered.every((r) => prev.has(r.id)) ? new Set() : new Set(filtered.map((r) => r.id)),
    );
  }

  // --- modals -------------------------------------------------------------
  const [addOpen, setAddOpen] = React.useState(false);
  const [editRow, setEditRow] = React.useState<BoiLineRow | null>(null);
  const [bulkAddOpen, setBulkAddOpen] = React.useState(false);
  const [createPoOpen, setCreatePoOpen] = React.useState(false);

  // Selected rows in visible order — the create-PO modal's working set.
  const selectedRows = React.useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected],
  );

  // --- mutations ----------------------------------------------------------
  function handleRowUpdated(fresh: BoiLineRow) {
    setLines((prev) => prev.map((l) => (l.id === fresh.id ? fresh : l)));
    void refreshTotals();
  }

  function handleSaved(fresh: BoiLineRow, isEdit: boolean) {
    if (isEdit) setLines((prev) => prev.map((l) => (l.id === fresh.id ? fresh : l)));
    else setLines((prev) => [...prev, fresh]);
    void refreshTotals();
  }

  function handleBulkAdded() {
    // Batch insert returns only a count — re-render the server page for the
    // fresh rows (client filter/selection state survives router.refresh).
    // Raise the deliberate-refresh flag so the guarded prop-sync effect adopts
    // the refreshed props (and re-runs refreshTotals when filters are active).
    pendingServerSync.current = true;
    router.refresh();
  }

  async function handleDeleteRow(row: BoiLineRow) {
    if (!window.confirm(`Delete "${row.item_description}"?`)) return;
    const result = await deleteBoiLines([row.id]);
    if (result.success) {
      setLines((prev) => prev.filter((l) => l.id !== row.id));
      setSelected((prev) => {
        if (!prev.has(row.id)) return prev;
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      addToast({ variant: 'success', title: 'Item deleted' });
      void refreshTotals();
    } else {
      addToast({ variant: 'destructive', title: 'Delete failed', description: result.error });
    }
  }

  async function handleBulkStatus(status: BoiStatus) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Change status of ${ids.length} item(s) to ${BOI_STATUS_LABELS[status]}?`)) return;
    setBulkBusy(true);
    const result = await bulkUpdateBoiStatus(ids, status);
    setBulkBusy(false);
    if (result.success) {
      const idSet = new Set(ids);
      setLines((prev) =>
        prev.map((l) => (idSet.has(l.id) ? { ...l, procurement_status: status } : l)),
      );
      addToast({ variant: 'success', title: `${result.data.updated} item(s) → ${BOI_STATUS_LABELS[status]}` });
      void refreshTotals();
    } else {
      addToast({ variant: 'destructive', title: 'Status change failed', description: result.error });
    }
  }

  /** Post-create patch (spec §6.2.8): included lines flip to order_placed,
   *  gain their PO linkage + the PO's vendor string (the RPC stamped both),
   *  selection clears. Toast + PDF download already happened in the modal. */
  function handlePoCreated(result: CreateBoiPoResult, itemIds: string[], vendorName: string) {
    const idSet = new Set(itemIds);
    setLines((prev) =>
      prev.map((l) =>
        idSet.has(l.id)
          ? {
              ...l,
              procurement_status: 'order_placed',
              purchase_order_id: result.poId,
              po_number: result.poNumber,
              vendor_name: vendorName || l.vendor_name,
            }
          : l,
      ),
    );
    setSelected(new Set());
    void refreshTotals();
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected item(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    const result = await deleteBoiLines(ids);
    setBulkBusy(false);
    if (result.success) {
      const idSet = new Set(ids);
      setLines((prev) => prev.filter((l) => !idSet.has(l.id)));
      setSelected(new Set());
      addToast({ variant: 'success', title: `${result.data.deleted} item(s) deleted` });
      void refreshTotals();
    } else {
      addToast({ variant: 'destructive', title: 'Delete failed', description: result.error });
    }
  }

  // --- KPI values ---------------------------------------------------------
  // First card = every filter applied INCLUDING status (RPC money of record:
  // grand totals when no status filter, the one status's bucket otherwise).
  const filteredKpi = effectiveStatus
    ? totals.byStatus[effectiveStatus]
    : { lineCount: totals.grandCount, totalAmount: totals.grandTotal };

  return (
    <ListPageShell
      header={
        <div className="flex flex-wrap items-center gap-2">
          <ProjectCombobox
            projects={projects}
            value={projectId}
            onSelect={(p) => setProjectId(p?.id ?? null)}
            clearable
            placeholder="All Projects"
            className="w-52"
          />
          {!lockedStatus && (
            <Select
              value={statusFilter ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setStatusFilter(isBoiStatus(v) ? v : null);
              }}
              className="h-8 w-40 text-xs"
              aria-label="Status filter"
            >
              <option value="">All Statuses</option>
              {BOI_STATUSES.map((s) => (
                <option key={s} value={s}>{BOI_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          )}
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 w-44 text-xs"
            aria-label="Category filter"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
          <Select
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="h-8 w-44 text-xs"
            aria-label="Vendor filter"
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search item, make, vendor, project…"
            className="h-8 w-56 text-xs"
            aria-label="Search bill of items"
          />
          {hasFilters && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setProjectId(null);
                setStatusFilter(null);
                setCategory('');
                setVendor('');
                setSearchInput('');
              }}
            >
              Clear Filters
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Exports (spec §5.2 order: Clear · Excel · PDF · Add Multiple ·
                Add Item) — cover exactly the filtered rows in current order */}
            <BoiExportButtons
              rows={filtered}
              showPrices={showPrices}
              categoryLabels={categoryLabels}
              projectName={
                projectId ? (projects.find((p) => p.id === projectId)?.name ?? null) : null
              }
              statusLabel={effectiveStatus ? BOI_STATUS_LABELS[effectiveStatus] : null}
              categoryLabel={category ? (categoryLabels[category] ?? category) : null}
              vendorLabel={vendor || null}
            />
            {canWrite && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setBulkAddOpen(true)}
                >
                  <PackagePlus className="h-3.5 w-3.5" /> Add Multiple
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    setEditRow(null);
                    setAddOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <h1 className="text-lg font-heading font-bold text-n-900">
        {lockedStatus ? BOI_STATUS_LABELS[lockedStatus] : 'Bill of Items'}{' '}
        <span className="text-sm font-normal text-n-500">({filtered.length} lines)</span>
      </h1>

      {/* KPI row — status cards ignore the status filter (spec §5.2) */}
      {showPrices && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg border border-shiroi-gold/40 bg-amber-50/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-n-500">
              Total Amount (filtered)
            </p>
            <p className="mt-0.5 font-heading text-lg font-bold text-n-950">
              {formatINR(filteredKpi.totalAmount)}
            </p>
            <p className="text-[10px] text-n-400">{filteredKpi.lineCount} lines</p>
          </div>
          {BOI_STATUSES.map((s) => (
            <div key={s} className={cn('rounded-lg border px-3 py-2.5', BOI_STATUS_COLORS[s])}>
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                {BOI_STATUS_LABELS[s]}
              </p>
              <p className="mt-0.5 font-heading text-lg font-bold">
                {formatINR(totals.byStatus[s].totalAmount)}
              </p>
              <p className="text-[10px] opacity-70">{totals.byStatus[s].lineCount} lines</p>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <BoiBulkBar
          count={selected.size}
          busy={bulkBusy}
          canWrite={canWrite}
          onChangeStatus={(s) => void handleBulkStatus(s)}
          onCreatePo={() => setCreatePoOpen(true)}
          onDeleteSelected={() => void handleBulkDelete()}
          onClearSelection={() => setSelected(new Set())}
        />
      )}

      <div className="rounded-lg border border-n-200 bg-white">
        <BoiTable
          rows={filtered}
          categoryLabels={categoryLabels}
          showPrices={showPrices}
          canWrite={canWrite}
          selectedIds={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onEdit={(row) => {
            setEditRow(row);
            setAddOpen(true);
          }}
          onDelete={(row) => void handleDeleteRow(row)}
          onRowUpdated={handleRowUpdated}
        />
      </div>

      <BoiAddItemModal
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setEditRow(null);
        }}
        editRow={editRow}
        projects={projects}
        onProjectCreated={(p) => setProjects((prev) => [p, ...prev])}
        categories={categories}
        defaultProjectId={projectId}
        onSaved={handleSaved}
      />
      <BoiBulkAddModal
        open={bulkAddOpen}
        onOpenChange={setBulkAddOpen}
        projects={projects}
        onProjectCreated={(p) => setProjects((prev) => [p, ...prev])}
        defaultProjectId={projectId}
        onSaved={handleBulkAdded}
      />
      <CreatePoModal
        open={createPoOpen}
        onOpenChange={setCreatePoOpen}
        selectedRows={selectedRows}
        projects={projects}
        onCreated={handlePoCreated}
      />
    </ListPageShell>
  );
}
