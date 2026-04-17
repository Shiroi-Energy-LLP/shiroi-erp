'use client';

/**
 * PO Send button + dialog wrapper.
 *
 * Rendered per-row in Tab 4 for approved POs. Clicking opens the channel
 * picker (Email / WhatsApp / Copy link). The underlying dialog calls
 * `sendPOToVendor` which stamps `sent_to_vendor_at`, appends the channel
 * to `sent_via_channels`, and flips status to 'dispatched' on first send.
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { Send, Check } from 'lucide-react';
import { POSendDialog } from './po-send-dialog';

interface POSendButtonProps {
  po: {
    id: string;
    po_number: string;
    total_amount: number;
    project_name: string;
    sent_to_vendor_at: string | null;
    sent_via_channels: string[];
  };
  vendor: {
    company_name: string;
    email: string | null;
    phone: string | null;
  };
}

export function POSendButton({ po, vendor }: POSendButtonProps) {
  const [open, setOpen] = React.useState(false);
  const alreadySent = Boolean(po.sent_to_vendor_at);

  return (
    <>
      <Button
        size="sm"
        variant={alreadySent ? 'outline' : 'default'}
        className="h-6 text-[10px] px-2 gap-1"
        onClick={() => setOpen(true)}
        title={alreadySent ? 'Re-send PO to vendor' : 'Send PO to vendor'}
      >
        {alreadySent ? <Check className="h-3 w-3" /> : <Send className="h-3 w-3" />}
        {alreadySent ? 'Re-send' : 'Send'}
      </Button>
      <POSendDialog
        po={po}
        vendor={vendor}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
