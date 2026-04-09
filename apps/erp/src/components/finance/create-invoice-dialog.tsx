'use client';

import { useState, useTransition } from 'react';
import {
  Button, Input, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@repo/ui';
import { Plus, Loader2 } from 'lucide-react';
import { createInvoice } from '@/lib/finance-actions';

interface CreateInvoiceDialogProps {
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function CreateInvoiceDialog({ projects }: CreateInvoiceDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [projectId, setProjectId] = useState('');
  const [invoiceType, setInvoiceType] = useState<'proforma' | 'tax_invoice' | 'credit_note'>('tax_invoice');
  const [milestoneName, setMilestoneName] = useState('');
  const [subtotalSupply, setSubtotalSupply] = useState('');
  const [subtotalWorks, setSubtotalWorks] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const supply = parseFloat(subtotalSupply) || 0;
  const works = parseFloat(subtotalWorks) || 0;
  const gstSupply = supply * 0.05;
  const gstWorks = works * 0.18;
  const total = supply + works + gstSupply + gstWorks;

  const handleSubmit = () => {
    if (!projectId) { setError('Select a project'); return; }
    if (total <= 0) { setError('Amount must be greater than 0'); return; }
    if (!dueDate) { setError('Due date is required'); return; }
    setError('');

    startTransition(async () => {
      const result = await createInvoice({
        projectId,
        invoiceType,
        milestoneName: milestoneName || undefined,
        subtotalSupply: supply,
        subtotalWorks: works,
        gstSupplyAmount: gstSupply,
        gstWorksAmount: gstWorks,
        totalAmount: total,
        invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
        dueDate: dueDate || new Date().toISOString().slice(0, 10),
        notes: notes || undefined,
      });
      if (result.success) {
        setOpen(false);
        resetForm();
      } else {
        setError(result.error ?? 'Failed to create invoice');
      }
    });
  };

  const resetForm = () => {
    setProjectId('');
    setMilestoneName('');
    setSubtotalSupply('');
    setSubtotalWorks('');
    setDueDate('');
    setNotes('');
    setError('');
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        Create Invoice
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

            <div>
              <Label>Project</Label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#00B050]"
              >
                <option value="">Select project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Type</Label>
                <select
                  value={invoiceType}
                  onChange={(e) => setInvoiceType(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="proforma">Proforma</option>
                  <option value="tax_invoice">Tax Invoice</option>
                  <option value="credit_note">Credit Note</option>
                </select>
              </div>
              <div>
                <Label>Milestone</Label>
                <Input value={milestoneName} onChange={(e) => setMilestoneName(e.target.value)} placeholder="e.g. Advance, Supply" className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Supply Amount (5% GST)</Label>
                <Input type="number" value={subtotalSupply} onChange={(e) => setSubtotalSupply(e.target.value)} placeholder="0" className="mt-1" />
              </div>
              <div>
                <Label>Works Amount (18% GST)</Label>
                <Input type="number" value={subtotalWorks} onChange={(e) => setSubtotalWorks(e.target.value)} placeholder="0" className="mt-1" />
              </div>
            </div>

            {/* Auto-calculated totals */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Supply GST (5%):</span> <span>₹{gstSupply.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>Works GST (18%):</span> <span>₹{gstWorks.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between font-bold border-t pt-1 mt-1">
                <span>Total:</span> <span>₹{total.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
