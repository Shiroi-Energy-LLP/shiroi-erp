'use client';

// =============================================================================
// PO log client (spec §7) — read-only history of quick POs, newest first.
// - One search box (PO number / project / vendor / creator — matched
//   server-side by getBoiPos) debounced into the URL, + Clear + ⟳ Refresh.
// - KPI cards: Total POs · Total PO Value (both SQL aggregates over the whole
//   filtered set — never a JS reduce, NEVER-DO #12).
// - Edit modal changes METADATA ONLY (items/amounts frozen, spec §6.3) with
//   the exact §7 banner. Delete modal carries the default-ON "revert items to
//   Yet to Place" checkbox → deleteBoiPoAction(poId, revert).
// - PDF column always links the download route — it regenerates from the
//   frozen purchase_order_items even when the Storage copy failed.
// =============================================================================

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  KpiCard,
  Label,
  Pagination,
  cn,
  formatDate,
  formatDateFromTimestamp,
  formatINR,
  useToast,
} from '@repo/ui';
import { ListPageShell } from '@/components/list-page-shell';
import { deleteBoiPoAction, updateBoiPoMeta } from '@/lib/purchase-flow-actions';
import type { BoiPoRow, ProjectOption } from '@/lib/purchase-flow-constants';
import { ProjectCombobox } from './project-combobox';

const TH = 'px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider';

interface PoLogClientProps {
  rows: BoiPoRow[];
  /** Filtered PO count (SQL count: 'estimated'). */
  total: number;
  /** Filtered Σ total_amount (SQL sum aggregate). */
  totalValue: number;
  page: number;
  pageSize: number;
  /** The applied search term (from the URL). */
  search: string;
  projects: ProjectOption[];
  canWrite: boolean;
}

export function PoLogClient({
  rows: initialRows,
  total,
  totalValue,
  page,
  pageSize,
  search,
  projects,
  canWrite,
}: PoLogClientProps) {
  const router = useRouter();

  // Local copy so edit/delete can patch rows without a full round-trip.
  const [rows, setRows] = React.useState(initialRows);
  React.useEffect(() => setRows(initialRows), [initialRows]);

  // --- search (debounced into the URL; input never remounts so focus holds) --
  const [searchInput, setSearchInput] = React.useState(search);
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (next === search) return;
      const params = new URLSearchParams();
      if (next) params.set('search', next);
      const qs = params.toString();
      router.replace(qs ? `/purchase/orders?${qs}` : '/purchase/orders');
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput, search, router]);

  function clearSearch() {
    setSearchInput('');
    router.replace('/purchase/orders');
  }

  // --- modals ---------------------------------------------------------------
  const [editRow, setEditRow] = React.useState<BoiPoRow | null>(null);
  const [deleteRow, setDeleteRow] = React.useState<BoiPoRow | null>(null);

  function handleEdited(fresh: BoiPoRow) {
    setRows((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));
  }

  function handleDeleted(poId: string) {
    setRows((prev) => prev.filter((r) => r.id !== poId));
    // Counts/KPIs/pagination come from the server — re-render for the truth.
    router.refresh();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <ListPageShell
      header={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search PO number, project, vendor, creator…"
            className="h-8 w-72 text-xs"
            aria-label="Search purchase orders"
          />
          {(searchInput || search) && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSearch}>
              Clear
            </Button>
          )}
          <div className="ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => router.refresh()}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>
      }
    >
      <h1 className="text-lg font-heading font-bold text-n-900">
        Purchase Orders{' '}
        <span className="text-sm font-normal text-n-500">({total} POs)</span>
      </h1>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <KpiCard label="Total POs" value={total} icon="ShoppingCart" />
        <KpiCard label="Total PO Value" value={formatINR(totalValue)} icon="DollarSign" />
      </div>

      <div className="rounded-lg border border-n-200 bg-white">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h2 className="text-sm font-heading font-bold text-n-700">No Purchase Orders</h2>
            <p className="mt-1 max-w-[340px] text-xs text-n-500">
              {search
                ? 'No POs match your search.'
                : 'Create one from the Bill of Items workspace — select lines and hit Create PO.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
              <tr className="border-b border-n-200 bg-n-50 text-left">
                <th className={TH}>PO Number</th>
                <th className={TH}>Project</th>
                <th className={TH}>Vendor</th>
                <th className={TH}>Delivery Date</th>
                <th className={cn(TH, 'text-right')}>Net Amount</th>
                <th className={TH}>Created By</th>
                <th className={TH}>PDF</th>
                <th className={cn(TH, 'w-16 text-center')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr
                  key={po.id}
                  className="border-b border-n-100 transition-colors odd:bg-white even:bg-n-50/60 hover:bg-n-100/60"
                >
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs font-semibold text-n-900">
                    {po.po_number}
                  </td>
                  <td
                    className="max-w-[200px] truncate px-2 py-2 text-n-700"
                    title={po.project_display_name ?? undefined}
                  >
                    {po.project_display_name ?? <span className="text-n-300">—</span>}
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-2 text-n-700" title={po.vendor_name ?? undefined}>
                    {po.vendor_name ?? <span className="text-n-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-n-600">
                    {po.expected_delivery_date ? formatDate(po.expected_delivery_date) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-medium text-n-900">
                    {formatINR(po.total_amount)}
                  </td>
                  <td className="max-w-[140px] truncate px-2 py-2 text-n-600" title={po.created_by_name ?? undefined}>
                    <span className="block truncate">{po.created_by_name ?? '—'}</span>
                    <span className="block text-[10px] text-n-400">
                      {formatDateFromTimestamp(po.created_at)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {/* The route regenerates from the frozen PO items, so the
                        link always works — even when pdf_storage_path is null. */}
                    <a
                      href={`/api/purchase/${po.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-shiroi-gold hover:underline"
                    >
                      <Download className="h-3 w-3" /> Download
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        title="Edit PO metadata"
                        disabled={!canWrite}
                        onClick={() => setEditRow(po)}
                        className="rounded p-1 text-n-400 hover:bg-n-100 hover:text-n-700 disabled:opacity-40"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete PO"
                        disabled={!canWrite}
                        onClick={() => setDeleteRow(po)}
                        className="rounded p-1 text-n-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={total}
        pageSize={pageSize}
        basePath="/purchase/orders"
        filterParams={search ? { search } : {}}
        entityName="POs"
      />

      <PoEditModal
        row={editRow}
        projects={projects}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
        onSaved={handleEdited}
      />
      <PoDeleteModal
        row={deleteRow}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null);
        }}
        onDeleted={handleDeleted}
      />
    </ListPageShell>
  );
}

// ---------------------------------------------------------------------------
// Edit modal — metadata ONLY (spec §7): Project, Vendor, Delivery Date,
// Payment Terms, Transport, Delivery Place. Items/amounts stay frozen and the
// stored PDF is not regenerated (the banner says exactly that).
// ---------------------------------------------------------------------------

function PoEditModal({
  row,
  projects,
  onOpenChange,
  onSaved,
}: {
  row: BoiPoRow | null;
  projects: ProjectOption[];
  onOpenChange: (open: boolean) => void;
  onSaved: (fresh: BoiPoRow) => void;
}) {
  const { addToast } = useToast();

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [vendor, setVendor] = React.useState('');
  const [deliveryDate, setDeliveryDate] = React.useState('');
  const [paymentTerms, setPaymentTerms] = React.useState('');
  const [transport, setTransport] = React.useState('');
  const [deliveryPlace, setDeliveryPlace] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed the form each time a row opens.
  React.useEffect(() => {
    if (!row) return;
    setProjectId(row.project_id);
    setVendor(row.vendor_name ?? '');
    setDeliveryDate(row.expected_delivery_date ?? '');
    setPaymentTerms(row.payment_terms ?? '');
    setTransport(row.transport ?? '');
    setDeliveryPlace(row.delivery_place ?? '');
    setError(null);
    setSaving(false);
  }, [row]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!row || saving) return;
    if (!vendor.trim()) {
      setError('Vendor name is required');
      return;
    }
    setError(null);
    setSaving(true);

    const result = await updateBoiPoMeta(row.id, {
      projectId,
      vendorName: vendor.trim(),
      deliveryDate: deliveryDate || null,
      paymentTerms: paymentTerms.trim() || null,
      transport: transport.trim() || null,
      deliveryPlace: deliveryPlace.trim() || null,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    addToast({ variant: 'success', title: `${row.po_number} updated ✓` });
    onSaved(result.data);
    onOpenChange(false);
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit {row?.po_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
            Editing corrects this record only — it won&apos;t regenerate the PDF or
            change the items/amounts already fixed when the PO was created.
          </p>

          <div>
            <Label htmlFor="po-edit-project" className="text-xs">Project Name</Label>
            <ProjectCombobox
              id="po-edit-project"
              projects={projects}
              value={projectId}
              onSelect={(p) => setProjectId(p?.id ?? null)}
              placeholder="Select project…"
              className="mt-0.5"
            />
          </div>

          <div>
            <Label htmlFor="po-edit-vendor" className="text-xs">Vendor *</Label>
            <Input
              id="po-edit-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Vendor name"
              required
              className="h-9 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="po-edit-delivery-date" className="text-xs">Delivery Date</Label>
              <Input
                id="po-edit-delivery-date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="po-edit-payment-terms" className="text-xs">Payment Terms</Label>
              <Input
                id="po-edit-payment-terms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. Credit"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="po-edit-transport" className="text-xs">Transport</Label>
              <Input
                id="po-edit-transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                placeholder="e.g. At Actual"
                className="h-9 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="po-edit-delivery-place" className="text-xs">Delivery Place</Label>
              <Input
                id="po-edit-delivery-place"
                value={deliveryPlace}
                onChange={(e) => setDeliveryPlace(e.target.value)}
                placeholder="e.g. Site Office"
                className="h-9 text-xs"
              />
            </div>
          </div>

          {error && (
            <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving} className="text-xs">
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete modal — irreversible warning + the default-ON revert checkbox
// (spec §7: revert target is 'Yet to Place', not each line's prior status).
// ---------------------------------------------------------------------------

function PoDeleteModal({
  row,
  onOpenChange,
  onDeleted,
}: {
  row: BoiPoRow | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (poId: string) => void;
}) {
  const { addToast } = useToast();
  const [revert, setRevert] = React.useState(true);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!row) return;
    setRevert(true); // default ON every time (spec §7)
    setDeleting(false);
    setError(null);
  }, [row]);

  async function handleDelete() {
    if (!row || deleting) return;
    setDeleting(true);
    setError(null);
    const result = await deleteBoiPoAction(row.id, revert);
    setDeleting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    addToast({ variant: 'success', title: `${row.po_number} deleted` });
    onDeleted(row.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Delete {row?.po_number}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
            This permanently removes {row?.po_number} and its line-item record.
            It cannot be undone.
          </p>

          <label className="flex cursor-pointer items-start gap-2 text-xs text-n-700">
            <Checkbox
              checked={revert}
              onCheckedChange={(checked) => setRevert(checked === true)}
              aria-label="Revert item statuses"
              className="mt-0.5"
            />
            <span>
              Also revert this PO&apos;s item(s) status back to &lsquo;Yet to Place&rsquo;
            </span>
          </label>

          {error && (
            <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => void handleDelete()}
              className="text-xs"
            >
              {deleting ? 'Deleting…' : 'Delete PO'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
