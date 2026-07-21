'use client';

// =============================================================================
// Create PO modal (spec §6.1) — THE core flow.
// Opens from the bulk bar with the selected BOI rows. Shows a red warn-only
// banner when the selection spans multiple vendors (one PO CAN span vendors —
// the PO stores a single vendor string), a "N item(s) selected · Total ₹X"
// summary, and the metadata fields with sheet-parity prefills:
//   Vendor = first distinct vendor · Project = first distinct project ·
//   Payment Terms "Credit" · Transport "At Actual" · Delivery Date/Place empty.
// On save → createBoiPo (server re-reads lines by id; prices never sent) →
// success: trigger the PDF download (programmatic anchor — popup-blocker
// safe), patch rows via onCreated, toast "PO-00NN created ✓" (+ pdfWarning
// when Storage failed), close.
// =============================================================================

import * as React from 'react';
import Decimal from 'decimal.js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  formatINR,
  useToast,
} from '@repo/ui';
import { createBoiPo } from '@/lib/purchase-flow-actions';
import {
  PO_DEFAULTS,
  type BoiLineRow,
  type CreateBoiPoResult,
  type ProjectOption,
} from '@/lib/purchase-flow-constants';
import { ProjectCombobox } from './project-combobox';

interface CreatePoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected (visible) BOI rows the PO will be created from. */
  selectedRows: BoiLineRow[];
  projects: ProjectOption[];
  /** Fired after a successful create so the workspace can patch the included
   *  rows to order_placed, set their PO linkage and clear the selection. */
  onCreated: (result: CreateBoiPoResult, itemIds: string[], vendorName: string) => void;
}

export function CreatePoModal({
  open,
  onOpenChange,
  selectedRows,
  projects,
  onCreated,
}: CreatePoModalProps) {
  const { addToast } = useToast();

  const [vendor, setVendor] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = React.useState('');
  const [paymentTerms, setPaymentTerms] = React.useState<string>(PO_DEFAULTS.paymentTerms);
  const [transport, setTransport] = React.useState<string>(PO_DEFAULTS.transport);
  const [deliveryPlace, setDeliveryPlace] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Distinct vendors among the selection, in first-seen order (spec §6.1).
  const distinctVendors = React.useMemo(() => {
    const seen: string[] = [];
    for (const row of selectedRows) {
      const v = row.vendor_name?.trim();
      if (v && !seen.includes(v)) seen.push(v);
    }
    return seen;
  }, [selectedRows]);

  // Display-only summary sum of the already-loaded selection (mirrors the
  // sheet's "N item(s) selected · Total ₹X"; money of record is recomputed
  // in SQL by create_boi_po — client prices are never trusted).
  const selectionTotal = React.useMemo(
    () =>
      selectedRows
        .reduce((acc, r) => acc.plus(r.total_price ?? 0), new Decimal(0))
        .toNumber(),
    [selectedRows],
  );

  // Prefill on every open (spec §6.1 table).
  React.useEffect(() => {
    if (!open) return;
    setVendor(distinctVendors[0] ?? '');
    setProjectId(selectedRows[0]?.project_id ?? null);
    setDeliveryDate('');
    setPaymentTerms(PO_DEFAULTS.paymentTerms);
    setTransport(PO_DEFAULTS.transport);
    setDeliveryPlace('');
    setError(null);
    setSaving(false);
  }, [open, selectedRows, distinctVendors]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    if (!vendor.trim()) {
      setError('Vendor name is required');
      return;
    }
    if (!projectId) {
      setError('Project is required');
      return;
    }
    if (selectedRows.length === 0) {
      setError('No items selected');
      return;
    }
    setError(null);
    setSaving(true);

    const itemIds = selectedRows.map((r) => r.id);
    const result = await createBoiPo({
      itemIds,
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

    // Immediate download via a programmatic anchor click — unlike
    // window.open after an async gap, this survives popup blockers (the
    // Content-Disposition: attachment route downloads without leaving the
    // page). Works even when the Storage upload failed: the route
    // regenerates the PDF from the frozen rows.
    const a = document.createElement('a');
    a.href = `/api/purchase/${result.data.poId}/pdf`;
    a.download = '';
    a.click();
    addToast({
      variant: result.data.pdfWarning ? 'warning' : 'success',
      title: `${result.data.poNumber} created ✓`,
      description: result.data.pdfWarning,
    });
    onCreated(result.data, itemIds, vendor.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Create Purchase Order</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {distinctVendors.length > 1 && (
            <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
              ⚠ Selected items have different vendors ({distinctVendors.join(', ')}).
              Consider creating separate POs per vendor, or set one vendor below to
              override.
            </p>
          )}

          <p className="rounded bg-n-50 px-2.5 py-2 text-xs font-medium text-n-800">
            {selectedRows.length} item(s) selected · Total {formatINR(selectionTotal)}
          </p>

          <div>
            <Label htmlFor="po-vendor" className="text-xs">Vendor *</Label>
            <Input
              id="po-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Vendor name"
              required
              className="h-9 text-xs"
            />
          </div>

          <div>
            <Label htmlFor="po-project" className="text-xs">Project Name *</Label>
            <ProjectCombobox
              id="po-project"
              projects={projects}
              value={projectId}
              onSelect={(p) => setProjectId(p?.id ?? null)}
              placeholder="Select project…"
              className="mt-0.5"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="po-delivery-date" className="text-xs">Delivery Date</Label>
              <Input
                id="po-delivery-date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="po-payment-terms" className="text-xs">Payment Terms</Label>
              <Input
                id="po-payment-terms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder={PO_DEFAULTS.paymentTerms}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="po-transport" className="text-xs">Transport</Label>
              <Input
                id="po-transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                placeholder={PO_DEFAULTS.transport}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="po-delivery-place" className="text-xs">Delivery Place</Label>
              <Input
                id="po-delivery-place"
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
              {saving ? 'Creating…' : 'Create PO'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
