'use client';

/**
 * RequisitionReviewActions — approve / reject / convert-to-PO buttons.
 *
 * Rendered on the /procurement/requisitions page for each pending card.
 * Only visible to project_manager, purchase_officer, founder (enforced on
 * the page AND in the server action).
 *
 * States:
 *   pending → can Approve or Reject
 *   approved → can Convert to PO (requires vendorId selection) or still Reject
 */

import { useState, useTransition } from 'react';
import {
  Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Label, Select, useToast,
} from '@repo/ui';
import { Check, X, ShoppingCart, Loader2 } from 'lucide-react';
import { reviewMaterialRequisition, convertRequisitionToPO } from '@/lib/material-requisition-actions';
import { useRouter } from 'next/navigation';
import { searchVendors } from '@/lib/procurement-actions';

interface RequisitionReviewActionsProps {
  requisitionId: string;
  currentStatus: 'pending' | 'approved' | 'converted' | 'rejected';
  projectId: string;
  items: Array<{ description: string; quantity: number; unit: string }>;
}

export function RequisitionReviewActions({
  requisitionId,
  currentStatus,
  projectId: _projectId,
  items,
}: RequisitionReviewActionsProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { addToast } = useToast();

  // Reject dialog state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  // Convert-to-PO dialog state
  const [convertOpen, setConvertOpen] = useState(false);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorResults, setVendorResults] = useState<Array<{ id: string; company_name: string }>>([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVendorName, setSelectedVendorName] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('30');
  const [convertNotes, setConvertNotes] = useState('');

  const handleApprove = () => {
    startTransition(async () => {
      const result = await reviewMaterialRequisition({
        requisitionId,
        action: 'approve',
      });
      if (!result.success) {
        addToast({ title: result.error, variant: 'destructive' });
        return;
      }
      addToast({ title: 'Requisition approved', variant: 'success' });
      router.refresh();
    });
  };

  const handleReject = () => {
    if (!rejectNotes.trim()) {
      addToast({ title: 'Please enter a reason for rejection', variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      const result = await reviewMaterialRequisition({
        requisitionId,
        action: 'reject',
        reviewNotes: rejectNotes.trim(),
      });
      if (!result.success) {
        addToast({ title: result.error, variant: 'destructive' });
        return;
      }
      addToast({ title: 'Requisition rejected', variant: 'success' });
      setRejectOpen(false);
      router.refresh();
    });
  };

  const handleVendorSearch = async (q: string) => {
    setVendorSearch(q);
    if (q.length < 2) {
      setVendorResults([]);
      return;
    }
    const results = await searchVendors(q, 8);
    setVendorResults(results);
  };

  const handleConvert = () => {
    if (!selectedVendorId) {
      addToast({ title: 'Select a vendor before converting', variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      const result = await convertRequisitionToPO({
        requisitionId,
        vendorId: selectedVendorId,
        paymentTermsDays: parseInt(paymentTermsDays, 10) || 30,
        notes: convertNotes.trim() || undefined,
      });
      if (!result.success) {
        addToast({ title: result.error, variant: 'destructive' });
        return;
      }
      addToast({ title: 'PO created — edit rates on the PO detail page', variant: 'success' });
      setConvertOpen(false);
      router.push(`/procurement/${result.data.poId}`);
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Approve (pending only) */}
      {currentStatus === 'pending' && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleApprove}
          disabled={isPending}
          className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Approve
        </Button>
      )}

      {/* Convert to PO (approved only) */}
      {currentStatus === 'approved' && (
        <Button
          size="sm"
          onClick={() => setConvertOpen(true)}
          disabled={isPending}
          className="h-7 text-xs gap-1"
        >
          <ShoppingCart className="h-3 w-3" />
          Convert to PO
        </Button>
      )}

      {/* Reject (pending or approved) */}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setRejectOpen(true)}
        disabled={isPending}
        className="h-7 text-xs gap-1 text-red-600 hover:bg-red-50"
      >
        <X className="h-3 w-3" />
        Reject
      </Button>

      {/* ── Reject dialog ───────────────────────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Requisition</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs font-semibold mb-1 block">Reason for rejection *</Label>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="e.g. Already in next PO batch, duplicate request, out of scope…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring h-24 resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || !rejectNotes.trim()}
            >
              {isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Convert to PO dialog ────────────────────────────────────────── */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert to Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-xs text-n-600 bg-n-50 rounded p-2">
              This creates a draft PO with {items.length} line item(s) at ₹0 rate.
              Edit rates on the PO detail page after creation.
            </div>

            {/* Vendor search */}
            <div>
              <Label className="text-xs font-semibold mb-1 block">Vendor *</Label>
              <input
                type="text"
                placeholder="Type 2+ chars to search vendors…"
                value={vendorSearch}
                onChange={(e) => handleVendorSearch(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {vendorResults.length > 0 && !selectedVendorId && (
                <div className="mt-1 border border-n-200 rounded-md divide-y divide-n-100 max-h-40 overflow-y-auto">
                  {vendorResults.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedVendorId(v.id);
                        setSelectedVendorName(v.company_name);
                        setVendorSearch(v.company_name);
                        setVendorResults([]);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-n-50"
                    >
                      {v.company_name}
                    </button>
                  ))}
                </div>
              )}
              {selectedVendorId && (
                <p className="text-[11px] text-green-700 mt-1">
                  <Check className="inline h-3 w-3 mr-0.5" />
                  {selectedVendorName} — <button
                    onClick={() => { setSelectedVendorId(''); setSelectedVendorName(''); setVendorSearch(''); }}
                    className="underline text-p-600"
                  >change</button>
                </p>
              )}
            </div>

            {/* Payment terms */}
            <div>
              <Label className="text-xs font-semibold mb-1 block">Payment Terms (days)</Label>
              <Select
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                className="h-8 text-sm"
              >
                <option value="0">Advance / 0 days</option>
                <option value="15">15 days</option>
                <option value="30">30 days</option>
                <option value="45">45 days</option>
                <option value="60">60 days</option>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs font-semibold mb-1 block">Notes (optional)</Label>
              <textarea
                value={convertNotes}
                onChange={(e) => setConvertNotes(e.target.value)}
                placeholder="Internal notes for this PO"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring h-16 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleConvert}
              disabled={isPending || !selectedVendorId}
            >
              {isPending ? 'Creating PO…' : 'Create PO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
