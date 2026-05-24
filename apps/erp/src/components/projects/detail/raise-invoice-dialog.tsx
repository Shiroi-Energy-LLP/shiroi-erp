'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@repo/ui';
import { Plus, Loader2 } from 'lucide-react';
import { raiseProjectInvoice } from '@/lib/finance-actions';

interface RaiseInvoiceDialogProps {
  projectId: string;
}

export function RaiseInvoiceDialog({ projectId }: RaiseInvoiceDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [invoiceType, setInvoiceType] = useState<'proforma' | 'tax_invoice' | 'credit_note'>('tax_invoice');
  const [milestoneName, setMilestoneName] = useState('');
  const [subtotalSupply, setSubtotalSupply] = useState('');
  const [subtotalWorks, setSubtotalWorks] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const supply = parseFloat(subtotalSupply) || 0;
  const works = parseFloat(subtotalWorks) || 0;
  const gstSupply = supply * 0.05;
  const gstWorks = works * 0.18;
  const total = supply + works + gstSupply + gstWorks;

  const handleSubmit = () => {
    if (total <= 0) { setError('Amount must be greater than 0'); return; }
    if (!dueDate) { setError('Due date is required'); return; }
    setError('');

    startTransition(async () => {
      const result = await raiseProjectInvoice({
        projectId,
        invoiceType,
        milestoneName: milestoneName || undefined,
        subtotalSupply: supply,
        subtotalWorks: works,
        gstSupplyAmount: gstSupply,
        gstWorksAmount: gstWorks,
        totalAmount: total,
        invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
        dueDate,
        notes: notes || undefined,
      });
      if (result.success) {
        setInvoiceNumber(result.data.invoiceNumber);
        resetForm();
        setOpen(false);
      } else {
        setError(result.error ?? 'Failed to raise invoice');
      }
    });
  };

  const resetForm = () => {
    setMilestoneName('');
    setSubtotalSupply('');
    setSubtotalWorks('');
    setDueDate('');
    setNotes('');
    setError('');
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Raise Invoice
      </Button>

      {invoiceNumber && (
        <span className="text-xs text-shiroi-green font-mono ml-2">
          {invoiceNumber} raised
        </span>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise Invoice</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Type</Label>
                <select
                  value={invoiceType}
                  onChange={(e) => setInvoiceType(e.target.value as typeof invoiceType)}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#00B050]"
                >
                  <option value="proforma">Proforma</option>
                  <option value="tax_invoice">Tax Invoice</option>
                  <option value="credit_note">Credit Note</option>
                </select>
              </div>
              <div>
                <Label>Milestone</Label>
                <Input
                  value={milestoneName}
                  onChange={(e) => setMilestoneName(e.target.value)}
                  placeholder="e.g. Advance, Supply"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Supply Amount (5% GST)</Label>
                <Input
                  type="number"
                  value={subtotalSupply}
                  onChange={(e) => setSubtotalSupply(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Works Amount (18% GST)</Label>
                <Input
                  type="number"
                  value={subtotalWorks}
                  onChange={(e) => setSubtotalWorks(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Auto-calculated totals */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-n-600">Supply GST (5%):</span>
                <span className="font-mono">₹{gstSupply.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-n-600">Works GST (18%):</span>
                <span className="font-mono">₹{gstWorks.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-gray-200 pt-1 mt-1">
                <span>Total:</span>
                <span className="font-mono">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Date</Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#00B050]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Raise Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
