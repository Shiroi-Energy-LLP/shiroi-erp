'use client';

import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui';
import { Plus } from 'lucide-react';
import { PaymentForm } from './payment-form';

interface RecordPaymentDialogProps {
  projects: { id: string; project_number: string; customer_name: string }[];
}

export function RecordPaymentDialog({ projects }: RecordPaymentDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        Record Payment
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Customer Payment</DialogTitle>
          </DialogHeader>
          <PaymentForm
            notify={true}
            projects={projects}
            showAdvance
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
