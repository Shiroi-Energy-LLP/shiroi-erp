'use client';

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@repo/ui';
import { Mail } from 'lucide-react';
import { sendProposalToCustomer } from '@/lib/proposal-send-actions';

interface SendProposalButtonProps {
  proposalId: string;
  customerName: string;
  customerEmail: string | null;
}

export function SendProposalButton({
  proposalId,
  customerName,
  customerEmail,
}: SendProposalButtonProps) {
  const { addToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const hasEmail = !!customerEmail && customerEmail.trim().length > 0;

  async function handleSend() {
    setPending(true);
    const result = await sendProposalToCustomer(proposalId);
    setPending(false);
    setOpen(false);
    if (result.success) {
      addToast({
        variant: 'success',
        title: 'Proposal queued for sending',
        description: `To ${result.data.customerEmail} · cc ${result.data.ccEmail}. The email goes out from ${'prem@shiroienergy.com'}.`,
      });
    } else {
      addToast({
        variant: 'destructive',
        title: 'Could not send proposal',
        description: result.error,
      });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!hasEmail}
        title={hasEmail ? 'Send proposal to customer via email' : 'No email on file for this lead'}
      >
        <Mail className="mr-1.5 h-3.5 w-3.5" />
        Send Proposal
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send proposal to {customerName}?</DialogTitle>
            <DialogDescription>
              An email will be sent from{' '}
              <span className="font-medium">prem@shiroienergy.com</span> to{' '}
              <span className="font-medium">{customerEmail ?? '(no email on file)'}</span>,
              with <span className="font-medium">svivek.88@gmail.com</span> CC&apos;d. The
              latest PDF is attached as a signed download link valid for 30 days. The
              proposal status will flip from Draft to Sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={pending || !hasEmail}>
              {pending ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
