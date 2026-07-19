'use client';

import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui';
import { Plus } from 'lucide-react';
import { InvoiceForm } from './invoice-form';

interface CreateInvoiceDialogProps {
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function CreateInvoiceDialog({ projects }: CreateInvoiceDialogProps) {
  const [open, setOpen] = useState(false);

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
          <InvoiceForm
            projects={projects}
            submitLabel="Create Invoice"
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
