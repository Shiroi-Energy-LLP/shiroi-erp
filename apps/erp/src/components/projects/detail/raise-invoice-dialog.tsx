'use client';

import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui';
import { Plus } from 'lucide-react';
import { InvoiceForm } from '@/components/finance/invoice-form';

interface RaiseInvoiceDialogProps {
  projectId: string;
}

export function RaiseInvoiceDialog({ projectId }: RaiseInvoiceDialogProps) {
  const [open, setOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');

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
          <InvoiceForm
            projectId={projectId}
            submitLabel="Raise Invoice"
            onSuccess={(num) => { setInvoiceNumber(num); setOpen(false); }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
