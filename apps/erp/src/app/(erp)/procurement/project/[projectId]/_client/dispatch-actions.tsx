'use client';

/**
 * PO Dispatch Actions (Phase 6).
 *
 * Compact button cluster + modals rendered per PO row in Tab 5. Drives the
 * post-approval lifecycle:
 *
 *   approved (draft status)  → [Mark dispatched]          — PE sent PO to vendor
 *   dispatched (no vendor    → [Record vendor dispatch]   — vendor shipped goods
 *     dispatch date yet)
 *   dispatched + vendor date → [Mark received]            — Shiroi acknowledged
 *   acknowledged             → (nothing — terminal)
 *
 * Per the April 17 2026 role-matrix update, Purchase Engineers, Project
 * Managers, and Founders can all move POs through the dispatch lifecycle. The
 * server actions (markPODispatched / recordVendorDispatch / markPOAcknowledged)
 * enforce the same set — we just hide buttons for other roles so the UI
 * doesn't look broken.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui';
import { Send, Truck, PackageCheck } from 'lucide-react';
import type { Database } from '@repo/types/database';
import {
  markPODispatched,
  recordVendorDispatch,
  markPOAcknowledged,
} from '@/lib/po-actions';

type AppRole = Database['public']['Enums']['app_role'];

interface DispatchActionsProps {
  po: {
    id: string;
    po_number: string;
    approval_status: string;
    status: string;
    dispatched_at: string | null;
    vendor_dispatch_date: string | null;
    vendor_tracking_number: string | null;
    expected_delivery_date: string | null;
  };
  viewerRole: AppRole;
}

function todayYMD(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DispatchActions({ po, viewerRole }: DispatchActionsProps) {
  const router = useRouter();
  const canAct =
    viewerRole === 'purchase_officer' ||
    viewerRole === 'project_manager' ||
    viewerRole === 'founder';
  const [busy, setBusy] = React.useState<'send' | 'ack' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Dispatch modal state
  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [vendorDate, setVendorDate] = React.useState(todayYMD());
  const [tracking, setTracking] = React.useState(po.vendor_tracking_number ?? '');
  const [eta, setEta] = React.useState(po.expected_delivery_date ?? '');
  const [dispatchBusy, setDispatchBusy] = React.useState(false);

  if (!canAct) {
    return <span className="text-[10px] text-n-400">—</span>;
  }

  async function handleMarkDispatched() {
    setError(null);
    setBusy('send');
    const res = await markPODispatched(po.id);
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function handleRecordDispatch() {
    if (!vendorDate) {
      setError('Vendor dispatch date is required');
      return;
    }
    setError(null);
    setDispatchBusy(true);
    const res = await recordVendorDispatch({
      poId: po.id,
      vendorDispatchDate: vendorDate,
      vendorTrackingNumber: tracking.trim() || undefined,
      expectedDeliveryDate: eta.trim() || undefined,
    });
    setDispatchBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setDispatchOpen(false);
    router.refresh();
  }

  async function handleAcknowledge() {
    setError(null);
    setBusy('ack');
    const res = await markPOAcknowledged({ poId: po.id });
    setBusy(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  // ─── State-driven button picker ─────────────────────────────────────────

  // 1. Approved but not yet dispatched to vendor (Shiroi side).
  if (po.approval_status === 'approved' && po.status === 'draft') {
    return (
      <div className="inline-flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] px-1.5 gap-1"
          disabled={busy !== null}
          onClick={handleMarkDispatched}
          title="Log that you've sent this PO to the vendor"
        >
          <Send className="h-3 w-3" />
          {busy === 'send' ? 'Marking…' : 'Mark dispatched'}
        </Button>
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>
    );
  }

  // 2. Dispatched to vendor but vendor hasn't confirmed shipping yet.
  if (po.status === 'dispatched' && !po.vendor_dispatch_date) {
    return (
      <>
        <div className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-1.5 gap-1"
            onClick={() => {
              setError(null);
              setVendorDate(todayYMD());
              setTracking(po.vendor_tracking_number ?? '');
              setEta(po.expected_delivery_date ?? '');
              setDispatchOpen(true);
            }}
            title="Log that the vendor has shipped the goods"
          >
            <Truck className="h-3 w-3" />
            Record vendor dispatch
          </Button>
          {error && <span className="text-[10px] text-red-600">{error}</span>}
        </div>
        {renderDispatchDialog()}
      </>
    );
  }

  // 3. Vendor has dispatched — Shiroi can now mark received.
  if (po.status === 'dispatched' && po.vendor_dispatch_date) {
    return (
      <>
        <div className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-1.5 gap-1 border-green-300 text-green-700 hover:bg-green-50"
            disabled={busy !== null}
            onClick={handleAcknowledge}
            title="Mark this PO received — closes the loop"
          >
            <PackageCheck className="h-3 w-3" />
            {busy === 'ack' ? 'Saving…' : 'Mark received'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-1.5 gap-1"
            onClick={() => {
              setError(null);
              setVendorDate(po.vendor_dispatch_date ?? todayYMD());
              setTracking(po.vendor_tracking_number ?? '');
              setEta(po.expected_delivery_date ?? '');
              setDispatchOpen(true);
            }}
            title="Edit tracking info"
          >
            Edit
          </Button>
          {error && <span className="text-[10px] text-red-600">{error}</span>}
        </div>
        {renderDispatchDialog()}
      </>
    );
  }

  // 4. Acknowledged — terminal state, no actions.
  return null;

  // ─── Shared vendor-dispatch modal ───────────────────────────────────────

  function renderDispatchDialog() {
    return (
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              Vendor dispatch — {po.po_number}
            </DialogTitle>
            <DialogDescription className="text-xs text-n-500">
              Log the shipment date, tracking number, and expected delivery date
              the vendor gave you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-[11px]">
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                Vendor dispatch date *
              </label>
              <input
                type="date"
                value={vendorDate}
                onChange={(e) => setVendorDate(e.target.value)}
                className="w-full h-8 border border-n-200 rounded px-2"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                Tracking number (optional)
              </label>
              <input
                type="text"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Courier AWB / LR number"
                className="w-full h-8 border border-n-200 rounded px-2"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
                Expected delivery date (optional)
              </label>
              <input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="w-full h-8 border border-n-200 rounded px-2"
              />
            </div>
          </div>

          {error && <p className="text-[11px] text-red-600">{error}</p>}

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[11px]"
              disabled={dispatchBusy}
              onClick={() => setDispatchOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-[11px]"
              disabled={dispatchBusy || !vendorDate}
              onClick={handleRecordDispatch}
            >
              {dispatchBusy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}
