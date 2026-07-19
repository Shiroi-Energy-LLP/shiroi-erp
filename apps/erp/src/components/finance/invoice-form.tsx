'use client';

import { useState, useTransition } from 'react';
import { Button, Input, Label, DialogFooter } from '@repo/ui';
import { Plus, Loader2 } from 'lucide-react';
import { createCustomerInvoice } from '@/lib/finance-actions';

type ProjectOption = { id: string; project_number: string; customer_name: string };
type InvoiceType = 'proforma' | 'tax_invoice' | 'credit_note';

interface InvoiceFormProps {
  /** Picker mode — selectable projects (the /invoices "Create Invoice" flow). */
  projects?: ProjectOption[];
  /** Fixed mode — pre-scoped project (the project-detail "Raise Invoice" flow). */
  projectId?: string;
  /** Fires with the new invoice number on success. */
  onSuccess: (invoiceNumber: string) => void;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Shared invoice-entry form behind CreateInvoiceDialog (project picker) and
 * RaiseInvoiceDialog (fixed project). The two dialogs historically duplicated
 * ~120 lines of identical fields + GST calc; this is the single source. Calls the
 * canonical createCustomerInvoice (2026-06-18 redundancy sweep §5). GST totals
 * render in whole rupees (formatINR policy).
 */
export function InvoiceForm({
  projects,
  projectId: fixedProjectId,
  onSuccess,
  onCancel,
  submitLabel = 'Create Invoice',
}: InvoiceFormProps) {
  const [isPending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState(fixedProjectId ?? '');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('tax_invoice');
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
  const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const handleSubmit = () => {
    const pid = fixedProjectId ?? projectId;
    if (!pid) { setError('Select a project'); return; }
    if (total <= 0) { setError('Amount must be greater than 0'); return; }
    if (!dueDate) { setError('Due date is required'); return; }
    setError('');

    startTransition(async () => {
      const result = await createCustomerInvoice({
        projectId: pid,
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
        onSuccess(result.data.invoiceNumber);
      } else {
        setError(result.error ?? 'Failed to create invoice');
      }
    });
  };

  return (
    <>
      <div className="space-y-4 py-2">
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}

        {projects && (
          <div>
            <Label>Project</Label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-shiroi-gold"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_number} — {p.customer_name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Invoice Type</Label>
            <select
              value={invoiceType}
              onChange={(e) => setInvoiceType(e.target.value as InvoiceType)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-shiroi-gold"
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
          <div className="flex justify-between"><span className="text-n-600">Supply GST (5%):</span> <span className="font-mono">{inr(gstSupply)}</span></div>
          <div className="flex justify-between"><span className="text-n-600">Works GST (18%):</span> <span className="font-mono">{inr(gstWorks)}</span></div>
          <div className="flex justify-between font-bold border-t border-gray-200 pt-1 mt-1"><span>Total:</span> <span className="font-mono">{inr(total)}</span></div>
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
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-shiroi-gold"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
